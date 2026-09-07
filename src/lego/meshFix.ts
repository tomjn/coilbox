/**
 * Whole-piece fixes for a mesh imported from somebody else's `.s3o`: flip its
 * UVs vertically, mirror them horizontally, or recompute its vertex normals
 * from its own geometry. Upspring's three menu items for the same problem
 * (#2575): imported models arrive with upside down textures or broken
 * lighting far more often than with broken geometry, and coilbox's own parts
 * never need this because they arrive mapped by the pack.
 *
 * Pure array math, the same shape `s3oBuild.ts` and `rawGeometry.ts` already
 * read a mesh's vertices in: `x,y,z,nx,ny,nz,u,v` float32 records, addressed
 * by `vFirst`/`vCount` for the vertices and `iFirst`/`iCount` for the
 * triangle list. Nothing here mutates that buffer: two pieces can name the
 * same mesh (a duplicate keeps the original's `meshId`), so a fix is stored
 * as a flag on the piece in `model.ts` and applied wherever a piece's
 * geometry is read, never on the shared source.
 */

/** x, y, z, nx, ny, nz, u, v as float32, the s3o vertex record. */
const FLOATS_PER_VERTEX = 8;

/**
 * Two faces count as one smooth surface when their normals agree by at least
 * this much, about 63 degrees apart. From `S3DOPiece::CalcNormals`, the same
 * rule `crates/coilbox-3do/src/read.rs:12` names `SMOOTH_DOT`. Kept here only
 * to derive the default angle below: a model recalculated at its default
 * reads the same as a `.3do` the engine smoothed itself.
 */
const SMOOTH_DOT = 0.45;

/** The angle, in degrees, that `SMOOTH_DOT` is a cosine of: what the
 *  smoothing-angle field starts on before the user changes it. */
export const DEFAULT_SMOOTHING_ANGLE_DEG = Math.round(
  (Math.acos(SMOOTH_DOT) * 180) / Math.PI,
);

/** A piece's own record of which fixes to draw and export it with. Absent
 *  fields mean "as imported", so a document saved before this existed reads
 *  as fully untouched. */
export interface MeshFix {
  uvFlip?: boolean;
  uvMirror?: boolean;
  /** Present means recompute vertex normals at this many degrees rather than
   *  drawing with whichever normals the source model shipped. */
  normalsAngle?: number;
}

/** Whether a piece names geometry a fix can apply to: an imported mesh, never
 *  a part, which the pack already maps correctly by construction. */
export function canFixMesh(piece: { meshId?: string }): boolean {
  return piece.meshId !== undefined;
}

/** Whether a piece carries any fix at all, for callers deciding whether they
 *  can take a shortcut that assumes a mesh is drawn exactly as imported. */
export function hasMeshFix(piece: MeshFix): boolean {
  return (
    piece.uvFlip === true ||
    piece.uvMirror === true ||
    piece.normalsAngle !== undefined
  );
}

/**
 * A piece's UV, after whichever of its own fixes apply.
 *
 * Vertical flip is `v -> 1-v`, horizontal mirror is `u -> 1-u`, Upspring's own
 * formulas for both: the texture is assumed to fill the standard 0..1 range,
 * which is how every model this builder imports is mapped.
 */
export function fixUv(u: number, v: number, piece: MeshFix): [number, number] {
  return [piece.uvMirror ? 1 - u : u, piece.uvFlip ? 1 - v : v];
}

/**
 * What recomputing a mesh's normals produced, including any vertex a hard
 * edge needed split.
 */
export interface SplitNormals {
  /** The mesh's vertex count after splitting. `vCount` or more: never fewer,
   *  since a vertex is only ever split, never merged. */
  vertexCount: number;
  /** One normal per vertex at the new count, in local order: entry 0 is
   *  still vertex `vFirst`, and every id at or past the original `vCount` is
   *  one this call added. */
  normals: Float32Array;
  /** For each id at or past the original `vCount`, which original vertex it
   *  was split from, so a caller can copy that vertex's position and UV
   *  rather than its normal. Length `vertexCount - vCount`. */
  splitFrom: Uint32Array;
  /** The mesh's `iCount` face indices, in local order, with a corner moved
   *  onto a split id wherever its face fell on the far side of a split. */
  indices: Uint32Array;
}

/**
 * Recompute one mesh's vertex normals from its own triangles, smoothing
 * across faces that agree within `angleDeg` of each other, and splitting a
 * vertex whose adjacent faces do not all agree so each side keeps its own
 * normal.
 *
 * `smooth_normals` in `crates/coilbox-3do/src/read.rs:345-367` writes one
 * normal per face corner: a `.3do` piece's `vertex_normals` array is free to
 * disagree between two faces that share a vertex index, which is how it keeps
 * a hard edge hard while a rounded one smooths, without needing two faces at
 * a shared index to settle on one answer. An imported mesh's vertex buffer
 * cannot do that directly: three.js and the s3o writer both read one normal
 * per index. So where the faces around a vertex fall into more than one
 * group that agrees with itself within `angleDeg` but not with the others,
 * the vertex is split: the first group keeps the original id, and every
 * other group gets a new one appended past `vCount`, copying that vertex's
 * position and UV and carrying its own group's normal, with the affected
 * faces' indices moved onto it. A genuinely hard edge modelled the ordinary
 * way, as two separate vertex indices, is unaffected either way: each index
 * only ever sees its own side's faces and never has more than one group to
 * begin with.
 *
 * The grouping reuses the same `angleDeg` comparison throughout: a face
 * joins a group once its normal agrees with that group's own running average
 * within the threshold, grown until nothing ungrouped agrees with any group,
 * then a new group starts with whatever is left. A vertex whose faces are
 * all mutually within the angle ends up with exactly one group, so it is
 * never split and reads the same average this returned before splitting
 * existed.
 */
export function computeSmoothedNormals(
  vertices: Float32Array,
  indices: { readonly [index: number]: number },
  vFirst: number,
  vCount: number,
  iFirst: number,
  iCount: number,
  angleDeg: number,
): SplitNormals {
  const position = (local: number, axis: number) =>
    vertices[(vFirst + local) * FLOATS_PER_VERTEX + axis];

  const faceCount = Math.floor(iCount / 3);
  const faceNormals: [number, number, number][] = [];
  const faceCorners: [number, number, number][] = [];
  const facesAt: number[][] = Array.from({ length: vCount }, () => []);

  for (let f = 0; f < faceCount; f++) {
    // Already local to this mesh: `coilbox_s3o::Piece::triangles` indexes its
    // own `vertices`, not the shared buffer, and the import writer copies
    // that list verbatim (`crates/tauri-plugin-coilbox-lego/src/import.rs`).
    const a = indices[iFirst + f * 3];
    const b = indices[iFirst + f * 3 + 1];
    const c = indices[iFirst + f * 3 + 2];
    faceCorners.push([a, b, c]);

    const abx = position(b, 0) - position(a, 0);
    const aby = position(b, 1) - position(a, 1);
    const abz = position(b, 2) - position(a, 2);
    const acx = position(c, 0) - position(a, 0);
    const acy = position(c, 1) - position(a, 1);
    const acz = position(c, 2) - position(a, 2);
    let nx = aby * acz - abz * acy;
    let ny = abz * acx - abx * acz;
    let nz = abx * acy - aby * acx;
    const len = Math.hypot(nx, ny, nz);
    if (len > 1e-12) {
      nx /= len;
      ny /= len;
      nz /= len;
    }
    faceNormals.push([nx, ny, nz]);
    facesAt[a].push(f);
    facesAt[b].push(f);
    facesAt[c].push(f);
  }

  const threshold = Math.cos((angleDeg * Math.PI) / 180);
  const normals: number[] = new Array(vCount * 3).fill(0);
  const splitFrom: number[] = [];
  // The local id each face corner ends up addressing, defaulting to the
  // vertex it already named and only ever moved to a split id.
  const remapped: [number, number, number][] = faceCorners.map(
    (corner) => [...corner] as [number, number, number],
  );

  for (let v = 0; v < vCount; v++) {
    const faces = facesAt[v];
    if (faces.length === 0) continue;

    for (const [group, first] of groupAdjacentFaces(
      faces,
      faceNormals,
      threshold,
    )) {
      let sx = 0;
      let sy = 0;
      let sz = 0;
      for (const f of group) {
        sx += faceNormals[f][0];
        sy += faceNormals[f][1];
        sz += faceNormals[f][2];
      }
      const slen = Math.hypot(sx, sy, sz);
      if (slen > 1e-12) {
        sx /= slen;
        sy /= slen;
        sz /= slen;
      }

      // The group discovered first keeps `v`'s own id and writes into the
      // slot already reserved for it. Every other group needs a vertex of
      // its own: `normals` is already exactly `id * 3` long at this point,
      // one triple per split so far, so pushing extends it to that id.
      if (first) {
        normals[v * 3] = sx;
        normals[v * 3 + 1] = sy;
        normals[v * 3 + 2] = sz;
      } else {
        splitFrom.push(v);
        normals.push(sx, sy, sz);
      }
      const id = first ? v : vCount + splitFrom.length - 1;

      for (const f of group) {
        const corner = faceCorners[f];
        const slot = corner[0] === v ? 0 : corner[1] === v ? 1 : 2;
        remapped[f][slot] = id;
      }
    }
  }

  const outIndices = new Uint32Array(iCount);
  for (let f = 0; f < faceCount; f++) {
    outIndices[f * 3] = remapped[f][0];
    outIndices[f * 3 + 1] = remapped[f][1];
    outIndices[f * 3 + 2] = remapped[f][2];
  }
  // A trailing one or two indices short of a whole face are not part of any
  // face this walked, so they carry no group of their own and are copied
  // through unchanged, the same as they always read before splitting.
  for (let i = faceCount * 3; i < iCount; i++) {
    outIndices[i] = indices[iFirst + i];
  }

  return {
    vertexCount: vCount + splitFrom.length,
    normals: new Float32Array(normals),
    splitFrom: new Uint32Array(splitFrom),
    indices: outIndices,
  };
}

/**
 * A vertex's adjacent faces, clustered so every face in a group agrees with
 * that group's own running average within `threshold`, and no face agrees
 * with a group it was not put in.
 *
 * Greedy and order dependent, the same as the single-reference average this
 * replaced: a face joins the first group it agrees with, which then grows to
 * include it, so which group a borderline face lands in can depend on
 * iteration order. That is an accepted property of a threshold-based
 * grouping rather than a defect, and it never affects a vertex whose faces
 * all agree with each other, which is the ordinary case.
 *
 * Yields `[group, first]` pairs in the order discovered, so the caller can
 * tell the first group, which keeps the vertex's own id, from the rest,
 * which need a split vertex each.
 */
function groupAdjacentFaces(
  faceIds: readonly number[],
  faceNormals: readonly [number, number, number][],
  threshold: number,
): [number[], boolean][] {
  const remaining = [...faceIds];
  const groups: [number[], boolean][] = [];

  while (remaining.length > 0) {
    const seed = remaining.shift();
    if (seed === undefined) break;
    const group = [seed];
    let [rx, ry, rz] = faceNormals[seed];

    let grew = true;
    while (grew) {
      grew = false;
      for (let i = remaining.length - 1; i >= 0; i--) {
        const f = remaining[i];
        const [fx, fy, fz] = faceNormals[f];
        if (fx * rx + fy * ry + fz * rz > threshold) {
          group.push(f);
          remaining.splice(i, 1);
          rx += fx;
          ry += fy;
          rz += fz;
          const len = Math.hypot(rx, ry, rz);
          if (len > 1e-12) {
            rx /= len;
            ry /= len;
            rz /= len;
          }
          grew = true;
        }
      }
    }
    groups.push([group, groups.length === 0]);
  }
  return groups;
}
