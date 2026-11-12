/**
 * Cheap parts for a town's buildings. A building is copied for every lot it
 * stands on, so each part here is a few flat faces with no bevel rows: a
 * chamfered column is 22 triangles where the kit's rounded box is hundreds.
 */
import * as THREE from "three";
import { faceOut } from "../landmarks/kit";

/** A point on a plan or a profile. */
export type Pt = [number, number];
type Xyz = [number, number, number];

/**
 * A skin between two rings of the same number of points, each convex and
 * flat, closed at the far end. `floor` closes the near end too, for a part
 * whose underside shows.
 */
export function loft(a: Xyz[], b: Xyz[], floor = false): THREE.BufferGeometry {
  const n = a.length;
  const idx: number[] = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    idx.push(i, j, n + i, j, n + j, n + i);
  }
  for (let i = 1; i < n - 1; i++) idx.push(n, n + i, n + i + 1);
  // The near end goes last, so it can be dropped once the faces are turned.
  for (let i = 1; i < n - 1; i++) idx.push(0, i + 1, i);
  const g = new THREE.BufferGeometry();
  g.setAttribute(
    "position",
    new THREE.Float32BufferAttribute([...a, ...b].flat(), 3),
  );
  g.setIndex(idx);
  faceOut(g);
  if (!floor) {
    const turned = Array.from((g.index as THREE.BufferAttribute).array);
    g.setIndex(turned.slice(0, turned.length - (n - 2) * 3));
  }
  return g;
}

/** A rectangle on plan, `w` by `d` round `cx, cz`. */
export const rect = (w: number, d: number, cx = 0, cz = 0): Pt[] => [
  [cx - w / 2, cz - d / 2],
  [cx + w / 2, cz - d / 2],
  [cx + w / 2, cz + d / 2],
  [cx - w / 2, cz + d / 2],
];

/** A rectangle on plan with each corner cut back by `c`. */
export const chamfered = (
  w: number,
  d: number,
  c: number,
  cx = 0,
  cz = 0,
): Pt[] => {
  const x = w / 2;
  const z = d / 2;
  return (
    [
      [-x + c, -z],
      [x - c, -z],
      [x, -z + c],
      [x, z - c],
      [x - c, z],
      [-x + c, z],
      [-x, z - c],
      [-x, -z + c],
    ] as Pt[]
  ).map(([px, pz]) => [cx + px, cz + pz]);
};

/**
 * A column from `y0` to `y1` on the plan `foot`. Given `head`, a plan of as
 * many points, its sides lean in or out to meet it.
 */
export function column(
  foot: Pt[],
  y0: number,
  y1: number,
  head: Pt[] = foot,
): THREE.BufferGeometry {
  return loft(
    foot.map(([x, z]): Xyz => [x, y0, z]),
    head.map(([x, z]): Xyz => [x, y1, z]),
  );
}

/**
 * A slab from `y0` to `y1`, `w` wide, whose top corners are cut back by `c` in
 * two steps, so its shoulders read as round. It runs from `from` to `to` along
 * z, or along x when `alongX` is set, with `at` its centre on the other axis.
 */
export function shouldered(
  w: number,
  y0: number,
  y1: number,
  c: number,
  from: number,
  to: number,
  at = 0,
  alongX = false,
): THREE.BufferGeometry {
  const a = w / 2;
  const profile: Pt[] = [
    [-a, y0],
    [a, y0],
    [a, y1 - c],
    [a - 0.3 * c, y1 - 0.3 * c],
    [a - c, y1],
    [-a + c, y1],
    [-a + 0.3 * c, y1 - 0.3 * c],
    [-a, y1 - c],
  ];
  const ring = (along: number) =>
    profile.map(
      ([u, y]): Xyz => (alongX ? [along, y, at + u] : [at + u, y, along]),
    );
  return loft(ring(from), ring(to), true);
}
