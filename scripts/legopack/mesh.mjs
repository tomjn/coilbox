/**
 * Turns one object from the parts OBJ into a renderable, exportable part:
 * triangles, one vertex per distinct (position, normal, uv), recentred on its
 * own bounding box and identified by a hash of its geometry.
 *
 * The library ships a normal for every face corner, so this never has to guess
 * a winding convention. Each triangle is wound to agree with its own normals,
 * which is the invariant every shipped s3o model holds to and the one the
 * engine's lighting depends on.
 */

import { createHash } from "node:crypto";

import { newellNormal, tessellate } from "./tessellate.mjs";

/**
 * @typedef {object} PartMesh
 * @property {string} id content hash, stable across converter runs
 * @property {Float32Array} vertices 8 floats each: x y z nx ny nz u v
 * @property {Uint16Array} indices 3 per triangle
 * @property {string} material the material most of the part's faces use
 * @property {{ min: number[], max: number[] }} bbox after recentring
 * @property {{ min: number[], max: number[] }} uvBox
 * @property {number[]} plateOrigin where the part sat on the build plate
 * @property {object} stats
 */

/**
 * @param {import("./obj.mjs").ObjObject} object
 * @param {ReturnType<import("./obj.mjs").readObj>} source shared vertex arrays
 * @returns {PartMesh | null} null when the object has no usable geometry
 */
export function buildMesh(object, source) {
  const { positions, uvs, normals } = source;
  if (object.faces.length === 0) return null;

  let fanFallbacks = 0;
  let flipped = 0;
  let degenerate = 0;
  let cornersWithoutUv = 0;
  let cornersWithoutNormal = 0;

  const packed = [];
  const indices = [];
  const seen = new Map();
  const materialFaces = new Map();

  for (const face of object.faces) {
    materialFaces.set(
      face.material,
      (materialFaces.get(face.material) ?? 0) + 1,
    );

    const { triangles, fanFallback } = tessellate(face.corners, positions);
    if (fanFallback) fanFallbacks++;

    // The face's own plane decides which way its triangles should face. Using
    // the shipped normals rather than a winding rule means a face wound the
    // wrong way in the source still comes out right.
    const outward = faceNormal(face, positions, normals);

    for (const triangle of triangles) {
      const emitted = [];
      for (const cornerIndex of triangle) {
        const corner = face.corners[cornerIndex];
        const position = positions[corner.v];
        if (!position) continue;

        let normal = corner.vn === null ? null : normals[corner.vn];
        if (!normal) {
          cornersWithoutNormal++;
          normal = outward;
        }
        let uv = corner.vt === null ? null : uvs[corner.vt];
        if (!uv) {
          cornersWithoutUv++;
          uv = [0, 0];
        }

        const vertex = [
          Math.fround(position[0]),
          Math.fround(position[1]),
          Math.fround(position[2]),
          Math.fround(normal[0]),
          Math.fround(normal[1]),
          Math.fround(normal[2]),
          Math.fround(uv[0]),
          Math.fround(uv[1]),
        ];
        const key = vertex.join(",");
        let index = seen.get(key);
        if (index === undefined) {
          index = packed.length;
          seen.set(key, index);
          packed.push(vertex);
        }
        emitted.push(index);
      }

      if (emitted.length !== 3 || isDegenerate(emitted, packed)) {
        // Judged after rounding to float32 and merging duplicates, because a
        // triangle with area in the source can collapse to a line by here.
        degenerate++;
        continue;
      }
      if (!facesOutward(emitted, packed, outward)) {
        emitted.reverse();
        flipped++;
      }
      indices.push(...emitted);
    }
  }

  if (packed.length === 0 || indices.length === 0) return null;
  if (packed.length > 0xffff) {
    throw new Error(
      `part ${object.name} has ${packed.length} vertices, over the uint16 index limit`,
    );
  }

  // Recentre on the bounding box so a part's own origin is its middle, which is
  // what makes the derived snap anchors symmetric.
  const bbox = bounds(packed, 0, 3);
  const centre = bbox.min.map((min, i) => (min + bbox.max[i]) / 2);
  for (const vertex of packed) {
    for (let i = 0; i < 3; i++) vertex[i] = Math.fround(vertex[i] - centre[i]);
  }

  const vertices = Float32Array.from(packed.flat());
  return {
    id: hashGeometry(vertices, indices),
    vertices,
    indices: Uint16Array.from(indices),
    material: dominant(materialFaces),
    bbox: {
      min: bbox.min.map((min, i) => min - centre[i]),
      max: bbox.max.map((max, i) => max - centre[i]),
    },
    uvBox: bounds(packed, 6, 2),
    plateOrigin: centre,
    stats: {
      faces: object.faces.length,
      triangles: indices.length / 3,
      fanFallbacks,
      flipped,
      degenerate,
      cornersWithoutUv,
      cornersWithoutNormal,
    },
  };
}

/**
 * Outward direction for a face: the mean of its corner normals, falling back to
 * the polygon's own plane when it has none.
 */
function faceNormal(face, positions, normals) {
  const sum = [0, 0, 0];
  let count = 0;
  for (const corner of face.corners) {
    const normal = corner.vn === null ? null : normals[corner.vn];
    if (!normal) continue;
    for (let i = 0; i < 3; i++) sum[i] += normal[i];
    count++;
  }
  if (count > 0 && Math.hypot(...sum) > 1e-9) return sum;

  const points = face.corners
    .map((corner) => positions[corner.v])
    .filter(Boolean);
  return points.length >= 3 ? newellNormal(points) : [0, 1, 0];
}

function facesOutward([i, j, k], packed, outward) {
  const [a, b, c] = [packed[i], packed[j], packed[k]];
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const face = [
    u[1] * w[2] - u[2] * w[1],
    u[2] * w[0] - u[0] * w[2],
    u[0] * w[1] - u[1] * w[0],
  ];
  return (
    face[0] * outward[0] + face[1] * outward[1] + face[2] * outward[2] >= 0
  );
}

function isDegenerate([i, j, k], packed) {
  if (i === j || j === k || i === k) return true;
  const [a, b, c] = [packed[i], packed[j], packed[k]];
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  return (
    Math.hypot(
      u[1] * w[2] - u[2] * w[1],
      u[2] * w[0] - u[0] * w[2],
      u[0] * w[1] - u[1] * w[0],
    ) < 1e-9
  );
}

function bounds(rows, offset, width) {
  const min = new Array(width).fill(Number.POSITIVE_INFINITY);
  const max = new Array(width).fill(Number.NEGATIVE_INFINITY);
  for (const row of rows) {
    for (let i = 0; i < width; i++) {
      const value = row[offset + i];
      if (value < min[i]) min[i] = value;
      if (value > max[i]) max[i] = value;
    }
  }
  return { min, max };
}

function dominant(counts) {
  let best = "default";
  let bestCount = -1;
  for (const [material, count] of counts) {
    if (count > bestCount) {
      best = material;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Hashing the recentred geometry means two parts that differ only by where they
 * sat on the build plate collapse into one, and that ids survive a re-run so
 * saved projects keep resolving.
 */
function hashGeometry(vertices, indices) {
  const hash = createHash("sha256");
  hash.update(
    Buffer.from(vertices.buffer, vertices.byteOffset, vertices.byteLength),
  );
  hash.update(Buffer.from(Uint32Array.from(indices).buffer));
  return hash.digest("hex").slice(0, 12);
}
