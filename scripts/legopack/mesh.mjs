/**
 * Turns one Wings object into a renderable, exportable part: triangles, one
 * vertex per distinct (position, normal, uv), recentred on its own bounding box
 * and identified by a hash of its geometry.
 */

import { createHash } from "node:crypto";

import { cornerNormals } from "./normals.mjs";
import { faceLoops, triangulate } from "./winged.mjs";

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
 * @param {import("./wings.mjs").WingsObject} object
 * @returns {PartMesh | null} null when the object has no geometry
 */
export function buildMesh(object) {
  if (object.edges.length === 0 || object.vertices.length === 0) return null;

  const loops = faceLoops(object);
  const normals = cornerNormals(object, loops);

  const fill = meanUv(loops);
  let cornersWithoutUv = 0;
  let facesWithoutUv = 0;
  let fanFallbacks = 0;
  let windingCorrections = 0;
  let degenerate = 0;

  const positions = [];
  const packed = [];
  const indices = [];
  const seen = new Map();
  const materialFaces = new Map();

  for (let face = 0; face < loops.length; face++) {
    const loop = loops[face];
    if (loop.corners.every((corner) => corner.uv === null)) facesWithoutUv++;
    materialFaces.set(
      loop.material,
      (materialFaces.get(loop.material) ?? 0) + 1,
    );

    const { triangles, fanFallback, corrected } = triangulate(
      loop.corners,
      object.vertices,
    );
    if (fanFallback) fanFallbacks++;
    windingCorrections += corrected;

    for (const triangle of triangles) {
      const emitted = [];
      for (const cornerIndex of triangle) {
        const corner = loop.corners[cornerIndex];
        const pos = object.vertices[corner.v];
        const normal = normals[face][cornerIndex];
        let uv = corner.uv;
        if (uv === null) {
          cornersWithoutUv++;
          uv = fill;
        }

        const vertex = [
          Math.fround(pos[0]),
          Math.fround(pos[1]),
          Math.fround(pos[2]),
          Math.fround(normal[0]),
          Math.fround(normal[1]),
          Math.fround(normal[2]),
          // Some parts sample a neighbouring atlas column through negative u,
          // so uvs are not clamped to 0..1 and the texture must repeat.
          Math.fround(uv[0]),
          Math.fround(uv[1]),
        ];
        const key = vertex.join(",");
        let index = seen.get(key);
        if (index === undefined) {
          index = packed.length;
          seen.set(key, index);
          packed.push(vertex);
          positions.push(vertex.slice(0, 3));
        }
        emitted.push(index);
      }

      // Degeneracy has to be judged here rather than on the source positions.
      // Vertices are rounded to float32 and then merged, so a triangle that had
      // area in the Wings file can collapse to a line or a point by this point.
      // Keeping one would draw nothing and leave the engine unable to compute a
      // normal for it.
      if (isDegenerate(emitted, packed)) {
        degenerate++;
        continue;
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
  const bbox = bounds(positions, 3);
  const centre = bbox.min.map((min, i) => (min + bbox.max[i]) / 2);
  for (const vertex of packed) {
    for (let i = 0; i < 3; i++) vertex[i] = Math.fround(vertex[i] - centre[i]);
  }

  const vertices = Float32Array.from(packed.flat());
  const uvBox = bounds(
    packed.map((v) => v.slice(6, 8)),
    2,
  );

  return {
    id: hashGeometry(vertices, indices),
    vertices,
    indices: Uint16Array.from(indices),
    material: dominant(materialFaces),
    bbox: {
      min: bbox.min.map((min, i) => min - centre[i]),
      max: bbox.max.map((max, i) => max - centre[i]),
    },
    uvBox,
    plateOrigin: centre,
    stats: {
      faces: loops.length,
      triangles: indices.length / 3,
      fanFallbacks,
      windingCorrections,
      degenerate,
      facesWithoutUv,
      cornersWithoutUv,
    },
  };
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

/**
 * A face Wings never unwrapped has no UV at all. Rather than sending it to the
 * atlas origin, which is an arbitrary colour, give it the part's average UV so
 * it blends with the rest of the part. Parts where this happens are flagged in
 * the manifest.
 */
function meanUv(loops) {
  let u = 0;
  let v = 0;
  let count = 0;
  for (const loop of loops) {
    for (const corner of loop.corners) {
      if (corner.uv === null) continue;
      u += corner.uv[0];
      v += corner.uv[1];
      count++;
    }
  }
  return count === 0 ? [0, 0] : [u / count, v / count];
}

function bounds(rows, width) {
  const min = new Array(width).fill(Number.POSITIVE_INFINITY);
  const max = new Array(width).fill(Number.NEGATIVE_INFINITY);
  for (const row of rows) {
    for (let i = 0; i < width; i++) {
      if (row[i] < min[i]) min[i] = row[i];
      if (row[i] > max[i]) max[i] = row[i];
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
