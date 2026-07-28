/**
 * Smoothing-group normals that respect Wings' hard edges.
 *
 * A corner is a (vertex, face) pair. Two corners at the same vertex share a
 * normal when the edge between their faces is soft, so hard edges split the
 * fan and give a crease. Union-find over corners does this in one pass.
 *
 * Face normals point outward. Wings hands back loops that run clockwise seen
 * from outside, so Newell's method on a raw loop points inward and is negated
 * here. Keeping that in one place means the rest of the converter can treat
 * normals as outward without thinking about it.
 */

import { newellNormal } from "./winged.mjs";

/**
 * @param {import("./wings.mjs").WingsObject} object
 * @param {ReturnType<import("./winged.mjs").faceLoops>} loops
 * @returns {Array<Array<[number, number, number]>>} one normal per corner, in
 *   the same shape as `loops`
 */
export function cornerNormals(object, loops) {
  const faceNormals = loops.map((loop) => {
    const points = loop.corners.map((corner) => object.vertices[corner.v]);
    const inward = newellNormal(points);
    return [-inward[0], -inward[1], -inward[2]];
  });

  // Index every corner so union-find can work on plain arrays.
  const cornerId = new Map();
  const ids = [];
  for (let face = 0; face < loops.length; face++) {
    for (const corner of loops[face].corners) {
      const key = `${corner.v}:${face}`;
      if (!cornerId.has(key)) {
        cornerId.set(key, ids.length);
        ids.push({ vertex: corner.v, face });
      }
    }
  }

  const parent = ids.map((_, i) => i);
  const find = (i) => {
    let root = i;
    while (parent[root] !== root) root = parent[root];
    while (parent[i] !== root) {
      const next = parent[i];
      parent[i] = root;
      i = next;
    }
    return root;
  };
  const union = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };

  for (let e = 0; e < object.edges.length; e++) {
    if (object.hardEdges.has(e)) continue;
    const { vs, ve, lf, rf } = object.edges[e];
    joinAcross(cornerId, union, vs, lf, rf);
    joinAcross(cornerId, union, ve, lf, rf);
  }

  // Area-weighted sum per group: Newell's magnitude is proportional to area, so
  // large faces dominate a crease the way they should.
  const sums = ids.map(() => [0, 0, 0]);
  for (let i = 0; i < ids.length; i++) {
    const sum = sums[find(i)];
    const n = faceNormals[ids[i].face];
    sum[0] += n[0];
    sum[1] += n[1];
    sum[2] += n[2];
  }

  return loops.map((loop, face) => {
    const own = normalise(faceNormals[face]) ?? [0, 1, 0];
    return loop.corners.map((corner) => {
      const i = cornerId.get(`${corner.v}:${face}`);
      const smoothed = normalise(sums[find(i)]);
      // A group whose average points away from the face it belongs to is not a
      // smoothing group in any useful sense. It happens on thin parts where a
      // soft rim joins a face to the one directly behind it, and the two nearly
      // cancel. Using the face's own normal there keeps every corner within a
      // right angle of the surface it sits on, so nothing shades inside out.
      if (!smoothed || dot(smoothed, own) <= 0) return own;
      return smoothed;
    });
  });
}

function joinAcross(cornerId, union, vertex, faceA, faceB) {
  const a = cornerId.get(`${vertex}:${faceA}`);
  const b = cornerId.get(`${vertex}:${faceB}`);
  // A vertex can sit on an edge without being a corner of both its faces.
  if (a !== undefined && b !== undefined) union(a, b);
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function normalise([x, y, z]) {
  const length = Math.hypot(x, y, z);
  if (!(length > 1e-12)) return null;
  return [x / length, y / length, z / length];
}
