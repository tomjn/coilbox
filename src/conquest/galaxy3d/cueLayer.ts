import * as THREE from "three";
import type { GalaxyDoc } from "../model";
import type { CityLayer, MapItemState } from "./cityLayer";
import { crossingSpan, dashPolyline, sharedBorderLines } from "./cueLines";
import type { WorldPos } from "./layout";
import { type LinkCue, type MapCueInput, mapCues } from "./mapCues";
import type { ProvinceLayer } from "./provinceLayer";
import {
  BORDER_TOLERANCE_FRACTION,
  drapeLine,
  type MapPoint,
  ribbonPositions,
} from "./provinces";
import { pairKey } from "./roads";
import type { TerrainSurface } from "./terrain";

/**
 * The attack cues of a terrain map. Two jobs:
 *
 * - It draws the lines no other layer draws: a crossing as a dashed line over
 *   the gap it spans, a blocked border as a heavy dark line along the shared
 *   edge, and the player's frontier as gold dashes along the shared edge.
 * - On every change it works the cues out with `mapCues` and hands each
 *   location and road its state, so the province and city layers restyle.
 *
 * Geometry is built once. A change of owner, selection or incursion only
 * rewrites vertex colours. Widths, dashes and colours are design values
 * chosen without seeing them on screen.
 */

/** World units above the ground, over the province borders and the roads. */
const CUE_LIFT = 0.16;

/** Line widths in world units. The province layer's strong border is 0.55. */
const CROSSING_WIDTH = 0.5;
const FRONTIER_WIDTH = 0.6;
const BLOCKED_WIDTH = 1.1;

/** Dash and gap in world units, the galaxy's contested lane pattern. */
const DASH = 1.5;
const GAP = 1.2;

/** A crossing never draws shorter than this many dashes. */
const CROSSING_MIN_DASHES = 3;

/** The pale neutral of a road whose ends do not share an owner. */
const PLAIN_COLOR = new THREE.Color(0xe2dccb);
/** The warm gold of the galaxy's contested lanes. */
const ATTACK_COLOR = new THREE.Color(0xffcf8a);
/** The green of the galaxy's path already travelled. */
const TAKEN_COLOR = new THREE.Color(0x46e08a);
const BLOCKED_COLOR = new THREE.Color(0x14161c);
const WHITE = new THREE.Color(0xffffff);

const PLAIN_OPACITY = 0.7;
const OWNED_OPACITY = 0.9;
const BLOCKED_OPACITY = 0.95;

/** One line the layer draws, and where its vertices are. */
export interface CueLine {
  /**
   * A `frontier` is the shared edge of two linked provinces. It draws only
   * while that link is contested, taken or a choice.
   */
  type: "crossing" | "frontier" | "blocked";
  a: string;
  b: string;
  /** First vertex and vertex count in the layer's mesh. */
  start: number;
  count: number;
}

export interface CueLayer {
  /** The lines built, for tests and for nothing else. */
  lines: readonly CueLine[];
  /**
   * Work the cues out again, recolour the lines, and restyle the province
   * and city layers. This calls their `apply`, so the caller does not.
   */
  apply: () => void;
}

/** What the layer reads fresh on every {@link CueLayer.apply}. */
export type CueSource = () => Omit<MapCueInput, "galaxy">;

export function buildCueLayer(
  scene: THREE.Scene,
  disposables: { dispose(): void }[],
  galaxy: GalaxyDoc,
  surface: TerrainSurface,
  ownerColor: (owner: string | undefined) => THREE.Color,
  laneDim: (a: string, b: string) => number,
  cities: Pick<
    CityLayer,
    "has" | "setLocationState" | "setRoadState" | "apply"
  >,
  provinces:
    | Pick<ProvinceLayer, "index" | "borders" | "setProvinceState" | "apply">
    | undefined,
  source: CueSource,
): CueLayer {
  const nodeIndex = new Map(galaxy.nodes.map((n, i) => [n.id, i]));
  /** A node id as a province's node index, or -1 for a point location. */
  const provinceOf = (id: string): number => {
    const i = nodeIndex.get(id);
    return i !== undefined && provinces?.index.has(i) ? i : -1;
  };
  const anchorOf = (id: string): MapPoint => {
    const pos = galaxy.nodes[nodeIndex.get(id) ?? -1]?.pos ?? [0, 0];
    return [pos[0], pos[1]];
  };

  /* ------------------------------- geometry ------------------------------ */

  const lines: CueLine[] = [];
  const chunks: Float32Array[] = [];
  let vertices = 0;
  /** Add one line made of ribbons. A line with nothing to draw is left out. */
  const addLine = (
    type: CueLine["type"],
    a: string,
    b: string,
    paths: WorldPos[][],
    width: number,
  ) => {
    const start = vertices;
    for (const path of paths) {
      const chunk = ribbonPositions(path, width);
      chunks.push(chunk);
      vertices += chunk.length / 3;
    }
    if (vertices > start) {
      lines.push({ type, a, b, start, count: vertices - start });
    }
  };

  /** A line of map points laid over the relief, as world points. */
  const drape = (line: MapPoint[]): WorldPos[] => {
    const out: WorldPos[] = [];
    for (let i = 0; i < line.length - 1; i++) {
      const points = drapeLine(line[i], line[i + 1], surface);
      for (const [x, y] of i === 0 ? points : points.slice(1)) {
        out.push(surface.mapToWorld(x, y, CUE_LIFT));
      }
    }
    return out;
  };
  /** The edge two provinces share, as draped lines. Empty if they do not touch. */
  const sharedEdge = (a: string, b: string): WorldPos[][] => {
    const ia = provinceOf(a);
    const ib = provinceOf(b);
    if (!provinces || ia < 0 || ib < 0) return [];
    return sharedBorderLines(provinces.borders, ia, ib).map(drape);
  };

  // Link kinds and blocked borders do not depend on who owns what, so one
  // pass with no owners says what there is to draw.
  const structure = mapCues({ galaxy, owners: {}, playerFactionId: "" });
  const minSpan = (CROSSING_MIN_DASHES * (DASH + GAP)) / surface.scale;
  // The coast is looked for in steps of the distance the province layer
  // treats as touching, so the two agree on where a province ends.
  const coastStep =
    Math.max(surface.width, surface.height) * BORDER_TOLERANCE_FRACTION;
  for (const { a, b, kind } of structure.links) {
    if (kind === "road") continue; // cityLayer.ts draws it
    if (kind === "border") {
      const edge = sharedEdge(a, b);
      if (edge.length > 0) {
        addLine(
          "frontier",
          a,
          b,
          edge.flatMap((line) => dashPolyline(line, DASH, GAP)),
          FRONTIER_WIDTH,
        );
        continue;
      }
      // Two linked provinces that do not touch have no border to draw the
      // link on, so it draws as a crossing does and the link stays visible.
    }
    const [from, to] = crossingSpan(
      provinces?.index,
      provinceOf(a),
      provinceOf(b),
      anchorOf(a),
      anchorOf(b),
      coastStep,
      minSpan,
    );
    addLine(
      "crossing",
      a,
      b,
      dashPolyline(drape([from, to]), DASH, GAP),
      CROSSING_WIDTH,
    );
  }
  for (const { a, b } of structure.blocked) {
    addLine("blocked", a, b, sharedEdge(a, b), BLOCKED_WIDTH);
  }

  // Red, green, blue and opacity per vertex, rewritten by `styleLines`.
  const colors = new THREE.BufferAttribute(new Float32Array(vertices * 4), 4);
  if (vertices > 0) {
    const positions = new Float32Array(vertices * 3);
    const indices: number[] = [];
    let at = 0;
    for (const chunk of chunks) {
      positions.set(chunk, at * 3);
      // `ribbonPositions` makes four vertices per stretch.
      for (let v = at; v < at + chunk.length / 3; v += 4) {
        indices.push(v, v + 1, v + 2, v + 2, v + 1, v + 3);
      }
      at += chunk.length / 3;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("color", colors);
    geo.setIndex(indices);
    const mat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      // Over the province borders, which sit at factor -2, and still hidden
      // by a hill that stands in front.
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -6,
    });
    disposables.push(geo, mat);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = "map-cues";
    mesh.renderOrder = -1;
    mesh.raycast = () => {};
    scene.add(mesh);
  }

  /* -------------------------------- style -------------------------------- */

  const scratch = new THREE.Color();
  const paint = (line: CueLine, color: THREE.Color, opacity: number) => {
    for (let v = line.start; v < line.start + line.count; v++) {
      colors.setXYZW(v, color.r, color.g, color.b, opacity);
    }
  };

  const styleLines = (linkOf: Map<string, LinkCue>) => {
    for (const line of lines) {
      if (line.type === "blocked") {
        paint(line, BLOCKED_COLOR, BLOCKED_OPACITY);
        continue;
      }
      const link = linkOf.get(pairKey(line.a, line.b));
      const tone = link?.tone ?? "plain";
      let opacity = 1;
      if (tone === "taken") scratch.copy(TAKEN_COLOR);
      else if (tone === "contested" || tone === "choice") {
        scratch.copy(ATTACK_COLOR);
      } else if (line.type === "frontier") {
        // A quiet border is the province layer's own line and nothing more.
        opacity = 0;
      } else if (tone === "owned") {
        scratch.copy(ownerColor(link?.owner));
        opacity = OWNED_OPACITY;
      } else {
        scratch.copy(PLAIN_COLOR);
        opacity = PLAIN_OPACITY;
      }
      if (opacity > 0) {
        if (link?.emphasised) {
          scratch.lerp(WHITE, 0.35);
          opacity = 1;
        }
        // The lift and fade a road takes while a location is hovered.
        opacity = Math.min(1, opacity * laneDim(line.a, line.b));
      }
      paint(line, scratch, opacity);
    }
    colors.needsUpdate = true;
  };

  const apply = () => {
    const cues = mapCues({ galaxy, ...source() });
    styleLines(new Map(cues.links.map((l) => [pairKey(l.a, l.b), l])));

    for (const [id, cue] of cues.locations) {
      const state: MapItemState | undefined =
        cue.attackable || cue.emphasised || cue.threatened ? cue : undefined;
      if (cities.has(id)) cities.setLocationState(id, state);
      else provinces?.setProvinceState(id, state);
    }
    for (const link of cues.links) {
      if (link.kind !== "road") continue;
      const attackable = link.tone === "contested" || link.tone === "choice";
      const travelled = link.tone === "taken";
      cities.setRoadState(
        link.a,
        link.b,
        attackable || travelled || link.emphasised
          ? { attackable, travelled, emphasised: link.emphasised }
          : undefined,
      );
    }
    cities.apply();
    provinces?.apply();
  };

  return { lines, apply };
}
