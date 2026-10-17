/**
 * Where a unit's weight looks as if it sits, against the ground its feet or
 * wheels cover (issue #3333).
 *
 * The engine does not simulate balance, so this is about whether a unit looks
 * believable and not about how it plays. The weight is an estimate: every
 * piece's volume at one density. A heavy engine inside a hollow hull cannot be
 * said.
 *
 * Positions are the bake's, in elmos (one builder unit, #3321). The ground is
 * y = 0, which is where `sitOnGround` puts a unit's lowest point. The ground
 * plane is x and z, so a point on it is `[x, z]`.
 */

import { childrenOf, type LegoProject } from "./model";
import type { LoadedPack } from "./pack";
import type { RawGeometry } from "./rawGeometry";
import { type BakedPiece, bakedPieces } from "./s3oBuild";

/** A point on the ground: x and z. */
export type GroundPoint = [number, number];

/**
 * How far apart two baked positions may be and still count as the same one.
 *
 * This is the 1e-6 `sitOnGround` already uses to say a unit rests on the
 * ground. Rounding in a baked flat face is far smaller: `balance.test.ts` turns
 * a face of every bundled part to face down at several angles and scales, and
 * the largest spread in heights it found was 3.1e-15 elmos. Used to weld
 * vertices for the closed mesh test, to say a foot is on the ground, to pick the
 * points of a sole, and to say a support has no width.
 */
export const SAME_POSITION = 1e-6;

/** The roles that hold a unit up: a foot of any leg, and a wheel. */
export function isSupportRole(role: string | undefined): boolean {
  return role === "wheel" || /^leg\.[lr][12]\.foot$/.test(role ?? "");
}

export interface MeshVolume {
  /** Always positive, in cubic elmos. */
  volume: number;
  /** The centre of the volume. */
  centre: [number, number, number];
  /** Whether every edge is shared by exactly two triangles. */
  closed: boolean;
}

/**
 * The volume of a mesh by summing the signed volumes of the tetrahedra its
 * triangles make with the origin, and the centre of that volume.
 *
 * `closed` is false for a mesh with an open edge, and then the sum means
 * nothing. Vertices are welded by position first, since a part repeats a
 * vertex for each normal and uv it carries.
 */
export function meshVolume(
  positions: [number, number, number][],
  indices: number[],
): MeshVolume {
  const welded = new Map<string, number>();
  const ids: number[] = positions.map((p) => {
    const key = p.map((v) => Math.round(v / SAME_POSITION)).join(",");
    let id = welded.get(key);
    if (id === undefined) {
      id = welded.size;
      welded.set(key, id);
    }
    return id;
  });

  const edges = new Map<string, number>();
  let sum = 0;
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (let t = 0; t + 2 < indices.length; t += 3) {
    const corners = [indices[t], indices[t + 1], indices[t + 2]];
    for (let e = 0; e < 3; e++) {
      const from = ids[corners[e]];
      const to = ids[corners[(e + 1) % 3]];
      if (from === to) continue;
      const key = from < to ? `${from}:${to}` : `${to}:${from}`;
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
    const [a, b, c] = corners.map((i) => positions[i]);
    const signed =
      (a[0] * (b[1] * c[2] - b[2] * c[1]) -
        a[1] * (b[0] * c[2] - b[2] * c[0]) +
        a[2] * (b[0] * c[1] - b[1] * c[0])) /
      6;
    sum += signed;
    cx += (signed * (a[0] + b[0] + c[0])) / 4;
    cy += (signed * (a[1] + b[1] + c[1])) / 4;
    cz += (signed * (a[2] + b[2] + c[2])) / 4;
  }
  const closed = edges.size > 0 && [...edges.values()].every((n) => n === 2);
  if (Math.abs(sum) < 1e-12) {
    return { volume: 0, centre: [0, 0, 0], closed };
  }
  return {
    volume: Math.abs(sum),
    centre: [cx / sum, cy / sum, cz / sum],
    closed,
  };
}

/** The volume and centre of the box round some points. */
function boxVolume(positions: [number, number, number][]): MeshVolume {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const p of positions) {
    for (let axis = 0; axis < 3; axis++) {
      min[axis] = Math.min(min[axis], p[axis]);
      max[axis] = Math.max(max[axis], p[axis]);
    }
  }
  return {
    volume: (max[0] - min[0]) * (max[1] - min[1]) * (max[2] - min[2]),
    centre: [
      (min[0] + max[0]) / 2,
      (min[1] + max[1]) / 2,
      (min[2] + max[2]) / 2,
    ],
    closed: false,
  };
}

/** The convex hull of ground points, counter clockwise, by monotone chain. */
export function convexHull(points: GroundPoint[]): GroundPoint[] {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const unique = sorted.filter(
    (p, i) => i === 0 || p[0] !== sorted[i - 1][0] || p[1] !== sorted[i - 1][1],
  );
  if (unique.length < 3) return unique;
  const cross = (o: GroundPoint, a: GroundPoint, b: GroundPoint) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const build = (input: GroundPoint[]) => {
    const chain: GroundPoint[] = [];
    for (const p of input) {
      while (
        chain.length >= 2 &&
        cross(chain[chain.length - 2], chain[chain.length - 1], p) <= 0
      ) {
        chain.pop();
      }
      chain.push(p);
    }
    chain.pop();
    return chain;
  };
  return [...build(unique), ...build([...unique].reverse())];
}

/** The distance from a point to the segment between two others. */
function distanceToSegment(
  p: GroundPoint,
  a: GroundPoint,
  b: GroundPoint,
): number {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const lengthSquared = dx * dx + dz * dz;
  const along =
    lengthSquared === 0
      ? 0
      : Math.max(
          0,
          Math.min(
            1,
            ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / lengthSquared,
          ),
        );
  return Math.hypot(p[0] - (a[0] + dx * along), p[1] - (a[1] + dz * along));
}

/**
 * How far a point is from the edge of a convex counter clockwise hull,
 * positive outside it and negative inside. A hull of fewer than three points
 * has no inside, so every answer is positive.
 */
export function signedDistanceToHull(
  p: GroundPoint,
  hull: GroundPoint[],
): number {
  if (hull.length === 0) return Number.POSITIVE_INFINITY;
  if (hull.length === 1)
    return Math.hypot(p[0] - hull[0][0], p[1] - hull[0][1]);
  let nearest = Number.POSITIVE_INFINITY;
  let inside = hull.length >= 3;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i];
    const b = hull[(i + 1) % hull.length];
    nearest = Math.min(nearest, distanceToSegment(p, a, b));
    if ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) < 0) {
      inside = false;
    }
  }
  return inside ? -nearest : nearest;
}

/** How wide a set of points is: the farthest any is from the line between the
 *  two that are farthest apart. */
function width(points: GroundPoint[]): number {
  let a = points[0];
  let b = points[0];
  let best = 0;
  for (const p of points) {
    for (const q of points) {
      const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
      if (d > best) {
        best = d;
        a = p;
        b = q;
      }
    }
  }
  if (best === 0) return 0;
  let widest = 0;
  for (const p of points) {
    const off =
      Math.abs((b[0] - a[0]) * (a[1] - p[1]) - (a[0] - p[0]) * (b[1] - a[1])) /
      best;
    widest = Math.max(widest, off);
  }
  return widest;
}

export interface BalanceBasis {
  /** Pieces whose volume came from their closed mesh. */
  mesh: number;
  /** Pieces whose volume is their bounding box, because the mesh is open. */
  box: number;
}

export type BalanceResult =
  | {
      /** There is nothing to compare with, and `reason` says why. */
      status: "notApplicable";
      reason: string;
    }
  | {
      status: "noWidth" | "inside" | "outside";
      /** Under the centre of mass. */
      centre: GroundPoint;
      /** The corners of the support area, or the one or two points that
       *  stand in for it when it has no width. */
      support: GroundPoint[];
      /** Ids of the foot and wheel pieces resting on the ground. */
      resting: string[];
      /** How far the centre is outside the support area, or inside it when
       *  negative. Zero with no width, where neither is meant. */
      outsideBy: number;
      basis: BalanceBasis;
    };

interface Geometry {
  id: string;
  /** World positions of the piece's own vertices. */
  points: [number, number, number][];
  indices: number[];
}

/** Each piece's own vertices at their rest position in the unit's space. */
function worldGeometry(
  project: LegoProject,
  baked: Map<string, BakedPiece>,
): Geometry[] {
  const out: Geometry[] = [];
  const walk = (id: string, from: [number, number, number]) => {
    const piece = baked.get(id);
    if (!piece) return;
    const at: [number, number, number] = [
      from[0] + piece.offset[0],
      from[1] + piece.offset[1],
      from[2] + piece.offset[2],
    ];
    if (piece.vertices.length > 0) {
      out.push({
        id,
        points: piece.vertices.map((v) => [
          v.pos[0] + at[0],
          v.pos[1] + at[1],
          v.pos[2] + at[2],
        ]),
        indices: piece.indices,
      });
    }
    for (const child of childrenOf(project, id)) walk(child.id, at);
  };
  walk(project.rootPieceId, [0, 0, 0]);
  return out;
}

/**
 * Compare the unit's centre of mass with the ground its feet and wheels cover.
 *
 * The support area is the convex hull, seen from above, of the lowest points of
 * each foot or wheel piece that rests on the ground, which is one whose lowest
 * point is at or below y = 0 within `SAME_POSITION`. A foot above the ground
 * holds nothing up and is left out. The unit's pose is its rest pose.
 */
export function checkBalance(
  project: LegoProject,
  pack: LoadedPack,
  raw: RawGeometry | null,
): BalanceResult {
  const { pieces } = bakedPieces(project, pack, raw);
  const geometry = worldGeometry(project, pieces);

  const roles = new Map(project.pieces.map((p) => [p.id, p.role]));
  const supports = geometry.filter((g) => isSupportRole(roles.get(g.id)));
  if (supports.length === 0) {
    return {
      status: "notApplicable",
      reason:
        "No piece has a foot or wheel role, so there is no ground it stands on.",
    };
  }

  let weight = 0;
  const sum = [0, 0, 0];
  const basis: BalanceBasis = { mesh: 0, box: 0 };
  for (const g of geometry) {
    let measured = meshVolume(g.points, g.indices);
    if (measured.closed && measured.volume > 0) basis.mesh += 1;
    else {
      measured = boxVolume(g.points);
      if (measured.volume > 0) basis.box += 1;
    }
    weight += measured.volume;
    for (let axis = 0; axis < 3; axis++) {
      sum[axis] += measured.volume * measured.centre[axis];
    }
  }
  if (weight <= 0) {
    return {
      status: "notApplicable",
      reason: "The pieces have no volume to weigh.",
    };
  }
  const centre: GroundPoint = [sum[0] / weight, sum[2] / weight];

  const resting: string[] = [];
  const contacts: GroundPoint[] = [];
  let lowestSupport = Number.POSITIVE_INFINITY;
  for (const g of supports) {
    const lowest = Math.min(...g.points.map((p) => p[1]));
    lowestSupport = Math.min(lowestSupport, lowest);
    if (lowest > SAME_POSITION) continue;
    resting.push(g.id);
    for (const p of g.points) {
      if (p[1] <= lowest + SAME_POSITION) contacts.push([p[0], p[2]]);
    }
  }
  if (resting.length === 0) {
    return {
      status: "notApplicable",
      reason: `The lowest foot or wheel is ${Number(lowestSupport.toFixed(2))} elmos above the ground.`,
    };
  }

  const support = convexHull(contacts);
  if (support.length < 3 || width(support) <= SAME_POSITION) {
    return {
      status: "noWidth",
      centre,
      support,
      resting,
      outsideBy: 0,
      basis,
    };
  }
  const outsideBy = signedDistanceToHull(centre, support);
  return {
    status: outsideBy > 0 ? "outside" : "inside",
    centre,
    support,
    resting,
    outsideBy,
    basis,
  };
}

/** What the viewport says about a result, kept short. */
export function balanceSummary(result: BalanceResult): string {
  switch (result.status) {
    case "notApplicable":
      return `Balance not checked. ${result.reason}`;
    case "noWidth":
      return result.resting.length === 1
        ? "One foot or wheel on the ground, so the support area has no width."
        : "The feet or wheels on the ground are in a line, so the support area has no width.";
    case "outside":
      return `Weight centre is ${Number(result.outsideBy.toFixed(2))} elmos outside the feet.`;
    case "inside":
      return `Weight centre is ${Number((-result.outsideBy).toFixed(2))} elmos inside the feet.`;
  }
}

/** The line for the problems list, or null when there is no problem. */
export function balanceProblem(result: BalanceResult): string | null {
  return result.status === "outside"
    ? `Looks as if it would tip: the weight centre is ${Number(result.outsideBy.toFixed(2))} elmos outside the feet.`
    : null;
}
