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

/**
 * The model's world-space bounding box, as the header and everything derived
 * from it measures it: the middle of the box and its extent along each axis.
 */
export interface UnitBounds {
  mid: [number, number, number];
  /** The model's world-space bounding-box extent along x, in elmos. */
  sizeX: number;
  /** The same along y. */
  sizeY: number;
  /** The same along z. */
  sizeZ: number;
}

export interface S3oBuild extends UnitBounds {
  radius: number;
  height: number;
  texture1: string;
  texture2: string;
  root: S3oPiece;
}

/** One piece, flattened the way the format stores it. */
export interface BakedPiece {
  name: string;
  /** Translation from the parent piece, in engine axes. */
  offset: [number, number, number];
  vertices: S3oVertex[];
  indices: number[];
}

/**
 * Every piece with its rotation and scale baked into its own vertices.
 *
 * This is what an s3o holds and therefore what the engine animates: rigid
 * geometry at a translation, with nothing left to inherit. Upspring does the
 * same on save, `ApplyTransform(true, true, false)` per object, which is
 * rotation and scale removed and position kept.
 *
 * Shared by the exporter and by the viewport's playback, so what you watch is
 * what you ship.
 */
export function bakedPieces(
  project: LegoProject,
  pack: LoadedPack,
): { pieces: Map<string, BakedPiece>; world: THREE.Vector3[] } {
  const pieces = new Map<string, BakedPiece>();
  const world: THREE.Vector3[] = [];
  const root = pieceById(project, project.rootPieceId);
  if (root) {
    bakePiece(
      project,
      pack,
      root,
      new THREE.Matrix4(),
      new THREE.Vector3(),
      pieces,
      world,
    );
  }
  return { pieces, world };
}

/**
 * Drop the whole unit so its lowest point rests on the ground.
 *
 * The engine stands a unit on y = 0, so geometry below that is buried and
 * geometry above it hovers. Only the root piece moves: everything hangs off it,
 * so the unit keeps its shape and only its height changes.
 *
 * Returns the project unchanged when it is already sitting on the ground, or
 * when there is no geometry to measure.
 */
export function sitOnGround(
  project: LegoProject,
  pack: LoadedPack,
): LegoProject {
  const { world } = bakedPieces(project, pack);
  if (world.length === 0) return project;

  let lowest = Number.POSITIVE_INFINITY;
  for (const point of world) lowest = Math.min(lowest, point.y);
  if (Math.abs(lowest) < 1e-6) return project;

  return {
    ...project,
    pieces: project.pieces.map((piece) =>
      piece.id === project.rootPieceId
        ? {
            ...piece,
            position: [
              piece.position[0],
              piece.position[1] - lowest,
              piece.position[2],
            ],
          }
        : piece,
    ),
  };
}

export function buildS3o(
  project: LegoProject,
  pack: LoadedPack,
  textures: { texture1: string; texture2?: string },
): S3oBuild | null {
  if (!pieceById(project, project.rootPieceId)) return null;
  const { pieces, world } = bakedPieces(project, pack);

  return {
    ...header(world),
    texture1: textures.texture1,
    texture2: textures.texture2 ?? "",
    root: assemble(project, pieces, project.rootPieceId),
  };
}

function assemble(
  project: LegoProject,
  pieces: Map<string, BakedPiece>,
  pieceId: string,
): S3oPiece {
  const baked = pieces.get(pieceId) as BakedPiece;
  return {
    name: baked.name,
    primitiveType: 0,
    offset: baked.offset,
    vertices: baked.vertices,
    indices: baked.indices,
    children: childrenOf(project, pieceId).map((child) =>
      assemble(project, pieces, child.id),
    ),
  };
}

function bakePiece(
  project: LegoProject,
  pack: LoadedPack,
  piece: LegoPiece,
  parentWorld: THREE.Matrix4,
  parentTranslation: THREE.Vector3,
  pieces: Map<string, BakedPiece>,
  world: THREE.Vector3[],
): void {
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

  pieces.set(piece.id, {
    name: piece.name,
    offset: [
      translation.x - parentTranslation.x,
      translation.y - parentTranslation.y,
      translation.z - parentTranslation.z,
    ],
    vertices,
    indices,
  });

  for (const child of childrenOf(project, piece.id)) {
    bakePiece(project, pack, child, matrix, translation, pieces, world);
  }
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
  // The origin is the point the piece turns about, so the geometry moves to
  // sit around it rather than the other way round.
  const pivot = piece.pivot ?? [0, 0, 0];

  const vertices: S3oVertex[] = [];
  for (let i = 0; i < part.vCount; i++) {
    const at = (part.vFirst + i) * FLOATS_PER_VERTEX;
    point
      .set(
        pack.vertices[at] - pivot[0],
        pack.vertices[at + 1] - pivot[1],
        pack.vertices[at + 2] - pivot[2],
      )
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
 * `radius` is measured from `mid`, not from the origin. `mid` is the middle of
 * the collision sphere and `radius` is that sphere's radius, so the two go
 * together. Confirmed against a shipped model: `ammobox2.s3o` has a header
 * radius of 12.749866, which is exactly its furthest vertex from its `mid`,
 * where the furthest from the origin is 17.6037. Measuring from the origin
 * inflates the sphere of any unit not built centred on it.
 *
 * `radius` and `height` are only honoured above 0.01, so a unit with no
 * geometry writes zeros and lets the engine work them out.
 *
 * `sizeX`, `sizeY` and `sizeZ` are the same box's extent along each axis, for
 * `buildUnitDef` to derive a footprint and a collision volume from. They come
 * straight off `box` rather than off `radius`, because a unit longer than it
 * is wide has no single sphere that describes both axes.
 */
function header(world: THREE.Vector3[]): UnitBounds & {
  radius: number;
  height: number;
} {
  if (world.length === 0) {
    return { ...emptyBounds(), radius: 0, height: 0 };
  }
  const box = new THREE.Box3().setFromPoints(world);
  const centre = box.getCenter(new THREE.Vector3());
  let radius = 0;
  let height = 0;
  for (const point of world) {
    radius = Math.max(radius, point.distanceTo(centre));
    height = Math.max(height, point.y);
  }
  return {
    radius,
    height,
    mid: [centre.x, centre.y, centre.z],
    sizeX: box.max.x - box.min.x,
    sizeY: box.max.y - box.min.y,
    sizeZ: box.max.z - box.min.z,
  };
}

function emptyBounds(): UnitBounds {
  return { mid: [0, 0, 0], sizeX: 0, sizeY: 0, sizeZ: 0 };
}

/**
 * The unit's bounding box on its own, without building the whole model.
 *
 * The viewport draws the collision volume from this and the exporter derives
 * one from the same numbers, so the wireframe on screen and the volume in the
 * exported definition are measured once rather than twice.
 */
export function unitBounds(project: LegoProject, pack: LoadedPack): UnitBounds {
  const { world } = bakedPieces(project, pack);
  if (world.length === 0) return emptyBounds();
  const { mid, sizeX, sizeY, sizeZ } = header(world);
  return { mid, sizeX, sizeY, sizeZ };
}
