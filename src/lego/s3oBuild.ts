/**
 * Turn a unit into the payload the s3o writer takes.
 *
 * s3o pieces carry a translation and nothing else, so a piece's rotation and
 * scale have to be baked into its vertices (decision D3 in the plan). Every
 * piece's world matrix is split into its linear part, which goes into the
 * vertices, and its translation, which becomes the offset from its parent.
 *
 * The result names no parts, roles or anchors. Rust receives geometry and
 * nothing else, and the format's shape is `crates/coilbox-s3o`'s `Model`.
 */

import * as THREE from "three";

import {
  childrenOf,
  type LegoPiece,
  type LegoProject,
  pieceById,
} from "./model";
import type { LoadedPack } from "./pack";

/** x, y, z, nx, ny, nz, u, v, the s3o vertex record the pack also uses. */
const FLOATS_PER_VERTEX = 8;

export interface S3oVertex {
  pos: [number, number, number];
  normal: [number, number, number];
  uv: [number, number];
}

export interface S3oPiece {
  name: string;
  /** Always 0, triangles. The engine converts the other two on load anyway. */
  primitiveType: 0;
  /** Translation from the parent piece, in engine axes. */
  offset: [number, number, number];
  vertices: S3oVertex[];
  indices: number[];
  children: S3oPiece[];
}

export interface S3oBuild {
  radius: number;
  height: number;
  mid: [number, number, number];
  texture1: string;
  texture2: string;
  root: S3oPiece;
}

export function buildS3o(
  project: LegoProject,
  pack: LoadedPack,
  textures: { texture1: string; texture2?: string },
): S3oBuild | null {
  const root = pieceById(project, project.rootPieceId);
  if (!root) return null;

  // Collected while walking, because the header describes the whole model and
  // the walk is already visiting every vertex in world space.
  const world: THREE.Vector3[] = [];
  const built = buildPiece(
    project,
    pack,
    root,
    new THREE.Matrix4(),
    new THREE.Vector3(),
    world,
  );

  return {
    ...header(world),
    texture1: textures.texture1,
    texture2: textures.texture2 ?? "",
    root: built,
  };
}

function buildPiece(
  project: LegoProject,
  pack: LoadedPack,
  piece: LegoPiece,
  parentWorld: THREE.Matrix4,
  parentTranslation: THREE.Vector3,
  world: THREE.Vector3[],
): S3oPiece {
  const local = new THREE.Matrix4().compose(
    new THREE.Vector3(...piece.position),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...piece.rotation)),
    new THREE.Vector3(...piece.scale),
  );
  const matrix = parentWorld.clone().multiply(local);
  const translation = new THREE.Vector3().setFromMatrixPosition(matrix);

  // The rotation and scale, without the translation. This is what the vertices
  // are baked with, and it is why the offset below is a plain subtraction.
  const linear = new THREE.Matrix3().setFromMatrix4(matrix);
  const { vertices, indices } = bakeGeometry(
    pack,
    piece,
    linear,
    translation,
    world,
  );

  return {
    name: piece.name,
    primitiveType: 0,
    offset: [
      translation.x - parentTranslation.x,
      translation.y - parentTranslation.y,
      translation.z - parentTranslation.z,
    ],
    vertices,
    indices,
    children: childrenOf(project, piece.id).map((child) =>
      buildPiece(project, pack, child, matrix, translation, world),
    ),
  };
}

/**
 * One piece's geometry, in the piece's own space with rotation and scale
 * already applied.
 *
 * Normals go through the inverse transpose, because a non-uniform scale skews
 * them if it is applied directly. A mirroring transform turns every triangle
 * inside out, so the winding is reversed to match: without that the piece is
 * drawn back to front and lit from inside.
 */
function bakeGeometry(
  pack: LoadedPack,
  piece: LegoPiece,
  linear: THREE.Matrix3,
  translation: THREE.Vector3,
  world: THREE.Vector3[],
): { vertices: S3oVertex[]; indices: number[] } {
  const part = piece.partId ? pack.byId.get(piece.partId) : undefined;
  // An empty piece is not a mistake: it is how the format carries hierarchy,
  // flares and aim points.
  if (!part) return { vertices: [], indices: [] };

  const normalMatrix = new THREE.Matrix3().copy(linear).invert().transpose();
  const point = new THREE.Vector3();
  const normal = new THREE.Vector3();

  const vertices: S3oVertex[] = [];
  for (let i = 0; i < part.vCount; i++) {
    const at = (part.vFirst + i) * FLOATS_PER_VERTEX;
    point
      .set(pack.vertices[at], pack.vertices[at + 1], pack.vertices[at + 2])
      .applyMatrix3(linear);
    normal
      .set(pack.vertices[at + 3], pack.vertices[at + 4], pack.vertices[at + 5])
      .applyMatrix3(normalMatrix)
      .normalize();

    vertices.push({
      pos: [point.x, point.y, point.z],
      normal: [normal.x, normal.y, normal.z],
      uv: [pack.vertices[at + 6], pack.vertices[at + 7]],
    });
    world.push(point.clone().add(translation));
  }

  const indices: number[] = [];
  for (let i = 0; i < part.iCount; i++) {
    indices.push(pack.indices[part.iFirst + i]);
  }
  if (linear.determinant() < 0) {
    for (let i = 0; i + 2 < indices.length; i += 3) {
      [indices[i + 1], indices[i + 2]] = [indices[i + 2], indices[i + 1]];
    }
  }

  return { vertices, indices };
}

/**
 * The model header, from every vertex in world space.
 *
 * `radius` and `height` are only honoured above 0.01, so a unit with no
 * geometry writes zeros and lets the engine work them out.
 */
function header(world: THREE.Vector3[]): {
  radius: number;
  height: number;
  mid: [number, number, number];
} {
  if (world.length === 0) {
    return { radius: 0, height: 0, mid: [0, 0, 0] };
  }
  const box = new THREE.Box3().setFromPoints(world);
  const centre = box.getCenter(new THREE.Vector3());
  let radius = 0;
  let height = 0;
  for (const point of world) {
    radius = Math.max(radius, point.length());
    height = Math.max(height, point.y);
  }
  return { radius, height, mid: [centre.x, centre.y, centre.z] };
}
