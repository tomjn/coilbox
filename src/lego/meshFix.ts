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
 * Recompute one mesh's vertex normals from its own triangles, smoothing
 * across faces that agree within `angleDeg` of each other.
 *
 * `smooth_normals` in `crates/coilbox-3do/src/read.rs:345-367` writes one
 * normal per face corner: a `.3do` piece's `vertex_normals` array is free to
 * disagree between two faces that share a vertex index, which is how it keeps
 * a hard edge hard while a rounded one smooths, without needing two faces at
 * a shared index to settle on one answer. An imported mesh's vertex buffer
 * cannot do that: three.js and the s3o writer both read one normal per index,
 * and there is nowhere to keep two corners of one vertex apart without
 * duplicating the vertex itself, which would change `vCount` and this builder
 * has nowhere to put a bigger mesh back. So this computes one normal per
 * vertex instead: the average of every adjacent face, then averaged again
 * over only the faces that agree with that average within `angleDeg`. A
 * genuinely hard edge modelled the ordinary way, as two separate vertex
 * indices, is unaffected either way: each index only ever sees its own side's
 * faces. One a source model instead left as a single shared index across a
 * sharp corner comes out softened rather than sharp, which is the one case
 * this does not reproduce byte-for-byte against a tool that can split
 * vertices.
 *
 * Returns one normal per vertex in the mesh, `vCount * 3` floats, in the
 * mesh's own local order: entry 0 is vertex `vFirst`.
 */
export function computeSmoothedNormals(
  vertices: Float32Array,
  indices: { readonly [index: number]: number },
  vFirst: number,
  vCount: number,
  iFirst: number,
  iCount: number,
  angleDeg: number,
): Float32Array {
  const position = (local: number, axis: number) =>
    vertices[(vFirst + local) * FLOATS_PER_VERTEX + axis];

  const faceCount = Math.floor(iCount / 3);
  const faceNormals: [number, number, number][] = [];
  const facesAt: number[][] = Array.from({ length: vCount }, () => []);

  for (let f = 0; f < faceCount; f++) {
    // Already local to this mesh: `coilbox_s3o::Piece::triangles` indexes its
    // own `vertices`, not the shared buffer, and the import writer copies
    // that list verbatim (`crates/tauri-plugin-coilbox-lego/src/import.rs`).
    const a = indices[iFirst + f * 3];
    const b = indices[iFirst + f * 3 + 1];
    const c = indices[iFirst + f * 3 + 2];

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
  const out = new Float32Array(vCount * 3);
  for (let v = 0; v < vCount; v++) {
    const faces = facesAt[v];
    if (faces.length === 0) continue;

    // First pass: the plain average of every adjacent face, as the reference
    // direction the angle is measured against. Symmetric and order
    // independent, unlike picking one adjacent face to measure the others
    // against.
    let rx = 0;
    let ry = 0;
    let rz = 0;
    for (const f of faces) {
      rx += faceNormals[f][0];
      ry += faceNormals[f][1];
      rz += faceNormals[f][2];
    }
    const rlen = Math.hypot(rx, ry, rz);
    if (rlen > 1e-12) {
      rx /= rlen;
      ry /= rlen;
      rz /= rlen;
    }

    // Second pass: only the faces that agree with that reference contribute
    // to the final normal, so a face folded sharply away from the rest does
    // not drag the average toward it.
    let sx = 0;
    let sy = 0;
    let sz = 0;
    for (const f of faces) {
      const [fx, fy, fz] = faceNormals[f];
      if (fx * rx + fy * ry + fz * rz > threshold) {
        sx += fx;
        sy += fy;
        sz += fz;
      }
    }
    let slen = Math.hypot(sx, sy, sz);
    if (slen <= 1e-12) {
      // Nothing agreed with the reference, which only happens when every
      // adjacent face is folded away from every other by more than the
      // reference allows: fall back to the reference itself rather than a
      // zero vector.
      [sx, sy, sz] = [rx, ry, rz];
      slen = 1;
    } else {
      sx /= slen;
      sy /= slen;
      sz /= slen;
    }
    out[v * 3] = sx;
    out[v * 3 + 1] = sy;
    out[v * 3 + 2] = sz;
  }
  return out;
}
