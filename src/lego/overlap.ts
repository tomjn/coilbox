/**
 * The overlap check (issue #3343): pieces buried wholly inside another piece,
 * and the triangles they cost for nothing.
 *
 * A piece is buried in a holder when every vertex of its own geometry is inside
 * the holder's closed mesh or on its surface, and more of the piece's volume
 * points are strictly inside than outside. The holder is the first other piece
 * for which that is so.
 *
 * "On the surface" is within `SAME_POSITION`, the 1e-6 elmos the balance check
 * measured as the most rounding in a baked flat face (see `balance.ts`), and
 * "strictly inside" is beyond that. The volume points are what tell a block
 * stacked in the same place from a block, or a flat piece, lying against a face.
 * For a piece with a closed mesh there is one a step of twice `SAME_POSITION` in
 * from the middle of each triangle, which works for a ring or an L as well as a
 * block. A piece with an open edge has no inside, so its point is the middle of
 * its vertices. Sharing a face, a sliver of overlap and a part half in another
 * all have a vertex outside, so none is reported.
 *
 * A holder must be a closed mesh, by `meshVolume`. A mesh with an open edge has
 * no inside to test against, and its box would call a turned block's empty
 * corners solid, so such a piece holds nothing. Inside is a ray parity test.
 *
 * Positions are the bake's, in elmos, at the unit's rest pose. Only a piece's
 * own geometry counts, not its children's.
 */

import {
  type Geometry,
  meshVolume,
  SAME_POSITION,
  worldGeometry,
} from "./balance";
import type { LegoProject } from "./model";
import type { LoadedPack } from "./pack";
import { type Problem, problem } from "./problems";
import type { RawGeometry } from "./rawGeometry";
import { bakedPieces, type PieceBox } from "./s3oBuild";

export interface BuriedPiece {
  id: string;
  /** The piece whose mesh holds it. */
  holderId: string;
  /** What leaving the piece out of the model saves. */
  triangles: number;
  /** The box round the piece's own geometry, for drawing. */
  box: PieceBox;
}

export interface OverlapResult {
  buried: BuriedPiece[];
  wastedTriangles: number;
  /** How many pieces with geometry were looked at. */
  checked: number;
}

type Point = [number, number, number];

/** The mesh of a possible holder, ready to be asked about points. */
interface Solid {
  box: PieceBox;
  /** Nine numbers a triangle: the three corners. */
  tris: Float64Array;
}

/**
 * Directions for the parity ray, none along an axis or a diagonal of the
 * blocks the pack is made of. A ray that passes through an edge or a corner
 * cannot be counted, so a second and third direction are there to try next.
 */
const RAYS: Point[] = [
  [0.5773, 0.3317, 0.7461],
  [-0.2689, 0.8423, 0.4672],
  [0.1931, -0.5127, 0.8363],
].map((d) => {
  const length = Math.hypot(d[0], d[1], d[2]);
  return [d[0] / length, d[1] / length, d[2] / length] as Point;
});

/**
 * How close to an edge, in the triangle's own units from 0 to 1, a ray may hit
 * before its count is not trusted and the next direction is used. It decides
 * which ray answers, never the result of the check.
 */
const EDGE_MARGIN = 1e-9;

function boxOf(points: Point[]): PieceBox {
  const min: Point = [Infinity, Infinity, Infinity];
  const max: Point = [-Infinity, -Infinity, -Infinity];
  for (const p of points) {
    for (let axis = 0; axis < 3; axis++) {
      if (p[axis] < min[axis]) min[axis] = p[axis];
      if (p[axis] > max[axis]) max[axis] = p[axis];
    }
  }
  return { min, max };
}

function sub(a: Point, b: Point): Point {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function dot(a: Point, b: Point): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function cross(a: Point, b: Point): Point {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

/** Squared distance from a point to a triangle (Ericson, Real-Time Collision Detection 5.1.5). */
function distanceSquared(p: Point, a: Point, b: Point, c: Point): number {
  const ab = sub(b, a);
  const ac = sub(c, a);
  const ap = sub(p, a);
  const d1 = dot(ab, ap);
  const d2 = dot(ac, ap);
  let closest: Point;
  if (d1 <= 0 && d2 <= 0) closest = a;
  else {
    const bp = sub(p, b);
    const d3 = dot(ab, bp);
    const d4 = dot(ac, bp);
    if (d3 >= 0 && d4 <= d3) closest = b;
    else {
      const vc = d1 * d4 - d3 * d2;
      if (vc <= 0 && d1 >= 0 && d3 <= 0) {
        const v = d1 / (d1 - d3);
        closest = [a[0] + v * ab[0], a[1] + v * ab[1], a[2] + v * ab[2]];
      } else {
        const cp = sub(p, c);
        const d5 = dot(ab, cp);
        const d6 = dot(ac, cp);
        if (d6 >= 0 && d5 <= d6) closest = c;
        else {
          const vb = d5 * d2 - d1 * d6;
          if (vb <= 0 && d2 >= 0 && d6 <= 0) {
            const w = d2 / (d2 - d6);
            closest = [a[0] + w * ac[0], a[1] + w * ac[1], a[2] + w * ac[2]];
          } else {
            const va = d3 * d6 - d5 * d4;
            if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
              const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
              closest = [
                b[0] + w * (c[0] - b[0]),
                b[1] + w * (c[1] - b[1]),
                b[2] + w * (c[2] - b[2]),
              ];
            } else {
              const denom = 1 / (va + vb + vc);
              const v = vb * denom;
              const w = vc * denom;
              closest = [
                a[0] + ab[0] * v + ac[0] * w,
                a[1] + ab[1] * v + ac[1] * w,
                a[2] + ab[2] * v + ac[2] * w,
              ];
            }
          }
        }
      }
    }
  }
  const d = sub(p, closest);
  return dot(d, d);
}

type Where = "inside" | "on" | "outside";

/** Whether a point is inside a closed mesh, on its surface, or outside it. */
function locate(p: Point, solid: Solid): Where {
  const { min, max } = solid.box;
  for (let axis = 0; axis < 3; axis++) {
    if (p[axis] < min[axis] - SAME_POSITION) return "outside";
    if (p[axis] > max[axis] + SAME_POSITION) return "outside";
  }
  const tol2 = SAME_POSITION * SAME_POSITION;
  const t = solid.tris;
  const hits = RAYS.map(() => 0);
  const unsure = RAYS.map(() => false);
  for (let i = 0; i < t.length; i += 9) {
    const a: Point = [t[i], t[i + 1], t[i + 2]];
    const b: Point = [t[i + 3], t[i + 4], t[i + 5]];
    const c: Point = [t[i + 6], t[i + 7], t[i + 8]];
    if (distanceSquared(p, a, b, c) <= tol2) return "on";
    const e1 = sub(b, a);
    const e2 = sub(c, a);
    const origin = sub(p, a);
    const q = cross(origin, e1);
    for (let r = 0; r < RAYS.length; r++) {
      if (unsure[r]) continue;
      const d = RAYS[r];
      const pv = cross(d, e2);
      const det = dot(e1, pv);
      // Parallel to the triangle: a neighbour meets the ray if it crosses.
      if (Math.abs(det) < 1e-12) continue;
      const u = dot(origin, pv) / det;
      const v = dot(d, q) / det;
      const w = 1 - u - v;
      if (u < -EDGE_MARGIN || v < -EDGE_MARGIN || w < -EDGE_MARGIN) continue;
      if (u < EDGE_MARGIN || v < EDGE_MARGIN || w < EDGE_MARGIN) {
        unsure[r] = true;
        continue;
      }
      if (dot(e2, q) / det > 0) hits[r] += 1;
    }
  }
  let ray = unsure.findIndex((flag) => !flag);
  if (ray < 0) ray = 0;
  return hits[ray] % 2 === 1 ? "inside" : "outside";
}

interface Candidate {
  id: string;
  points: Point[];
  box: PieceBox;
  /** The points once, however many normals and uvs repeat them. */
  unique: Point[];
  /** The points that must be strictly inside the holder. */
  witnesses: Point[];
  triangles: number;
  geometry: Geometry;
  solid?: Solid | null;
}

/** How far in from a closed piece's surface a strict point is taken. */
const WITNESS_STEP = 2 * SAME_POSITION;

/**
 * The points that show a piece has volume inside its holder. A closed piece
 * gives one a triangle, a step in from its middle along the normal pointing
 * into the piece, and a triangle with no area gives none. An open piece, which
 * has no inside, gives the middle of its vertices.
 */
function witnessesOf(geometry: Geometry, unique: Point[]): Point[] {
  const { points, indices } = geometry;
  const measured = meshVolume(points, indices);
  if (!measured.closed || measured.volume <= 0) {
    const sum = unique.reduce<Point>(
      (s, p) => [s[0] + p[0], s[1] + p[1], s[2] + p[2]],
      [0, 0, 0],
    );
    return [
      [sum[0] / unique.length, sum[1] / unique.length, sum[2] / unique.length],
    ];
  }
  // The signed volume says which way the triangles wind: outward when positive.
  let signed = 0;
  const found: Point[] = [];
  const corners: [Point, Point, Point][] = [];
  for (let t = 0; t + 2 < indices.length; t += 3) {
    const a = points[indices[t]];
    const b = points[indices[t + 1]];
    const c = points[indices[t + 2]];
    signed += dot(a, cross(b, c)) / 6;
    corners.push([a, b, c]);
  }
  const inward = signed > 0 ? -1 : 1;
  for (const [a, b, c] of corners) {
    const normal = cross(sub(b, a), sub(c, a));
    const length = Math.hypot(normal[0], normal[1], normal[2]);
    if (length <= SAME_POSITION * SAME_POSITION) continue;
    const scale = (inward * WITNESS_STEP) / length;
    found.push([
      (a[0] + b[0] + c[0]) / 3 + normal[0] * scale,
      (a[1] + b[1] + c[1]) / 3 + normal[1] * scale,
      (a[2] + b[2] + c[2]) / 3 + normal[2] * scale,
    ]);
  }
  return found;
}

function uniquePoints(points: Point[]): Point[] {
  const seen = new Set<string>();
  const out: Point[] = [];
  for (const p of points) {
    const key = p.map((v) => Math.round(v / SAME_POSITION)).join(",");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

/** The mesh as a holder, or null when it is not a closed solid. */
function solidOf(candidate: Candidate): Solid | null {
  if (candidate.solid !== undefined) return candidate.solid;
  const { points, indices } = candidate.geometry;
  const measured = meshVolume(points, indices);
  if (!measured.closed || measured.volume <= 0) {
    candidate.solid = null;
    return null;
  }
  const tris = new Float64Array(indices.length * 3);
  for (let i = 0; i < indices.length; i++) {
    tris.set(points[indices[i]], i * 3);
  }
  candidate.solid = { box: candidate.box, tris };
  return candidate.solid;
}

function insideBox(inner: PieceBox, outer: PieceBox): boolean {
  for (let axis = 0; axis < 3; axis++) {
    if (inner.min[axis] < outer.min[axis] - SAME_POSITION) return false;
    if (inner.max[axis] > outer.max[axis] + SAME_POSITION) return false;
  }
  return true;
}

function buriedIn(piece: Candidate, holder: Candidate): boolean {
  const solid = solidOf(holder);
  if (!solid) return false;
  for (const p of piece.unique) {
    if (locate(p, solid) === "outside") return false;
  }
  // A few triangles in a part wind the wrong way, which sends their point out
  // instead of in, so more points inside than outside decides it. A flat piece
  // lying on a face has as many on each side and is not buried.
  let inside = 0;
  let outside = 0;
  for (const p of piece.witnesses) {
    const where = locate(p, solid);
    if (where === "inside") inside += 1;
    else if (where === "outside") outside += 1;
  }
  return inside > outside;
}

/**
 * Find the pieces buried in another. Boxes go first, so the exact test runs
 * only for a pair where the piece's box lies in the holder's.
 */
export function checkOverlap(
  project: LegoProject,
  pack: LoadedPack,
  raw: RawGeometry | null,
): OverlapResult {
  const { pieces } = bakedPieces(project, pack, raw);
  const candidates: Candidate[] = worldGeometry(project, pieces)
    .filter((g) => g.indices.length >= 3)
    .map((geometry) => {
      const unique = uniquePoints(geometry.points);
      return {
        id: geometry.id,
        points: geometry.points,
        box: boxOf(geometry.points),
        unique,
        witnesses: witnessesOf(geometry, unique),
        triangles: geometry.indices.length / 3,
        geometry,
      };
    });

  const order = new Map(project.pieces.map((p, i) => [p.id, i]));
  const holders = new Map<string, Candidate>();
  for (const piece of candidates) {
    for (const holder of candidates) {
      if (holder === piece || !insideBox(piece.box, holder.box)) continue;
      if (buriedIn(piece, holder)) {
        holders.set(piece.id, holder);
        break;
      }
    }
  }

  const buried: BuriedPiece[] = [];
  for (const piece of candidates) {
    const holder = holders.get(piece.id);
    if (!holder) continue;
    // Two copies in one place are each buried in the other. Keep the one added
    // later, which is the one the game maker most likely meant to move.
    if (
      holders.get(holder.id)?.id === piece.id &&
      (order.get(piece.id) ?? 0) < (order.get(holder.id) ?? 0)
    ) {
      continue;
    }
    buried.push({
      id: piece.id,
      holderId: holder.id,
      triangles: piece.triangles,
      box: piece.box,
    });
  }
  return {
    buried,
    wastedTriangles: buried.reduce((sum, b) => sum + b.triangles, 0),
    checked: candidates.length,
  };
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/** The line the viewport shows while the check is on. */
export function overlapSummary(result: OverlapResult): string {
  if (result.buried.length === 0) return "No buried pieces.";
  return `${plural(result.buried.length, "buried piece")} ${
    result.buried.length === 1 ? "wastes" : "waste"
  } ${plural(result.wastedTriangles, "triangle")}.`;
}

/** Pieces named before the list says "and N more". */
const LISTED = 3;

/**
 * The problems for the list. Each buried piece is about itself and the piece
 * holding it. The line after the first few is about all the rest.
 */
export function overlapProblems(
  project: LegoProject,
  result: OverlapResult,
): Problem[] {
  const name = (id: string) =>
    project.pieces.find((p) => p.id === id)?.name ?? id;
  const lines = result.buried
    .slice(0, LISTED)
    .map((b) =>
      problem(
        "overlap",
        "warning",
        `${name(b.id)} is buried inside ${name(b.holderId)} and wastes ${plural(b.triangles, "triangle")}.`,
        [b.id, b.holderId],
      ),
    );
  const rest = result.buried.slice(LISTED);
  if (rest.length > 0) {
    lines.push(
      problem(
        "overlap",
        "warning",
        `And ${rest.length} more. Buried pieces waste ${plural(result.wastedTriangles, "triangle")} in all.`,
        [...new Set(rest.flatMap((b) => [b.id, b.holderId]))],
      ),
    );
  }
  return lines;
}
