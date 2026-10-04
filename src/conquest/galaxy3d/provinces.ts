import { ShapeUtils, Vector2 } from "three";
import type { GalaxyDoc, GalaxyNode } from "../model";
import { type TerrainSurface, terrainSpecOf } from "./terrain";

/**
 * Province maths: a province is a node with an `outline`, one or more closed
 * polygons in map units. Everything here is free of WebGL and the DOM so it
 * unit-tests in node. The one three.js import is its polygon triangulator. `provinceLayer.ts` turns it into meshes.
 *
 * Four jobs live here:
 *
 * - Which province is at a map point ({@link ProvinceIndex.at}), and where a
 *   camera ray meets the ground ({@link rayToMap}). Together they are picking
 *   by area.
 * - A fill that lies on the terrain ({@link drapeFill}). Each outline is cut
 *   into triangles, and each triangle is then cut along the terrain mesh's
 *   own cell edges and diagonals, so every piece lies inside one terrain
 *   triangle and the fill can neither cut through a hill nor float over a
 *   valley.
 * - Border lines ({@link provinceBorders}), each knowing the province on its
 *   far side, so the layer can draw a stronger line where owners differ.
 * - How a province looks for a given state ({@link provinceStyle}).
 */

/** A point in map units: x right, y down, origin at the map's top left. */
export type MapPoint = [number, number];

/** A closed polygon. The last point joins the first and is not repeated. */
export type Ring = MapPoint[];

type OutlineNode = Pick<GalaxyNode, "outline">;

/** A node's usable rings: those with at least three points. */
export function provinceRings(node: OutlineNode): Ring[] {
  return (node.outline ?? []).filter((ring) => ring.length >= 3);
}

/** True when a node is drawn as an area and not as a point marker. */
export function isProvince(node: OutlineNode): boolean {
  return provinceRings(node).length > 0;
}

/** Twice the signed area of a ring. The sign gives its winding. */
function ringArea2(ring: Ring): number {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    sum += x1 * y2 - x2 * y1;
  }
  return sum;
}

/** Even-odd test: is the point inside the ring. */
export function pointInRing(ring: Ring, x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

interface IndexedProvince {
  node: number;
  rings: Ring[];
  area: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** The provinces of a map, searchable by map point. */
export interface ProvinceIndex {
  /** Node indices that are provinces, in node order. */
  readonly nodes: number[];
  /** True when the node at this index is a province. */
  has(nodeIndex: number): boolean;
  /** The node's usable rings, empty for a point location. */
  ringsOf(nodeIndex: number): Ring[];
  /** True when the map point is inside the province at this node index. */
  contains(nodeIndex: number, x: number, y: number): boolean;
  /**
   * Node index of the province at a map point, or -1 when the point is in no
   * province. Where provinces overlap the smallest wins, so a province drawn
   * inside another stays reachable. `except` skips one node.
   */
  at(x: number, y: number, except?: number): number;
}

export function createProvinceIndex(nodes: OutlineNode[]): ProvinceIndex {
  const byNode = new Map<number, IndexedProvince>();
  nodes.forEach((n, node) => {
    const rings = provinceRings(n);
    if (rings.length === 0) return;
    const p: IndexedProvince = {
      node,
      rings,
      area: 0,
      minX: Number.POSITIVE_INFINITY,
      maxX: Number.NEGATIVE_INFINITY,
      minY: Number.POSITIVE_INFINITY,
      maxY: Number.NEGATIVE_INFINITY,
    };
    for (const ring of rings) {
      p.area += Math.abs(ringArea2(ring)) / 2;
      for (const [x, y] of ring) {
        p.minX = Math.min(p.minX, x);
        p.maxX = Math.max(p.maxX, x);
        p.minY = Math.min(p.minY, y);
        p.maxY = Math.max(p.maxY, y);
      }
    }
    byNode.set(node, p);
  });
  // Smallest first, so the first match is the smallest province at a point.
  const bySize = [...byNode.values()].sort((a, b) => a.area - b.area);
  const inside = (p: IndexedProvince, x: number, y: number): boolean =>
    x >= p.minX &&
    x <= p.maxX &&
    y >= p.minY &&
    y <= p.maxY &&
    p.rings.some((ring) => pointInRing(ring, x, y));
  return {
    nodes: [...byNode.keys()],
    has: (nodeIndex) => byNode.has(nodeIndex),
    ringsOf: (nodeIndex) => byNode.get(nodeIndex)?.rings ?? [],
    contains: (nodeIndex, x, y) => {
      const p = byNode.get(nodeIndex);
      return p ? inside(p, x, y) : false;
    },
    at: (x, y, except) => {
      for (const p of bySize) {
        if (p.node !== except && inside(p, x, y)) return p.node;
      }
      return -1;
    },
  };
}

/**
 * The province index for a map document, or `undefined` when the province
 * path does not apply: the document has no usable terrain, or no node has an
 * outline. A galaxy or theatre map always gets `undefined`, because an
 * outline is in map units and means nothing without a terrain.
 */
export function provinceIndexFor(
  galaxy: Pick<GalaxyDoc, "terrain"> & { nodes: OutlineNode[] },
): ProvinceIndex | undefined {
  if (!terrainSpecOf(galaxy)) return undefined;
  const index = createProvinceIndex(galaxy.nodes);
  return index.nodes.length > 0 ? index : undefined;
}

/* ------------------------------- picking -------------------------------- */

/**
 * Where a ray meets the ground, as a map point, or `null` when it misses the
 * sheet. `origin` and `direction` are world `[x, y, z]`, and the direction
 * need not be normalised. The ray is walked in steps of half a terrain cell
 * between the highest ground and ground level, then the crossing is narrowed
 * by bisection, so the answer agrees with {@link TerrainSurface.groundHeightAt}.
 */
export function rayToMap(
  surface: TerrainSurface,
  origin: readonly [number, number, number],
  direction: readonly [number, number, number],
): MapPoint | null {
  const [ox, oy, oz] = origin;
  const [dx, dy, dz] = direction;
  if (dy >= 0) return null; // level or pointing up: never comes down
  const above = (t: number): number =>
    oy + dy * t - surface.groundHeightAtWorld(ox + dx * t, oz + dz * t);
  const onSheet = (t: number): MapPoint | null => {
    const [mapX, mapY] = surface.worldToMap(ox + dx * t, oz + dz * t);
    return mapX >= 0 &&
      mapX <= surface.width &&
      mapY >= 0 &&
      mapY <= surface.height
      ? [mapX, mapY]
      : null;
  };
  const tBottom = -oy / dy;
  if (tBottom < 0) return null; // the origin is already below ground level
  if (surface.maxHeight === 0) return onSheet(tBottom);
  const tTop = Math.max(0, (surface.maxHeight - oy) / dy);
  const cell = Math.min(
    surface.worldWidth / surface.segmentsX,
    surface.worldDepth / surface.segmentsY,
  );
  const horizontal = Math.hypot(dx, dz) * (tBottom - tTop);
  const steps = Math.max(1, Math.ceil(horizontal / (cell / 2)));
  let before = tTop;
  if (above(before) <= 0) return onSheet(before);
  for (let s = 1; s <= steps; s++) {
    const t = tTop + ((tBottom - tTop) * s) / steps;
    if (above(t) > 0) {
      before = t;
      continue;
    }
    let lo = before;
    let hi = t;
    for (let k = 0; k < 24; k++) {
      const mid = (lo + hi) / 2;
      if (above(mid) > 0) lo = mid;
      else hi = mid;
    }
    return onSheet(hi);
  }
  return onSheet(tBottom);
}

/* -------------------------------- fills --------------------------------- */

/** A convex polygon as flat `[x0, y0, x1, y1, ...]` map coordinates. */
type Poly = number[];

/** Keep the part of a convex polygon where `a*x + b*y + c >= 0`. */
function clipHalfPlane(poly: Poly, a: number, b: number, c: number): Poly {
  const out: Poly = [];
  const n = poly.length / 2;
  for (let i = 0; i < n; i++) {
    const x1 = poly[i * 2];
    const y1 = poly[i * 2 + 1];
    const x2 = poly[((i + 1) % n) * 2];
    const y2 = poly[((i + 1) % n) * 2 + 1];
    const d1 = a * x1 + b * y1 + c;
    const d2 = a * x2 + b * y2 + c;
    if (d1 >= 0) out.push(x1, y1);
    if (d1 >= 0 !== d2 >= 0) {
      const t = d1 / (d1 - d2);
      out.push(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t);
    }
  }
  return out;
}

/** Triangles of one ring, as indices into the ring. */
export function triangulateRing(ring: Ring): number[][] {
  return ShapeUtils.triangulateShape(
    ring.map(([x, y]) => new Vector2(x, y)),
    [],
  );
}

/**
 * A province's fill laid on the terrain: world positions, nine numbers per
 * triangle, each vertex `lift` world units above the ground.
 *
 * Every triangle of the outline is cut along the terrain's cell edges and
 * cell diagonals, the same lines `terrainTriangles` splits the sheet on. Each
 * piece then lies within one flat terrain triangle, so with its corners at
 * ground height the whole piece is on the ground. A flat sheet has one cell,
 * so a fill there is cut once along the sheet's diagonal and no further. Any
 * part of an outline beyond the sheet's edge is dropped.
 */
export function drapeFill(
  rings: Ring[],
  surface: TerrainSurface,
  lift: number,
): Float32Array {
  const { segmentsX, segmentsY } = surface;
  const cw = surface.width / segmentsX;
  const ch = surface.height / segmentsY;
  const out: number[] = [];
  const emit = (poly: Poly) => {
    const n = poly.length / 2;
    for (let k = 1; k < n - 1; k++) {
      const ax = poly[0];
      const ay = poly[1];
      const bx = poly[k * 2];
      const by = poly[k * 2 + 1];
      const cx = poly[k * 2 + 2];
      const cy = poly[k * 2 + 3];
      // A sliver with no area draws nothing and only costs vertices.
      const area2 = Math.abs((bx - ax) * (cy - ay) - (cx - ax) * (by - ay));
      if (area2 <= cw * ch * 1e-9) continue;
      out.push(
        ...surface.mapToWorld(ax, ay, lift),
        ...surface.mapToWorld(bx, by, lift),
        ...surface.mapToWorld(cx, cy, lift),
      );
    }
  };
  for (const ring of rings) {
    for (const [ia, ib, ic] of triangulateRing(ring)) {
      const tri: Poly = [...ring[ia], ...ring[ib], ...ring[ic]];
      const minY = Math.min(tri[1], tri[3], tri[5]);
      const maxY = Math.max(tri[1], tri[3], tri[5]);
      const j0 = Math.max(0, Math.floor(minY / ch));
      const j1 = Math.min(segmentsY - 1, Math.floor(maxY / ch));
      for (let j = j0; j <= j1; j++) {
        // The triangle within this row of cells.
        let row = clipHalfPlane(tri, 0, 1, -j * ch);
        row = clipHalfPlane(row, 0, -1, (j + 1) * ch);
        if (row.length < 6) continue;
        let minX = Number.POSITIVE_INFINITY;
        let maxX = Number.NEGATIVE_INFINITY;
        for (let k = 0; k < row.length; k += 2) {
          minX = Math.min(minX, row[k]);
          maxX = Math.max(maxX, row[k]);
        }
        const i0 = Math.max(0, Math.floor(minX / cw));
        const i1 = Math.min(segmentsX - 1, Math.floor(maxX / cw));
        for (let i = i0; i <= i1; i++) {
          let cell = clipHalfPlane(row, 1, 0, -i * cw);
          cell = clipHalfPlane(cell, -1, 0, (i + 1) * cw);
          if (cell.length < 6) continue;
          // The cell's diagonal runs from its top right to its bottom left:
          // (x - i*cw)/cw + (y - j*ch)/ch = 1.
          const c = i + j + 1;
          emit(clipHalfPlane(cell, -1 / cw, -1 / ch, c));
          emit(clipHalfPlane(cell, 1 / cw, 1 / ch, -c));
        }
      }
    }
  }
  return new Float32Array(out);
}

/* ------------------------------- borders -------------------------------- */

/**
 * The points of a straight line from `a` to `b` in map units, with a point
 * added wherever it crosses a terrain cell edge or cell diagonal. Between two
 * neighbouring points the ground is flat, so a line drawn through them at
 * ground height follows the relief exactly. A flat sheet returns `[a, b]`.
 */
export function drapeLine(
  a: MapPoint,
  b: MapPoint,
  surface: TerrainSurface,
): MapPoint[] {
  if (surface.maxHeight === 0) return [a, b];
  const cw = surface.width / surface.segmentsX;
  const ch = surface.height / surface.segmentsY;
  const ts: number[] = [];
  // Crossings of the lines where `value` is a whole number.
  const crossings = (from: number, to: number) => {
    if (from === to) return;
    const lo = Math.min(from, to);
    const hi = Math.max(from, to);
    for (let k = Math.ceil(lo); k <= Math.floor(hi); k++) {
      const t = (k - from) / (to - from);
      if (t > 0 && t < 1) ts.push(t);
    }
  };
  crossings(a[0] / cw, b[0] / cw);
  crossings(a[1] / ch, b[1] / ch);
  crossings(a[0] / cw + a[1] / ch, b[0] / cw + b[1] / ch);
  ts.sort((p, q) => p - q);
  const points: MapPoint[] = [a];
  let last = 0;
  for (const t of ts) {
    if (t - last < 1e-9) continue;
    points.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    last = t;
  }
  points.push(b);
  return points;
}

/**
 * How close two outlines must run to count as sharing a border, as a fraction
 * of the map's longer side. A design value, not a measurement: it is meant to
 * be larger than the gap or overlap a tracer or generator leaves between two
 * neighbours and smaller than half the narrowest province. The hand-made map
 * tracer gives two neighbours the same points along a shared border, and its
 * sample map finds the same borders at any fraction from 1/4000 to 1/100.
 */
export const BORDER_TOLERANCE_FRACTION = 1 / 400;

/** One straight stretch of a province's outline. */
export interface BorderPiece {
  a: MapPoint;
  b: MapPoint;
  /** Node index of the province whose outline this is. */
  province: number;
  /** Node index of the province on the far side, or -1 for none (a coast). */
  neighbour: number;
}

/**
 * Every border to draw, each exactly once.
 *
 * Shared borders are found by position, not by matching vertices, because a
 * traced or generated outline rarely repeats its neighbour's points. Each
 * outline edge is walked in steps of twice the tolerance. At each step a
 * probe one tolerance outside the edge asks which other province is there.
 * That finds the neighbour across a gap or an overlap narrower than the
 * tolerance, and across edges that are split differently on the two sides.
 *
 * Two neighbours both walk their shared border, so the higher node index
 * leaves it to the lower. It only does so when a probe one tolerance inside
 * its own edge is clear of the neighbour, which means the neighbour's outline
 * does run here. A province drawn wholly inside another fails that test and
 * keeps its border, since the outer province has no edge there.
 */
export function provinceBorders(
  index: ProvinceIndex,
  tolerance: number,
): BorderPiece[] {
  const pieces: BorderPiece[] = [];
  const step = tolerance * 2;
  for (const province of index.nodes) {
    for (const ring of index.ringsOf(province)) {
      // The ring's winding decides which side of an edge is outside.
      const winding = ringArea2(ring) >= 0 ? 1 : -1;
      for (let i = 0; i < ring.length; i++) {
        const [x1, y1] = ring[i];
        const [x2, y2] = ring[(i + 1) % ring.length];
        const length = Math.hypot(x2 - x1, y2 - y1);
        if (length === 0) continue;
        // Unit normal pointing out of the province.
        const nx = ((y2 - y1) / length) * winding;
        const ny = (-(x2 - x1) / length) * winding;
        const count = Math.max(1, Math.ceil(length / step));
        let run: BorderPiece | null = null;
        const at = (t: number): MapPoint => [
          x1 + (x2 - x1) * t,
          y1 + (y2 - y1) * t,
        ];
        for (let s = 0; s < count; s++) {
          const [mx, my] = at((s + 0.5) / count);
          const neighbour = index.at(
            mx + nx * tolerance,
            my + ny * tolerance,
            province,
          );
          const neighbourDraws =
            neighbour >= 0 &&
            neighbour < province &&
            !index.contains(
              neighbour,
              mx - nx * tolerance,
              my - ny * tolerance,
            );
          if (neighbourDraws) {
            run = null;
            continue;
          }
          // Steps along one edge with the same neighbour join into one piece.
          if (run && run.neighbour === neighbour) {
            run.b = at((s + 1) / count);
          } else {
            run = {
              a: at(s / count),
              b: at((s + 1) / count),
              province,
              neighbour,
            };
            pieces.push(run);
          }
        }
      }
    }
  }
  return pieces;
}

/**
 * A flat ribbon along a line of world points: four vertices per segment, as
 * world positions, `width` world units wide across the ground plane. Indices
 * for segment `s` are `4s, 4s+1, 4s+2, 4s+2, 4s+1, 4s+3`.
 */
export function ribbonPositions(
  points: readonly (readonly [number, number, number])[],
  width: number,
): Float32Array {
  const segments = Math.max(0, points.length - 1);
  const out = new Float32Array(segments * 12);
  for (let s = 0; s < segments; s++) {
    const [x1, y1, z1] = points[s];
    const [x2, y2, z2] = points[s + 1];
    const len = Math.hypot(x2 - x1, z2 - z1) || 1;
    const px = (-(z2 - z1) / len) * (width / 2);
    const pz = ((x2 - x1) / len) * (width / 2);
    out.set(
      [
        x1 + px,
        y1,
        z1 + pz,
        x1 - px,
        y1,
        z1 - pz,
        x2 + px,
        y2,
        z2 + pz,
        x2 - px,
        y2,
        z2 - pz,
      ],
      s * 12,
    );
  }
  return out;
}

/* -------------------------------- style --------------------------------- */

/**
 * Per-province state set from outside the layer, through
 * `ProvinceLayer.setState`. All absent means a plain province.
 */
export interface ProvinceVisualState {
  /** The player can attack this province this turn. */
  attackable?: boolean;
  /** Picked out, for example as a neighbour of the selected province. */
  emphasised?: boolean;
  /**
   * Hidden by fog of war. The shape stays, drawn in a flat neutral tint, and
   * the owner colour, the name and the capital marker go. It cannot be
   * hovered or selected.
   */
  hidden?: boolean;
}

export interface ProvinceStyleInput extends ProvinceVisualState {
  /** No faction owns it. */
  neutral: boolean;
  hovered: boolean;
  selected: boolean;
}

export interface ProvinceStyle {
  /** Fill in the owner's colour, or in the neutral tint. */
  tint: "owner" | "neutral";
  /** Fill opacity, 0 to 1. The map picture shows through the rest. */
  opacity: number;
  /** How far the fill colour moves toward white, 0 to 1. */
  lighten: number;
  /** Whether the name label and the capital marker show. */
  showMarkers: boolean;
}

/**
 * How a province is drawn for a given state. The numbers are design values
 * chosen without seeing them on screen.
 */
export function provinceStyle(input: ProvinceStyleInput): ProvinceStyle {
  if (input.hidden) {
    return { tint: "neutral", opacity: 0.3, lighten: 0, showMarkers: false };
  }
  let opacity = input.neutral ? 0.22 : 0.42;
  let lighten = 0;
  if (input.attackable) {
    opacity += 0.1;
    lighten += 0.15;
  }
  if (input.emphasised) {
    opacity += 0.1;
    lighten += 0.1;
  }
  if (input.hovered) {
    opacity += 0.13;
    lighten += 0.2;
  }
  if (input.selected) {
    opacity += 0.2;
    lighten += 0.3;
  }
  return {
    tint: input.neutral ? "neutral" : "owner",
    opacity: Math.min(0.85, opacity),
    lighten: Math.min(0.6, lighten),
    showMarkers: true,
  };
}

/**
 * Whether the border between two provinces takes the strong line: both are
 * shown and their owners differ. A border onto a hidden province stays plain,
 * so fog gives away nothing about who holds the land behind it.
 */
export function isStrongBorder(
  ownerA: string,
  ownerB: string,
  hiddenA: boolean,
  hiddenB: boolean,
): boolean {
  return !hiddenA && !hiddenB && ownerA !== ownerB;
}
