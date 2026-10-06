import * as THREE from "three";
import type { GalaxyDoc } from "../model";
import { type CityLayer, type MapItemState, roadStyle } from "./cityLayer";
import {
  addCrossingStrip,
  CROSSING_PATTERN,
  type CrossingPattern,
  type CrossingStrip,
  crossingMaterial,
  stripIndices,
  updateCrossingMaterial,
} from "./crossingLine";
import { type CrossingPlan, coastOf, planCrossings } from "./crossingPlan";
import { dashPolyline, sharedBorderLines } from "./cueLines";
import type { GroundLayer } from "./groundLayer";
import type { WorldPos } from "./layout";
import {
  type LinkCue,
  type LinkTone,
  type MapCueInput,
  mapCues,
} from "./mapCues";
import type { ProvinceLayer } from "./provinceLayer";
import { drapeLine, type MapPoint, ribbonPositions } from "./provinces";
import { pairKey } from "./roads";
import { seaRoute } from "./seaRoute";
import type { TerrainSurface } from "./terrain";

/**
 * The attack cues of a terrain map. Two jobs:
 *
 * - It draws the lines no other layer draws: a crossing as a chart line on
 *   the sea from one coast to the other (see `seaRoute.ts` and
 *   `crossingLine.ts`), a blocked border as a heavy dark line along the
 *   shared edge, and the player's frontier as gold dashes along the shared
 *   edge.
 * - On every change it works the cues out with `mapCues` and hands each
 *   location and road its state, so the province and city layers restyle.
 *
 * Geometry is built once. A change of owner, selection, incursion or fog
 * only rewrites vertex colours. Widths, dashes and colours are design values
 * chosen without seeing them on screen.
 */

/** World units above the ground, over the province borders and the roads. */
const CUE_LIFT = 0.16;

/** Line widths in world units. The province layer's strong border is 0.55. */
const CROSSING_WIDTH = 0.8;
const FRONTIER_WIDTH = 0.6;
const BLOCKED_WIDTH = 1.1;

/**
 * The least width a crossing's strip draws at, in CSS pixels, however far
 * out. The lane's dots are about a quarter of it.
 */
const CROSSING_MIN_PIXELS = 11;
/** How much wider a crossing out of the selected location draws. */
const CROSSING_EMPHASIS = 1.3;

/** Dash and gap in world units, the galaxy's contested lane pattern. */
const DASH = 1.5;
const GAP = 1.2;

/** The pale neutral of a road whose ends do not share an owner. */
const PLAIN_COLOR = new THREE.Color(0xe2dccb);
/** The warm gold of the galaxy's contested lanes. */
const ATTACK_COLOR = new THREE.Color(0xffcf8a);
/** The green of the galaxy's path already travelled. */
const TAKEN_COLOR = new THREE.Color(0x46e08a);
const BLOCKED_COLOR = new THREE.Color(0x14161c);
const WHITE = new THREE.Color(0xffffff);

/** The pattern a crossing draws in for each tone. See `crossingLine.ts`. */
const CROSSING_PATTERN_OF: Record<LinkTone, CrossingPattern> = {
  plain: "dots",
  owned: "edges",
  contested: "glow",
  choice: "chevrons",
  taken: "filled",
};

const PLAIN_OPACITY = 0.85;
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
  /**
   * First vertex and vertex count in the layer's mesh: `map-crossings` for a
   * crossing and `map-cues` for the other two.
   */
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
  /**
   * The crossings as planned for the ground layer, which paints each one's
   * tracks to the shore as roads. Left out, the layer plans the crossings
   * itself and draws those tracks as fine lines.
   */
  painted?: {
    plan: CrossingPlan;
    ground: Pick<
      GroundLayer,
      | "setRoadStyle"
      | "commit"
      | "firstExtra"
      | "provinceRoads"
      | "firstProvince"
    >;
  },
  /** Draw the crossings over the sea as solid lines, for a sea that is not liquid. */
  solidCrossings = false,
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
  const plan = painted?.plan ?? planCrossings(galaxy, surface);
  const coast = coastOf(galaxy, surface, provinces?.index);
  /** The painted tracks to the shore of each crossing, as road state indices. */
  const trackIndices = new Map<string, number[]>();
  /** Border links drawn as a road over dry land, by `pairKey`. */
  const landLinks = new Set(plan.landLinks.map(({ a, b }) => pairKey(a, b)));
  if (painted) {
    painted.plan.tracks.forEach(({ a, b }, j) => {
      const key = pairKey(a, b);
      const list = trackIndices.get(key) ?? [];
      list.push(painted.ground.firstExtra + j);
      trackIndices.set(key, list);
    });
  }
  /** The painted road between two provinces' towns, as a road state index. */
  const provinceRoadIndex = new Map<string, number>();
  painted?.ground.provinceRoads.forEach(({ a, b }, j) => {
    provinceRoadIndex.set(pairKey(a, b), painted.ground.firstProvince + j);
  });
  const strip: CrossingStrip = {
    positions: [],
    tangents: [],
    sides: [],
    alongs: [],
    seas: [],
  };
  const stripIndex: number[] = [];
  /**
   * Add one crossing: the track to the shore, the sea, the far track. The
   * tracks are left to the ground layer where it paints them as roads.
   */
  const addCrossing = (a: string, b: string) => {
    const from = anchorOf(a);
    const to = anchorOf(b);
    const planned = plan.crossings.get(pairKey(a, b));
    // A link planned as a border whose provinces turn out not to touch is
    // not in the plan, and has its route worked out here.
    const route = planned
      ? planned.route
      : coast && seaRoute(from, to, coast.isLand, coast.step);
    const tracksPainted = trackIndices.has(pairKey(a, b));
    const stretches: [MapPoint[], boolean][] = route
      ? [
          [tracksPainted ? [] : route.jettyA, false],
          [route.sea, true],
          [tracksPainted ? [] : route.jettyB, false],
        ]
      : // No coast to find, so the whole line between the two is the crossing.
        [[[from, to], true]];
    const start = strip.positions.length / 3;
    let along = 0;
    for (const [line, sea] of stretches) {
      const points = drape(line);
      if (points.length < 2 || pathLength(points) === 0) continue;
      const first = strip.positions.length / 3;
      along = addCrossingStrip(strip, points, along, sea);
      stripIndex.push(...stripIndices(first, points.length));
    }
    const count = strip.positions.length / 3 - start;
    if (count > 0) lines.push({ type: "crossing", a, b, start, count });
  };
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
      // Over dry land it is a road instead, which the ground layer paints.
      if (landLinks.has(pairKey(a, b))) continue;
    }
    addCrossing(a, b);
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

  // The crossings' own mesh. Colour and opacity, then pattern and width, per
  // vertex, rewritten by `styleLines`.
  const crossingVertices = strip.positions.length / 3;
  const crossingColors = new THREE.BufferAttribute(
    new Float32Array(crossingVertices * 4),
    4,
  );
  const crossingStyles = new THREE.BufferAttribute(
    new Float32Array(crossingVertices * 2),
    2,
  );
  if (crossingVertices > 0) {
    const geo = new THREE.BufferGeometry();
    const attr = (values: number[], size: number) =>
      new THREE.BufferAttribute(new Float32Array(values), size);
    geo.setAttribute("position", attr(strip.positions, 3));
    geo.setAttribute("aTangent", attr(strip.tangents, 3));
    geo.setAttribute("aSide", attr(strip.sides, 1));
    geo.setAttribute("aAlong", attr(strip.alongs, 1));
    geo.setAttribute("aSea", attr(strip.seas, 1));
    geo.setAttribute("aColor", crossingColors);
    geo.setAttribute("aStyle", crossingStyles);
    geo.setIndex(stripIndex);
    const mat = crossingMaterial(CROSSING_WIDTH, PLAIN_COLOR, solidCrossings);
    disposables.push(geo, mat);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = "map-crossings";
    mesh.renderOrder = -1;
    mesh.raycast = () => {};
    // The line is widened on screen, so the box the camera culls by would
    // be the bare centre line's.
    mesh.frustumCulled = false;
    mesh.onBeforeRender = (renderer) =>
      updateCrossingMaterial(mat, renderer, CROSSING_MIN_PIXELS);
    scene.add(mesh);
  }

  /* -------------------------------- style -------------------------------- */

  const scratch = new THREE.Color();
  const paint = (
    line: CueLine,
    color: THREE.Color,
    opacity: number,
    pattern: CrossingPattern = "dots",
    width = 1,
  ) => {
    const crossing = line.type === "crossing";
    const target = crossing ? crossingColors : colors;
    for (let v = line.start; v < line.start + line.count; v++) {
      target.setXYZW(v, color.r, color.g, color.b, opacity);
      if (crossing) crossingStyles.setXY(v, CROSSING_PATTERN[pattern], width);
    }
  };

  const styleLines = (
    linkOf: Map<string, LinkCue>,
    blockedHidden: Set<string>,
  ) => {
    for (const line of lines) {
      const key = pairKey(line.a, line.b);
      if (line.type === "blocked") {
        paint(
          line,
          BLOCKED_COLOR,
          blockedHidden.has(key) ? 0 : BLOCKED_OPACITY,
        );
        continue;
      }
      const link = linkOf.get(key);
      const tone = link?.tone ?? "plain";
      let opacity = 1;
      // Fog: a line between two hidden locations is not drawn.
      if (link?.hidden) opacity = 0;
      else if (tone === "taken") scratch.copy(TAKEN_COLOR);
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
      // A plain crossing out of the selection takes edge lines, as a plain
      // road does.
      const pattern =
        tone === "plain" && link?.emphasised
          ? "edges"
          : CROSSING_PATTERN_OF[link?.hidden ? "plain" : tone];
      paint(
        line,
        scratch,
        opacity,
        pattern,
        link?.emphasised ? CROSSING_EMPHASIS : 1,
      );
    }
    colors.needsUpdate = true;
    crossingColors.needsUpdate = true;
    crossingStyles.needsUpdate = true;
  };

  const apply = () => {
    const cues = mapCues({ galaxy, ...source() });
    styleLines(
      new Map(cues.links.map((l) => [pairKey(l.a, l.b), l])),
      new Set(
        cues.blocked.filter((b) => b.hidden).map((b) => pairKey(b.a, b.b)),
      ),
    );

    for (const [id, cue] of cues.locations) {
      const state: MapItemState | undefined =
        cue.attackable || cue.emphasised || cue.threatened || cue.hidden
          ? cue
          : undefined;
      if (cities.has(id)) cities.setLocationState(id, state);
      else provinces?.setProvinceState(id, state);
    }
    for (const link of cues.links) {
      const attackable = link.tone === "contested" || link.tone === "choice";
      const travelled = link.tone === "taken";
      const { emphasised, hidden } = link;
      const state =
        attackable || travelled || emphasised || hidden
          ? { attackable, travelled, emphasised, hidden }
          : undefined;
      if (link.kind === "road") {
        cities.setRoadState(link.a, link.b, state);
        continue;
      }
      // A road between two provinces' towns is plain scenery. Their fills
      // and border already say who owns what and where a run goes, so the
      // road shows only fog and the lift of a hovered or selected end.
      const between = provinceRoadIndex.get(pairKey(link.a, link.b));
      if (
        painted &&
        between !== undefined &&
        !landLinks.has(pairKey(link.a, link.b))
      ) {
        painted.ground.setRoadStyle(
          between,
          roadStyle(
            emphasised || hidden ? { emphasised, hidden } : undefined,
            hidden ? 2 : 0,
            undefined,
            laneDim(link.a, link.b),
          ),
        );
        continue;
      }
      // A crossing's tracks to the shore are painted as roads, and take the
      // state a road between the same two places would. So does the road of
      // a link over dry land, which has no border line to show its state.
      const tracks =
        trackIndices.get(pairKey(link.a, link.b)) ??
        (between !== undefined ? [between] : undefined);
      if (!painted || !tracks) continue;
      const style = roadStyle(
        state,
        hidden ? 2 : 0,
        link.tone === "owned" ? ownerColor(link.owner) : undefined,
        laneDim(link.a, link.b),
      );
      for (const k of tracks) painted.ground.setRoadStyle(k, style);
    }
    painted?.ground.commit();
    cities.apply();
    provinces?.apply();
  };

  return { lines, apply };
}

/** Length of a line of world points across the ground. */
function pathLength(points: readonly WorldPos[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    total += Math.hypot(b[0] - a[0], b[2] - a[2]);
  }
  return total;
}
