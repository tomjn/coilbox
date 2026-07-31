/**
 * Recovering a project from an `.s3o` coilbox exported.
 *
 * This is the inverse of `s3oBuild.ts`, and only of that. An `.s3o` is baked
 * geometry with no parts in it, so geometry that did not come out of the parts
 * pack cannot be turned back into pieces at all: see the measurements on
 * https://github.com/tomjn/coilbox/issues/581. What can be undone is coilbox's
 * own bake, because every vertex it wrote was copied from a part.
 *
 * A file is coilbox's when every piece that has geometry carries a part's UVs
 * verbatim. UVs are the one thing the bake never touches: positions go through
 * the piece's rotation and scale and normals through the inverse transpose, but
 * a UV is copied across as it stands. They are also what tells two parts apart,
 * since a colourway family shares its mesh and differs only in where it samples
 * the atlas, and every one of the bundled pack's 373 parts has a UV stream no
 * other part has. Matching on them cannot half-recognise a model: either every
 * piece is a part or the file is somebody else's and is refused.
 *
 * The texture the header names is not part of that test. An export writes
 * `coilbox_<atlas>`, which says which atlas the unit sampled and is worth
 * reading, but a file can be renamed and a game can rename a texture, so it
 * confirms an atlas rather than deciding whether the file is ours.
 *
 * Pure: no Tauri, no renderer. `lego_read_s3o` parses the file, using the same
 * `coilbox-s3o` crate that wrote it.
 */

import * as THREE from "three";

import { exportTextureName, type LegoAtlas } from "./atlas";
import { LEGO_SCHEMA_VERSION, type LegoPiece, type LegoProject } from "./model";
import type { LegoPartInfo, LoadedPack } from "./pack";
import type { S3oVertex } from "./s3oBuild";

/** x, y, z, nx, ny, nz, u, v, the record the pack and the format share. */
const FLOATS_PER_VERTEX = 8;

/**
 * How far a rebuilt vertex may sit from where the file has it, in elmos, per
 * elmo of the piece's own size.
 *
 * An `.s3o` holds 32-bit floats where the document holds 64, so an exact fit is
 * not on offer. This is loose next to that error and still thousands of times
 * tighter than any transform that merely looks similar.
 */
const FIT_TOLERANCE = 1e-3;

/** Below this, in elmos, a recovered pivot is the part's middle. */
const PIVOT_TOLERANCE = 1e-3;

/** One piece of a model read off disk. Mirrors `S3oPiece` on the way out. */
export interface S3oReadPiece {
  name: string;
  /** 0 triangles, 1 strip, 2 quads. An export is always triangles. */
  primitiveType: number;
  offset: [number, number, number];
  vertices: S3oVertex[];
  indices: number[];
  children: S3oReadPiece[];
}

/** A model read off disk, as `lego_read_s3o` gives it. */
export interface S3oModel {
  radius: number;
  height: number;
  mid: [number, number, number];
  texture1: string;
  texture2: string;
  root: S3oReadPiece;
}

export interface S3oRecovery {
  project: LegoProject;
  /** Pieces whose geometry was matched back to a part. */
  matched: number;
  /** Pieces with no geometry: hierarchy nodes, flares and aim points. */
  empty: number;
}

export type S3oRecoveryResult =
  | { ok: true; recovery: S3oRecovery }
  | { ok: false; problem: string };

/**
 * What a recovered unit does not get back, as sentences meant to be shown.
 *
 * An export is a baked model. It carries piece names, the tree they hang in and
 * where each one sits, and nothing else the document holds. Saying so on screen
 * is the point: a recovered unit that quietly lost its animation would be worse
 * than one that never claimed to have it.
 */
export const NOT_IN_AN_EXPORT: string[] = [
  "Roles, tags, hidden pieces and custom anchors.",
  "Animation presets and the unit script. An export writes the script as its own file, and this reads only the model.",
  "The unit definition, the collision volume, notes, and where the unit was last exported to.",
  "Which pieces were dropped in as a compound. A compound is copied into the unit when it is used, so the copy is all there ever was in the model.",
  "A rotation or scale on a piece with no geometry, which the format cannot store. It comes back on the pieces below it instead, so the unit is the same shape.",
  "The axis a mirrored piece was mirrored on. It comes back as a negative scale on x, which is what the builder writes for any reflection.",
  "Exact numbers. A model stores 32-bit floats where the document stores 64, so positions, rotations and scales come back correct to about the seventh digit.",
];

/**
 * Which installed atlas a file's texture name points at, if any.
 *
 * An export names `coilbox_<atlas>`, so the prefix is stripped before looking.
 * A file naming something else is not a problem to refuse over: the unit still
 * samples one of the installed atlases, and which one is the caller's to
 * confirm.
 */
export function recoveredAtlas(
  texture1: string,
  atlases: LegoAtlas[],
): LegoAtlas | null {
  return (
    atlases.find((atlas) => exportTextureName(atlas.tex1) === texture1) ?? null
  );
}

/**
 * Rebuild the project an `.s3o` was exported from, or say why it cannot be.
 *
 * The unit's atlas is not set here. The file names a texture rather than an
 * atlas, and which of the installed atlases that is, is for the caller to
 * confirm: see `recoveredAtlas`.
 */
export function recoverProject(
  model: S3oModel,
  pack: LoadedPack,
  options: {
    name: string;
    unitName: string;
    now: string;
    newId: () => string;
  },
): S3oRecoveryResult {
  const nodes = flatten(model.root, options.newId);

  const strip = nodes.find((node) => node.piece.primitiveType !== 0);
  if (strip) {
    return {
      ok: false,
      problem: `"${strip.piece.name}" is drawn as a ${strip.piece.primitiveType === 1 ? "triangle strip" : "quad list"}, and coilbox only ever writes triangles. This model was made somewhere else.`,
    };
  }

  const geometry = nodes.filter((node) => node.piece.vertices.length > 0);
  if (geometry.length === 0) {
    return {
      ok: false,
      problem:
        "This model has no geometry in it, so there is nothing to match against the parts library.",
    };
  }

  const parts = new Map<Node, LegoPartInfo>();
  const unmatched: string[] = [];
  for (const node of geometry) {
    const part = findPart(pack, node.piece);
    if (part) parts.set(node, part);
    else unmatched.push(node.piece.name);
  }
  if (unmatched.length > 0) {
    return {
      ok: false,
      problem: `${unmatched.length} of ${geometry.length} pieces are not made of parts from the installed packs, starting with "${unmatched[0]}". Only a model coilbox exported can be turned back into a project.`,
    };
  }

  // Depth-first, which is already the order a document stores pieces in.
  const pieces: LegoPiece[] = [];
  for (const node of nodes) {
    const problem = place(node, parts.get(node) ?? null, pack, pieces);
    if (problem) return { ok: false, problem };
  }

  const project: LegoProject = {
    schemaVersion: LEGO_SCHEMA_VERSION,
    id: options.newId(),
    name: options.name,
    unitName: options.unitName,
    packId: pack.manifest.id,
    packVersion: pack.manifest.version,
    createdAt: options.now,
    updatedAt: options.now,
    rootPieceId: nodes[0].id,
    pieces,
  };

  return {
    ok: true,
    recovery: {
      project,
      matched: parts.size,
      empty: nodes.length - geometry.length,
    },
  };
}

/** One piece of the file, and where the walk has worked out that it sits. */
interface Node {
  piece: S3oReadPiece;
  id: string;
  parent: Node | null;
  /** Rotation and scale with every ancestor's applied, which is what was baked. */
  linear: THREE.Matrix3;
  /** Where the piece sits in the unit, which is the offsets added up. */
  translation: THREE.Vector3;
}

/** Depth-first from the root, so a parent is always placed before its children. */
function flatten(root: S3oReadPiece, newId: () => string): Node[] {
  const out: Node[] = [];
  const visit = (piece: S3oReadPiece, parent: Node | null) => {
    const node: Node = {
      piece,
      id: newId(),
      parent,
      linear: new THREE.Matrix3(),
      translation: new THREE.Vector3(),
    };
    out.push(node);
    for (const child of piece.children) visit(child, node);
  };
  visit(root, null);
  return out;
}

/**
 * The part a piece's geometry was copied from, by its UVs.
 *
 * Vertex and index counts narrow the search first, and are not evidence on
 * their own: plenty of parts share a mesh. The UV stream is what identifies
 * one, and it has to match to the bit, which it does because the bake copies it
 * and both ends store it as a 32-bit float.
 */
function findPart(pack: LoadedPack, piece: S3oReadPiece): LegoPartInfo | null {
  for (const part of pack.parts) {
    if (part.vCount !== piece.vertices.length) continue;
    if (part.iCount !== piece.indices.length) continue;
    if (sameUvs(pack, part, piece.vertices)) return part;
  }
  return null;
}

function sameUvs(
  pack: LoadedPack,
  part: LegoPartInfo,
  vertices: S3oVertex[],
): boolean {
  for (let i = 0; i < part.vCount; i++) {
    const at = (part.vFirst + i) * FLOATS_PER_VERTEX;
    if (pack.vertices[at + 6] !== vertices[i].uv[0]) return false;
    if (pack.vertices[at + 7] !== vertices[i].uv[1]) return false;
  }
  return true;
}

/**
 * Whether the piece's triangles are wound as the part's, or reversed.
 *
 * A reflection turns every triangle inside out, and the exporter reverses the
 * winding to match. Which of the two a piece should be is not a choice: it
 * follows from whether its transform has a negative determinant, so checking it
 * is one more thing a model coilbox did not write would have to get right.
 */
function sameIndices(
  pack: LoadedPack,
  part: LegoPartInfo,
  piece: S3oReadPiece,
  reversed: boolean,
): boolean {
  const swap = [0, 2, 1];
  for (let i = 0; i < part.iCount; i++) {
    const base = i - (i % 3);
    const at = reversed && base + 2 < part.iCount ? base + swap[i % 3] : i;
    if (piece.indices[at] !== pack.indices[part.iFirst + i]) return false;
  }
  return true;
}

/**
 * Work out one piece's transform and add it to `pieces`, or say why not.
 *
 * The file gives a piece's translation from its parent and its geometry with
 * every ancestor's rotation and scale already in it. So the world transform is
 * recovered first, from the geometry, and the local one the document stores is
 * that written against the parent's.
 *
 * A piece with no geometry has nothing to recover from, and takes its parent's
 * rotation and scale unchanged. That is not a guess about what the original
 * document held: whatever it held is already in the pieces below, since the
 * bake accumulated it, so the unit comes back the same shape either way.
 */
function place(
  node: Node,
  part: LegoPartInfo | null,
  pack: LoadedPack,
  pieces: LegoPiece[],
): string | null {
  const parentLinear = node.parent?.linear ?? new THREE.Matrix3();
  const parentTranslation = node.parent?.translation ?? new THREE.Vector3();
  const offset = new THREE.Vector3(...node.piece.offset);
  node.translation = parentTranslation.clone().add(offset);

  let pivot: THREE.Vector3 | null = null;
  if (part) {
    const fitted = fitPart(pack, part, node.piece.vertices);
    if (fitted === "flat") {
      return `"${node.piece.name}" is made of the part "${part.name}", whose vertices all lie in one plane. How a flat part was turned cannot be read back off a model, so this unit cannot be rebuilt.`;
    }
    if (fitted === "misfit") {
      return `"${node.piece.name}" carries the part "${part.name}"'s texture mapping, but no rotation and scale put that part where the file has it. This model was not exported from a project.`;
    }
    const reversed = fitted.linear.determinant() < 0;
    if (!sameIndices(pack, part, node.piece, reversed)) {
      return `"${node.piece.name}" has the part "${part.name}" wound the wrong way round for how it is placed. This model was not exported from a project.`;
    }
    node.linear = fitted.linear;
    pivot = fitted.pivot;
  } else {
    node.linear = parentLinear.clone();
  }

  if (parentLinear.determinant() === 0) {
    return `"${node.piece.name}" hangs off a piece scaled to nothing, so where it sits cannot be worked out.`;
  }
  const parentInverse = parentLinear.clone().invert();

  const local = new THREE.Matrix4()
    .setFromMatrix3(parentInverse.clone().multiply(node.linear))
    .setPosition(offset.clone().applyMatrix3(parentInverse));

  const position = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  // The same decomposition the builder uses everywhere else, which puts a
  // reflection on x. See `mirror.ts`.
  local.decompose(position, rotation, scale);
  const euler = new THREE.Euler().setFromQuaternion(rotation);

  pieces.push({
    id: node.id,
    name: node.piece.name,
    parentId: node.parent?.id ?? null,
    partId: part?.id ?? null,
    position: [position.x, position.y, position.z],
    rotation: [euler.x, euler.y, euler.z],
    scale: [scale.x, scale.y, scale.z],
    ...(pivot ? { pivot: [pivot.x, pivot.y, pivot.z] } : {}),
  });
  return null;
}

/**
 * The rotation, scale and pivot that turn a part into the vertices in the file.
 *
 * The bake is `v = L(p - pivot)`, one 3 by 3 matrix and one point for the whole
 * piece, and the vertices are still in the part's own order, so every vertex is
 * a correspondence and the fit is a least-squares solve rather than a search.
 *
 * `"misfit"` when there is no such transform, which is the check that a match
 * on UVs alone cannot be a coincidence. `"flat"` when the part could not have
 * one whatever the file holds, so that a pack with a flat part is told what is
 * wrong rather than accused of not coming from here.
 */
function fitPart(
  pack: LoadedPack,
  part: LegoPartInfo,
  vertices: S3oVertex[],
): { linear: THREE.Matrix3; pivot: THREE.Vector3 | null } | "flat" | "misfit" {
  const n = part.vCount;
  const partMid = new THREE.Vector3();
  const fileMid = new THREE.Vector3();
  const partAt = (i: number) => {
    const at = (part.vFirst + i) * FLOATS_PER_VERTEX;
    return new THREE.Vector3(
      pack.vertices[at],
      pack.vertices[at + 1],
      pack.vertices[at + 2],
    );
  };
  const fileAt = (i: number) => new THREE.Vector3(...vertices[i].pos);

  for (let i = 0; i < n; i++) {
    partMid.add(partAt(i));
    fileMid.add(fileAt(i));
  }
  partMid.divideScalar(n);
  fileMid.divideScalar(n);

  // Column-major, as `fromArray` reads them. `spread` is the part's own scatter
  // about its middle and `cross` is how the file's scatter lines up with it, so
  // that the transform is `cross * spread^-1`.
  const spread = new Array(9).fill(0);
  const cross = new Array(9).fill(0);
  for (let i = 0; i < n; i++) {
    const d = partAt(i).sub(partMid).toArray();
    const e = fileAt(i).sub(fileMid).toArray();
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        spread[c * 3 + r] += d[r] * d[c];
        cross[c * 3 + r] += e[r] * d[c];
      }
    }
  }

  // A part whose vertices all sit on one plane or line has no unique transform.
  // None of the bundled pack's do, and a pack that brought one would be told
  // rather than given a fitted guess.
  const b = new THREE.Matrix3().fromArray(spread);
  const size = (spread[0] + spread[4] + spread[8]) / 3;
  if (Math.abs(b.determinant()) < 1e-9 * size ** 3) return "flat";

  const linear = new THREE.Matrix3()
    .fromArray(cross)
    .multiply(b.clone().invert());

  let extent = 0;
  let worst = 0;
  for (let i = 0; i < n; i++) {
    const file = fileAt(i);
    extent = Math.max(extent, file.distanceTo(fileMid));
    const rebuilt = partAt(i).sub(partMid).applyMatrix3(linear).add(fileMid);
    worst = Math.max(worst, rebuilt.distanceTo(file));
  }
  if (worst > FIT_TOLERANCE * Math.max(1, extent)) return "misfit";

  // `v = L(p - pivot)` means the part's middle maps to `L(partMid - pivot)`,
  // which is the file's middle, so the pivot is what is left over. A piece
  // scaled to nothing on an axis has no inverse, and no shape either.
  if (linear.determinant() === 0) return "misfit";
  const inverse = linear.clone().invert();
  const pivot = partMid.clone().sub(fileMid.clone().applyMatrix3(inverse));
  const away = Math.max(
    Math.abs(pivot.x),
    Math.abs(pivot.y),
    Math.abs(pivot.z),
  );

  return { linear, pivot: away < PIVOT_TOLERANCE ? null : pivot };
}
