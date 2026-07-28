/**
 * Winged-edge to triangles, with per-corner UVs.
 *
 * Two conventions are pinned here, both verified against `legosv2.wings` rather
 * than assumed:
 *
 * 1. Traversal. Following Wings' own `wings_face:fold`, a face `f` is walked by
 *    taking `vs` and successor `ltsu` when `lf === f`, and `ve` and `rtsu` when
 *    `rf === f`. The UV pairing follows from `wings_va:edge_attrs`, which
 *    documents the left attribute as belonging to `vs` and the right to `ve`,
 *    so `uvLt` goes with the `lf` case and `uvRt` with the `rf` case. Every one
 *    of the 212,096 face loops in the parts file closes under this rule.
 *
 * 2. Winding. Wings hands back loops that run clockwise seen from outside the
 *    solid, so `triangulate` reverses them. Checked on the 950 closed boxes in
 *    the parts file: all 5,700 of their faces wind inward under Wings order,
 *    none outward. s3o wants counter-clockwise front faces.
 */

/**
 * Walk every face of an object.
 *
 * Corners come back in Wings order, so callers that care about winding should
 * go through `triangulate` rather than reading these directly.
 *
 * @param {import("./wings.mjs").WingsObject} object
 * @returns {Array<{ material: string, corners: Array<{ v: number, uv: [number, number] | null }> }>}
 */
export function faceLoops(object) {
  const { edges, faceMaterials } = object;
  const faceCount = faceMaterials.length;

  // Any incident edge will do as a starting point.
  const firstEdge = new Array(faceCount).fill(-1);
  for (let i = 0; i < edges.length; i++) {
    const { lf, rf } = edges[i];
    if (firstEdge[lf] === -1) firstEdge[lf] = i;
    if (firstEdge[rf] === -1) firstEdge[rf] = i;
  }

  const loops = [];
  for (let face = 0; face < faceCount; face++) {
    const start = firstEdge[face];
    if (start === -1) {
      throw new Error(`face ${face} has no incident edge`);
    }

    const corners = [];
    let at = start;
    do {
      const edge = edges[at];
      if (edge.lf === face) {
        corners.push({ v: edge.vs, uv: edge.uvLt });
        at = edge.ltsu;
      } else if (edge.rf === face) {
        corners.push({ v: edge.ve, uv: edge.uvRt });
        at = edge.rtsu;
      } else {
        throw new Error(`edge ${at} is not on face ${face}`);
      }
      if (corners.length > edges.length) {
        throw new Error(`face ${face} loop did not close`);
      }
    } while (at !== start);

    loops.push({ material: faceMaterials[face], corners });
  }
  return loops;
}

/**
 * Split a face loop into triangles wound counter-clockwise for s3o.
 *
 * Ear clipping rather than a fan, because the parts file contains faces of up
 * to 16 corners and a fan is only safe on convex ones.
 *
 * @param {Array<{ v: number }>} corners
 * @param {Array<[number, number, number]>} positions vertex positions by id
 * @returns {{ triangles: Array<[number, number, number]>, fanFallback: boolean,
 *   corrected: number }} triangles index into `corners`, not into `positions`
 */
export function triangulate(corners, positions) {
  const n = corners.length;
  if (n < 3) return { triangles: [], fanFallback: false, corrected: 0 };
  if (n === 3)
    return { triangles: [[0, 2, 1]], fanFallback: false, corrected: 0 };

  const points = corners.map((corner) => positions[corner.v]);
  const normal = newellNormal(points);
  const axis = dominantAxis(normal);

  // Project onto the plane the face faces most directly, keeping orientation:
  // dropping axis k and taking the other two in cyclic order means the 2D
  // signed area has the same sign as normal[k].
  const [ax, ay] = [(axis + 1) % 3, (axis + 2) % 3];
  const flat = points.map((p) => [p[ax], p[ay]]);

  // Ear clipping wants a counter-clockwise polygon in 2D. Reversing to get one
  // also reverses the winding of every triangle it emits, so `flipped` has to
  // be carried through to the end.
  const flipped = normal[axis] < 0;
  const seed = () => {
    const order = flat.map((_, i) => i);
    if (flipped) order.reverse();
    return order;
  };

  const order = seed();
  const triangles = [];
  let guard = n * n;
  while (order.length > 3 && guard-- > 0) {
    const ear = findEar(order, flat);
    if (ear === -1) break;
    const prev = order[(ear + order.length - 1) % order.length];
    const next = order[(ear + 1) % order.length];
    triangles.push([prev, order[ear], next]);
    order.splice(ear, 1);
  }

  if (order.length !== 3) {
    // Not clippable in this projection, which in practice means a face whose
    // corners are not coplanar. A fan keeps the geometry, and the winding
    // correction below stops it emitting anything inside out.
    const fanOrder = seed();
    const fan = [];
    for (let i = 1; i + 1 < n; i++) {
      fan.push(
        toS3oWinding([fanOrder[0], fanOrder[i], fanOrder[i + 1]], flipped),
      );
    }
    return {
      ...faceOutward(fan, corners, positions, normal),
      fanFallback: true,
    };
  }

  triangles.push([order[0], order[1], order[2]]);
  return {
    ...faceOutward(
      triangles.map((triangle) => toS3oWinding(triangle, flipped)),
      corners,
      positions,
      normal,
    ),
    fanFallback: false,
  };
}

/**
 * Last line of defence: every triangle must face the same way as its parent
 * face, so nothing ever renders inside out.
 *
 * On a flat face this is a no-op, which is the normal case. It earns its keep
 * on the faces whose corners are not coplanar, where projecting to a plane can
 * put a triangle the wrong way round.
 *
 * `wingsNormal` is the raw Newell normal of the loop, so it points inward and
 * an outward-facing triangle disagrees with it.
 */
function faceOutward(triangles, corners, positions, wingsNormal) {
  let corrected = 0;
  const fixed = triangles.map((triangle) => {
    const [a, b, c] = triangle.map((i) => positions[corners[i].v]);
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const face = [
      u[1] * w[2] - u[2] * w[1],
      u[2] * w[0] - u[0] * w[2],
      u[0] * w[1] - u[1] * w[0],
    ];
    const alignment =
      face[0] * wingsNormal[0] +
      face[1] * wingsNormal[1] +
      face[2] * wingsNormal[2];
    if (alignment <= 0) return triangle;
    corrected++;
    return reverseWinding(triangle);
  });
  return { triangles: fixed, corrected };
}

/**
 * Two corrections at once. A clipped triangle follows the projected polygon, so
 * when that was reversed it needs flipping back into loop order. Then the loop
 * itself is reversed, because Wings winds clockwise seen from outside and s3o
 * wants counter-clockwise. The two cancel when the polygon was flipped.
 */
function toS3oWinding(triangle, flipped) {
  return flipped ? triangle : reverseWinding(triangle);
}

function reverseWinding([a, b, c]) {
  return [a, c, b];
}

function findEar(order, flat) {
  const count = order.length;
  for (let i = 0; i < count; i++) {
    const a = flat[order[(i + count - 1) % count]];
    const b = flat[order[i]];
    const c = flat[order[(i + 1) % count]];
    if (cross2(a, b, c) <= 0) continue; // reflex or degenerate

    let clear = true;
    for (let j = 0; j < count && clear; j++) {
      if (j === i || j === (i + count - 1) % count || j === (i + 1) % count)
        continue;
      if (inTriangle(flat[order[j]], a, b, c)) clear = false;
    }
    if (clear) return i;
  }
  return -1;
}

function cross2(a, b, c) {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function inTriangle(p, a, b, c) {
  return cross2(a, b, p) >= 0 && cross2(b, c, p) >= 0 && cross2(c, a, p) >= 0;
}

/** Newell's method: works on any planar-ish polygon, convex or not. */
export function newellNormal(points) {
  let x = 0;
  let y = 0;
  let z = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    x += (a[1] - b[1]) * (a[2] + b[2]);
    y += (a[2] - b[2]) * (a[0] + b[0]);
    z += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return [x, y, z];
}

function dominantAxis(normal) {
  const abs = normal.map(Math.abs);
  if (abs[0] >= abs[1] && abs[0] >= abs[2]) return 0;
  return abs[1] >= abs[2] ? 1 : 2;
}
