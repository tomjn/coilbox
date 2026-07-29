/**
 * Splits a polygon face into triangles.
 *
 * Ear clipping rather than a fan, because the parts library contains faces of
 * up to twelve corners and a fan is only correct on convex ones.
 *
 * Triangles come back in the same winding as the face they came from. Deciding
 * which way a triangle should actually face is the caller's job, and the parts
 * library ships vertex normals that answer it directly.
 */

/**
 * @param {Array<{ v: number }>} corners
 * @param {Array<[number, number, number]>} positions vertex positions by index
 * @returns {{ triangles: Array<[number, number, number]>, fanFallback: boolean }}
 *   triangles index into `corners`, not into `positions`
 */
export function tessellate(corners, positions) {
  const n = corners.length;
  if (n < 3) return { triangles: [], fanFallback: false };
  if (n === 3) return { triangles: [[0, 1, 2]], fanFallback: false };

  const points = corners.map((corner) => positions[corner.v]);
  const normal = newellNormal(points);
  const axis = dominantAxis(normal);

  // Project onto the plane the face faces most directly, keeping orientation:
  // dropping axis k and taking the other two in cyclic order means the 2D
  // signed area has the same sign as normal[k].
  const [ax, ay] = [(axis + 1) % 3, (axis + 2) % 3];
  const flat = points.map((p) => [p[ax], p[ay]]);

  // Ear clipping needs a counter-clockwise polygon in 2D. Reversing to get one
  // also reverses every triangle it emits, so it has to be undone at the end.
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
    const previous = order[(ear + order.length - 1) % order.length];
    const next = order[(ear + 1) % order.length];
    triangles.push([previous, order[ear], next]);
    order.splice(ear, 1);
  }

  if (order.length !== 3) {
    // Not clippable in this projection, which in practice means a face whose
    // corners are not coplanar. A fan keeps the geometry and the caller still
    // orients each triangle, so nothing ends up facing the wrong way.
    const fanOrder = seed();
    const fan = [];
    for (let i = 1; i + 1 < n; i++) {
      fan.push(
        toLoopOrder([fanOrder[0], fanOrder[i], fanOrder[i + 1]], flipped),
      );
    }
    return { triangles: fan, fanFallback: true };
  }

  triangles.push([order[0], order[1], order[2]]);
  return {
    triangles: triangles.map((triangle) => toLoopOrder(triangle, flipped)),
    fanFallback: false,
  };
}

/** Undo the reversal ear clipping needed, so triangles match the source face. */
function toLoopOrder([a, b, c], flipped) {
  return flipped ? [a, c, b] : [a, b, c];
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
