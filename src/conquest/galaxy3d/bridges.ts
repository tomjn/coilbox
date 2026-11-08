import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { Rgb } from "../planets";
import { riverRoom } from "../rivers";
import type { RoadLine } from "./roadMask";
import type { MapXY } from "./roadRoute";
import { SHADE_AMBIENT, TERRAIN_SUN, type TerrainSurface } from "./terrain";

/**
 * Bridges where roads cross rivers: a stone deck with a parapet along each
 * side and an abutment at each end, square to the river and straight over
 * it. The road's paint stops at the bank (`groundShader.ts`) and the bridge
 * carries it across. Each bridge belongs to its road, so it is hidden with
 * the road.
 *
 * Display only. Finding the crossings is pure, so it is tested without WebGL.
 */

/** Where a road crosses a river: the deck's two ends on dry ground, in map units. */
export interface Crossing {
  /** The road's state index, or undefined for scenery. */
  road: number | undefined;
  from: MapXY;
  to: MapXY;
}

/** How far a deck runs onto dry ground past each bank, in world units. */
const OVERHANG = 0.12;

/**
 * Every place a road in `roads` crosses a river in `rivers`, which are x, y
 * and half width triples in map units. `scale` is world units per map unit.
 */
export function findCrossings(
  roads: readonly RoadLine[],
  rivers: readonly Float32Array[],
  scale: number,
): Crossing[] {
  if (rivers.length === 0) return [];
  // Steps a twentieth of a world unit long, so the narrowest river is crossed
  // in several.
  const step = 0.05 / scale;
  const out: Crossing[] = [];
  for (const road of roads) {
    const walk: MapXY[] = road.line.slice(0, 1);
    for (let k = 1; k < road.line.length; k++) {
      const [ax, ay] = road.line[k - 1];
      const [bx, by] = road.line[k];
      const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / step));
      for (let j = 1; j <= n; j++) {
        walk.push([ax + ((bx - ax) * j) / n, ay + ((by - ay) * j) / n]);
      }
    }
    let first = -1;
    for (let k = 0; k < walk.length; k++) {
      const wet = riverRoom(rivers, walk[k][0], walk[k][1]) <= 0;
      if (wet && first < 0) first = k;
      if (first < 0 || (wet && k < walk.length - 1)) continue;
      // The dry points either side of the water, then on past them.
      const a = walk[Math.max(0, first - 1)];
      const b = walk[k];
      first = -1;
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const len = Math.hypot(dx, dy);
      if (len === 0) continue;
      const over = OVERHANG / scale / len;
      out.push({
        road: road.index,
        from: [a[0] - dx * over, a[1] - dy * over],
        to: [b[0] + dx * over, b[1] + dy * over],
      });
    }
  }
  return out;
}

/** Half the deck's width, and so on, in world units. */
const DECK_HALF_WIDTH = 0.13;
const DECK_THICKNESS = 0.04;
const PARAPET_WIDTH = 0.025;
const PARAPET_HEIGHT = 0.045;
/** How high the deck's top stands over the higher bank. */
const DECK_LIFT = 0.035;
const ABUTMENT_LENGTH = 0.09;
/** How deep the abutments and piers reach below the deck, so no gap shows. */
const FOOTING = 0.25;
/** A span longer than this has a pier under its middle. */
const PIER_SPAN = 0.6;

/** A box in the bridge's own frame: x along the span, y up, z across. */
function box(
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  z0: number,
  z1: number,
): THREE.BufferGeometry {
  const geo = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
  geo.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  return geo;
}

/**
 * Colour every vertex of `geo` as the ground is lit: `colour` on a face
 * turned to the sky, shaded as the terrain shades a slope elsewhere. The
 * view's ground is unlit and lights itself, so its bridges do too.
 */
function paint(geo: THREE.BufferGeometry, colour: THREE.Color): void {
  const normal = geo.getAttribute("normal");
  const colours = new Float32Array(normal.count * 3);
  const [sx, sy, sz] = TERRAIN_SUN;
  for (let i = 0; i < normal.count; i++) {
    const facing = Math.max(
      0,
      normal.getX(i) * sx + normal.getY(i) * sy + normal.getZ(i) * sz,
    );
    const shade = SHADE_AMBIENT + (1 - SHADE_AMBIENT) * (facing / sy);
    colours[i * 3] = colour.r * shade;
    colours[i * 3 + 1] = colour.g * shade;
    colours[i * 3 + 2] = colour.b * shade;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colours, 3));
}

/** One bridge's geometry, placed on `surface`. */
export function bridgeGeometry(
  crossing: Crossing,
  surface: TerrainSurface,
  stone: THREE.Color,
): THREE.BufferGeometry {
  const [ax, ay, az] = surface.mapToWorld(...crossing.from);
  const [bx, by, bz] = surface.mapToWorld(...crossing.to);
  const length = Math.hypot(bx - ax, bz - az);
  const top = Math.max(ay, by) + DECK_LIFT;
  const low = Math.min(ay, by) - FOOTING;
  const w = DECK_HALF_WIDTH;
  const deck = box(0, length, top - DECK_THICKNESS, top, -w, w);
  const parapets = [-1, 1].map((side) =>
    box(
      0,
      length,
      top,
      top + PARAPET_HEIGHT,
      side < 0 ? -w : w - PARAPET_WIDTH,
      side < 0 ? -w + PARAPET_WIDTH : w,
    ),
  );
  const ends = [0, length - ABUTMENT_LENGTH].map((x) =>
    box(x, x + ABUTMENT_LENGTH, low, top, -w - 0.02, w + 0.02),
  );
  const piers =
    length > PIER_SPAN
      ? [
          box(
            length / 2 - 0.035,
            length / 2 + 0.035,
            low,
            top,
            -w * 0.8,
            w * 0.8,
          ),
        ]
      : [];
  const darker = stone.clone().multiplyScalar(0.8);
  paint(deck, stone);
  for (const p of parapets) paint(p, stone);
  for (const e of [...ends, ...piers]) paint(e, darker);
  const parts = [deck, ...parapets, ...ends, ...piers];
  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  // From the bridge's frame onto the map: along the span, from `from`.
  merged.rotateY(-Math.atan2(bz - az, bx - ax));
  merged.translate(ax, 0, az);
  return merged;
}

/** The bridges of a map, and a way to hide each with its road. */
export interface BridgeLayer {
  group: THREE.Group;
  /** Show or hide the bridges on road `k`. */
  setShown(k: number, shown: boolean): void;
}

/** Build a mesh for every crossing, in the planet's `stone`, in sRGB. */
export function buildBridges(
  disposables: { dispose(): void }[],
  crossings: readonly Crossing[],
  surface: TerrainSurface,
  stone: Rgb,
): BridgeLayer {
  const group = new THREE.Group();
  group.name = "bridges";
  const colour = new THREE.Color().setRGB(
    stone[0] / 255,
    stone[1] / 255,
    stone[2] / 255,
    THREE.SRGBColorSpace,
  );
  const material = new THREE.MeshBasicMaterial({ vertexColors: true });
  disposables.push(material);
  const byRoad = new Map<number, THREE.Mesh[]>();
  for (const crossing of crossings) {
    const geo = bridgeGeometry(crossing, surface, colour);
    disposables.push(geo);
    const mesh = new THREE.Mesh(geo, material);
    // Decoration: picking goes to the map and what stands on it.
    mesh.raycast = () => {};
    group.add(mesh);
    if (crossing.road !== undefined) {
      byRoad.set(crossing.road, [...(byRoad.get(crossing.road) ?? []), mesh]);
    }
  }
  return {
    group,
    setShown(k, shown) {
      for (const mesh of byRoad.get(k) ?? []) mesh.visible = shown;
    },
  };
}
