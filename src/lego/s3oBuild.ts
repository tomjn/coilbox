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

import { t } from "@lingui/core/macro";
import * as THREE from "three";

import { ENGINE_ROTATION_ORDER, type TrackDelta } from "./animPresets";
import { resolveConnections } from "./connectors";
import { joinedWorld } from "./joinedWorld";
import { computeSmoothedNormals, fixUv, hasMeshFix } from "./meshFix";
import {
  childrenOf,
  type LegoPiece,
  type LegoProject,
  pieceById,
} from "./model";
import type { LoadedPack } from "./pack";
import { pieceMesh, type RawGeometry } from "./rawGeometry";
import { isKnownShapeKind, shapeMesh } from "./shapes";
import type { SheetUv } from "./textureSheet";

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

/**
 * `mid` here is the header's own mid, which is the unit's aim point and is not
 * always the middle of the measured box: see `aimPoint.ts`. The sizes beside it
 * are still the box. Anything that needs the box's middle has to measure it
 * with `unitBounds` rather than read it off a build.
 */
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
  stored: LegoProject,
  pack: LoadedPack,
  raw: RawGeometry | null,
): {
  pieces: Map<string, BakedPiece>;
  world: THREE.Vector3[];
  /** Each piece's own and its descendants' points, as a slice of `world`. */
  ranges: Map<string, [number, number]>;
} {
  // Every edit already resolves joins, so this is a check that changes nothing
  // unless the stored transforms went stale, for example a unit edited while
  // the pack was still loading. What ships is where the joins put each piece.
  const { project } = resolveConnections(stored, pack);
  const pieces = new Map<string, BakedPiece>();
  const world: THREE.Vector3[] = [];
  const ranges = new Map<string, [number, number]>();
  const root = pieceById(project, project.rootPieceId);
  if (root) {
    bakePiece(
      project,
      pack,
      raw,
      root,
      new THREE.Matrix4(),
      new THREE.Vector3(),
      pieces,
      world,
      ranges,
    );
  }
  return { pieces, world, ranges };
}

/**
 * Stop an export that would leave a shape out. A kind this build cannot make
 * has no geometry, and the viewport shows it as nothing, but a file written
 * without it would arrive in the game with a hole where the piece was.
 */
export function assertShapesKnown(project: LegoProject): void {
  const piece = project.pieces.find(
    (p) => p.shape && !isKnownShapeKind(p.shape.kind),
  );
  if (piece?.shape) {
    const pieceName = piece.name;
    const kind = piece.shape.kind;
    throw new Error(
      t`"${pieceName}" is a "${kind}" shape, which this version of coilbox cannot make, so it cannot be exported. Delete the piece or update coilbox.`,
    );
  }
}

/** An axis-aligned box in the unit's space. */
export interface PieceBox {
  min: [number, number, number];
  max: [number, number, number];
}

/**
 * The box of each named piece and everything under it, in the unit's space,
 * off the bake. A piece with no geometry anywhere under it has no box, so it
 * is left out of the answer.
 */
export function pieceBoxes(
  project: LegoProject,
  pack: LoadedPack,
  raw: RawGeometry | null,
  pieceIds: string[],
): Map<string, PieceBox> {
  const { world, ranges } = bakedPieces(project, pack, raw);
  const boxes = new Map<string, PieceBox>();
  for (const id of pieceIds) {
    const range = ranges.get(id);
    if (!range || range[0] === range[1]) continue;
    const min: [number, number, number] = [Infinity, Infinity, Infinity];
    const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    for (let i = range[0]; i < range[1]; i++) {
      const point = world[i];
      for (let axis = 0; axis < 3; axis++) {
        const value = point.getComponent(axis);
        if (value < min[axis]) min[axis] = value;
        if (value > max[axis]) max[axis] = value;
      }
    }
    boxes.set(id, { min, max });
  }
  return boxes;
}

/**
 * Where each piece rests in the unit's own space, by piece name.
 *
 * Off the bake rather than off the document's offsets, because the two part
 * company the moment an ancestor carries a rotation or a scale, and the bake
 * is what an s3o stores and therefore what the engine animates. Anything
 * reasoning about where a piece actually is has to agree with the file.
 *
 * Keyed by name rather than by id because callers reaching for this have a
 * name: a script probe answers with one, and so does a timeline.
 */
export function pieceWorldRest(
  project: LegoProject,
  pack: LoadedPack,
  raw: RawGeometry | null,
): Map<string, [number, number, number]> {
  const { pieces } = bakedPieces(project, pack, raw);
  const world = new Map<string, [number, number, number]>();

  const walk = (pieceId: string, from: [number, number, number]) => {
    const baked = pieces.get(pieceId);
    if (!baked) return;
    const at: [number, number, number] = [
      from[0] + baked.offset[0],
      from[1] + baked.offset[1],
      from[2] + baked.offset[2],
    ];
    world.set(baked.name, at);
    for (const child of childrenOf(project, pieceId)) walk(child.id, at);
  };

  walk(project.rootPieceId, [0, 0, 0]);
  return world;
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
  raw: RawGeometry | null,
): LegoProject {
  const { world } = bakedPieces(project, pack, raw);
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

/** What a unit costs the engine to load: pieces, triangles and vertices. */
export interface ModelCounts {
  pieces: number;
  triangles: number;
  vertices: number;
}

/**
 * The counts of the model the unit exports, off the bake rather than the
 * document: a baked piece's `indices` over three is the triangle count the
 * engine loads. A piece with no geometry is still a piece.
 */
export function bakedCounts(
  project: LegoProject,
  pack: LoadedPack,
  raw: RawGeometry | null,
): ModelCounts {
  const counts: ModelCounts = { pieces: 0, triangles: 0, vertices: 0 };
  for (const piece of bakedPieces(project, pack, raw).pieces.values()) {
    counts.pieces += 1;
    counts.triangles += piece.indices.length / 3;
    counts.vertices += piece.vertices.length;
  }
  return counts;
}

export function buildS3o(
  project: LegoProject,
  pack: LoadedPack,
  raw: RawGeometry | null,
  textures: { texture1: string; texture2?: string },
  options?: {
    /**
     * Write each piece's `originalName` in place of its normalised `name`,
     * when it has one. Only right for a build with no script alongside it:
     * `SaveModelPopover` sets this, since a piece's normalised name is what a
     * script's `piece(...)` calls address, in a script this build has none of.
     * A full export and a test run leave this unset, because their script
     * does exist and does address pieces by `name`. See
     * `LegoPiece.originalName` (#2613).
     */
    useOriginalNames?: boolean;
    /**
     * A script pose to bake into the model, by piece id, as `TrackDelta`s from
     * rest. The wreck's model is the unit posed this way (issue #3310). A
     * posed model is measured afresh, since a header pinned for the unit does
     * not describe it any more.
     */
    pose?: Map<string, TrackDelta>;
    /**
     * Where each piece's UVs go on the combined sheet of a unit that mixes
     * parts and lifted pieces (#3260). Absent for every other unit, whose
     * UVs are written exactly as they were before sheets existed.
     */
    sheet?: SheetUv;
  },
): S3oBuild | null {
  if (!pieceById(project, project.rootPieceId)) return null;
  assertShapesKnown(project);
  const rest = bakedPieces(project, pack, raw);
  const pose = options?.pose;
  const { pieces, world } =
    pose && pose.size > 0 ? posePieces(project, rest.pieces, pose) : rest;
  // The radius is the collision sphere's, and that sphere is centred on the
  // header's mid, so it is measured from the aim point the unit will ship with
  // rather than from the middle of its box.
  const measured = header(world, project.mid);
  const pinned: Pick<LegoProject, "radius" | "height" | "mid"> =
    pose && pose.size > 0 ? {} : project;

  return {
    ...measured,
    // The collision sphere and the height the document pins, when it pins them.
    // A unit assembled here pins nothing and is measured, which is what every
    // unit did before this. A unit imported from somebody else's model carries
    // the header that model shipped, and re-exporting it must not quietly give
    // the unit a different collision sphere from the one its author set.
    radius: pinned.radius ?? measured.radius,
    height: pinned.height ?? measured.height,
    mid: pinned.mid ?? measured.mid,
    texture1: textures.texture1,
    texture2: textures.texture2 ?? "",
    root: assemble(
      project,
      raw,
      pieces,
      project.rootPieceId,
      options?.useOriginalNames ?? false,
      options?.sheet,
    ),
  };
}

/**
 * Baked pieces with a script pose baked in as well, the way the engine would
 * draw them with those `Move` and `Turn` values set.
 *
 * The engine places a piece at its parent's transform times its offset plus
 * the script's move, then turns it by the script's rotation
 * (`S3DModelPiece::ComposeTransform`), so a turned piece takes everything under
 * it with it. A baked piece has no rotation of its own, so the turn goes into
 * its vertices and its normals, and its offset becomes the distance from where
 * its parent now is.
 */
function posePieces(
  project: LegoProject,
  rest: Map<string, BakedPiece>,
  pose: Map<string, TrackDelta>,
): { pieces: Map<string, BakedPiece>; world: THREE.Vector3[] } {
  const pieces = new Map<string, BakedPiece>();
  const world: THREE.Vector3[] = [];
  const walk = (
    pieceId: string,
    parentAt: THREE.Vector3,
    parentTurn: THREE.Quaternion,
  ) => {
    const baked = rest.get(pieceId);
    if (!baked) return;
    const delta = pose.get(pieceId);
    const move = new THREE.Vector3(...baked.offset).add(
      new THREE.Vector3(...(delta?.position ?? [0, 0, 0])),
    );
    const at = move.applyQuaternion(parentTurn).add(parentAt);
    const turn = parentTurn
      .clone()
      .multiply(
        new THREE.Quaternion().setFromEuler(
          new THREE.Euler(
            ...(delta?.rotation ?? [0, 0, 0]),
            ENGINE_ROTATION_ORDER,
          ),
        ),
      );
    const vertices = baked.vertices.map((vertex) => {
      const pos = new THREE.Vector3(...vertex.pos).applyQuaternion(turn);
      const normal = new THREE.Vector3(...vertex.normal).applyQuaternion(turn);
      world.push(pos.clone().add(at));
      return {
        ...vertex,
        pos: [pos.x, pos.y, pos.z] as [number, number, number],
        normal: [normal.x, normal.y, normal.z] as [number, number, number],
      };
    });
    pieces.set(pieceId, {
      ...baked,
      offset: [at.x - parentAt.x, at.y - parentAt.y, at.z - parentAt.z],
      vertices,
    });
    for (const child of childrenOf(project, pieceId)) walk(child.id, at, turn);
  };
  walk(project.rootPieceId, new THREE.Vector3(), new THREE.Quaternion());
  return { pieces, world };
}

/**
 * A part's UV as the engine samples it.
 *
 * The pack keeps the UVs of KaiserJ's `.obj`, where v runs up from the bottom
 * of the atlas, and the builder draws them that way: three.js flips an image on
 * upload. The engine does not. It passes an s3o's UVs straight through
 * (`S3OParser.cpp`) and loads a PNG top row first (`CBitmap::Load`), so v = 0 is
 * the top of the atlas there, and a part written as it stands samples the
 * mirror of its own pixels (#4165).
 *
 * Only a part is turned round. A mesh imported from a game's model is already
 * in the engine's convention, and is written as it came.
 */
export function engineUv([u, v]: [number, number]): [number, number] {
  return [u, 1 - v];
}

function assemble(
  project: LegoProject,
  raw: RawGeometry | null,
  pieces: Map<string, BakedPiece>,
  pieceId: string,
  useOriginalNames: boolean,
  sheet: SheetUv | undefined,
): S3oPiece {
  const baked = pieces.get(pieceId) as BakedPiece;
  const piece = pieceById(project, pieceId);
  // The same test `geometrySource` makes: a piece draws an imported mesh when
  // the sidecar holds it, and a part otherwise.
  const fromPack = piece !== undefined && pieceMesh(raw, piece) === null;
  return {
    name: useOriginalNames ? (piece?.originalName ?? baked.name) : baked.name,
    primitiveType: 0,
    offset: baked.offset,
    vertices: sheet
      ? baked.vertices.map((vertex) => ({
          ...vertex,
          uv: sheet(pieceId, vertex.uv),
        }))
      : fromPack
        ? baked.vertices.map((vertex) => ({
            ...vertex,
            uv: engineUv(vertex.uv),
          }))
        : baked.vertices,
    indices: baked.indices,
    children: childrenOf(project, pieceId).map((child) =>
      assemble(project, raw, pieces, child.id, useOriginalNames, sheet),
    ),
  };
}

function bakePiece(
  project: LegoProject,
  pack: LoadedPack,
  raw: RawGeometry | null,
  piece: LegoPiece,
  parentWorld: THREE.Matrix4,
  parentTranslation: THREE.Vector3,
  pieces: Map<string, BakedPiece>,
  world: THREE.Vector3[],
  ranges: Map<string, [number, number]>,
): void {
  const start = world.length;
  const local = new THREE.Matrix4().compose(
    new THREE.Vector3(...piece.position),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...piece.rotation)),
    new THREE.Vector3(...piece.scale),
  );
  // A joined piece follows its parent's connector but keeps its own size.
  const matrix = piece.connection
    ? joinedWorld(parentWorld, local)
    : parentWorld.clone().multiply(local);
  const translation = new THREE.Vector3().setFromMatrixPosition(matrix);

  // The rotation and scale, without the translation. This is what the vertices
  // are baked with, and it is why the offset below is a plain subtraction.
  const linear = new THREE.Matrix3().setFromMatrix4(matrix);
  const { vertices, indices } = bakeGeometry(
    pack,
    raw,
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
    bakePiece(
      project,
      pack,
      raw,
      child,
      matrix,
      translation,
      pieces,
      world,
      ranges,
    );
  }
  ranges.set(piece.id, [start, world.length]);
}

/**
 * One piece's geometry, in the piece's own space with rotation and scale
 * already applied.
 *
 * Normals go through the inverse transpose, because a non-uniform scale skews
 * them if it is applied directly. A mirroring transform turns every triangle
 * inside out, so the winding is reversed to match: without that the piece is
 * drawn back to front and lit from inside.
 *
 * A piece draws a part out of the pack, a mesh out of an imported model or a
 * generated shape, and all three are the same 32-byte vertex record in an
 * interleaved buffer with its own index run, so the bake is the same
 * arithmetic for each.
 */
/** The 3x3 identity, column-major, as `THREE.Matrix3.elements` stores one. */
const IDENTITY_ELEMENTS = [1, 0, 0, 0, 1, 0, 0, 0, 1];

/** Whether a piece's accumulated rotation and scale do nothing at all. */
function isIdentity(linear: THREE.Matrix3): boolean {
  return linear.elements.every((value, i) => value === IDENTITY_ELEMENTS[i]);
}

function bakeGeometry(
  pack: LoadedPack,
  raw: RawGeometry | null,
  piece: LegoPiece,
  linear: THREE.Matrix3,
  translation: THREE.Vector3,
  world: THREE.Vector3[],
): { vertices: S3oVertex[]; indices: number[] } {
  const source = geometrySource(pack, raw, piece);
  // An empty piece is not a mistake: it is how the format carries hierarchy,
  // flares and aim points.
  if (!source) return { vertices: [], indices: [] };

  // Recalculating is a whole-mesh operation, so it happens once here rather
  // than per vertex below. Absent `normalsAngle` costs nothing: the loop reads
  // straight off `source.vertices` instead.
  const recalculated =
    piece.normalsAngle !== undefined
      ? computeSmoothedNormals(
          source.vertices,
          source.indices,
          source.vFirst,
          source.vCount,
          source.iFirst,
          source.iCount,
          piece.normalsAngle,
        )
      : null;

  const normalMatrix = new THREE.Matrix3().copy(linear).invert().transpose();
  const point = new THREE.Vector3();
  const normal = new THREE.Vector3();
  // The origin is the point the piece turns about, so the geometry moves to
  // sit around it rather than the other way round.
  const pivot = piece.pivot ?? [0, 0, 0];
  // A mesh copied verbatim out of somebody else's model, left untouched by the
  // builder, has nothing to bake: no rotation, no scale, no pivot. Rebuilding
  // its vertices through the matrix below would still land on the same
  // position, but `.normalize()` does not: plenty of shipped models carry
  // normals that are not quite unit length, and renormalising one changes its
  // bytes for no reason. A piece opened, saved and never touched has to come
  // back bit for bit, so its geometry is copied rather than recomputed. A
  // piece carrying a fix from `meshFix.ts` is never verbatim: its UVs or
  // normals have to be recomputed even when its transform is the identity.
  const verbatim =
    piece.meshId !== undefined &&
    !hasMeshFix(piece) &&
    isIdentity(linear) &&
    pivot[0] === 0 &&
    pivot[1] === 0 &&
    pivot[2] === 0;

  // A hard edge recalculating splits gives this piece more vertices than the
  // source mesh has, each a copy of the vertex it was split from carrying
  // only its own group's normal. `verbatim` never applies here: it requires
  // no fix at all, and a split only ever happens under `recalculated`.
  const vertexCount = recalculated ? recalculated.vertexCount : source.vCount;

  const vertices: S3oVertex[] = [];
  for (let i = 0; i < vertexCount; i++) {
    const local =
      recalculated && i >= source.vCount
        ? recalculated.splitFrom[i - source.vCount]
        : i;
    const at = (source.vFirst + local) * FLOATS_PER_VERTEX;
    if (verbatim) {
      const vx = source.vertices[at];
      const vy = source.vertices[at + 1];
      const vz = source.vertices[at + 2];
      vertices.push({
        pos: [vx, vy, vz],
        normal: [
          source.vertices[at + 3],
          source.vertices[at + 4],
          source.vertices[at + 5],
        ],
        uv: [source.vertices[at + 6], source.vertices[at + 7]],
      });
      world.push(new THREE.Vector3(vx, vy, vz).add(translation));
      continue;
    }
    point
      .set(
        source.vertices[at] - pivot[0],
        source.vertices[at + 1] - pivot[1],
        source.vertices[at + 2] - pivot[2],
      )
      .applyMatrix3(linear);
    normal
      .set(
        recalculated ? recalculated.normals[i * 3] : source.vertices[at + 3],
        recalculated
          ? recalculated.normals[i * 3 + 1]
          : source.vertices[at + 4],
        recalculated
          ? recalculated.normals[i * 3 + 2]
          : source.vertices[at + 5],
      )
      .applyMatrix3(normalMatrix)
      .normalize();
    const [u, v] = fixUv(
      source.vertices[at + 6],
      source.vertices[at + 7],
      piece,
    );

    vertices.push({
      pos: [point.x, point.y, point.z],
      normal: [normal.x, normal.y, normal.z],
      uv: [u, v],
    });
    world.push(point.clone().add(translation));
  }

  const indices: number[] = [];
  for (let i = 0; i < source.iCount; i++) {
    indices.push(
      recalculated
        ? recalculated.indices[i]
        : source.indices[source.iFirst + i],
    );
  }
  if (linear.determinant() < 0) {
    for (let i = 0; i + 2 < indices.length; i += 3) {
      [indices[i + 1], indices[i + 2]] = [indices[i + 2], indices[i + 1]];
    }
  }

  return { vertices, indices };
}

/** Where a piece's vertices are: a mesh, a generated shape or a part. */
function geometrySource(
  pack: LoadedPack,
  raw: RawGeometry | null,
  piece: LegoPiece,
): {
  vertices: Float32Array;
  indices: Uint16Array | Uint32Array;
  vFirst: number;
  vCount: number;
  iFirst: number;
  iCount: number;
} | null {
  const mesh = pieceMesh(raw, piece);
  if (mesh && raw) {
    return { ...mesh, vertices: raw.vertices, indices: raw.indices };
  }
  if (piece.shape) {
    const shape = shapeMesh(piece.shape);
    return shape ? { ...shape, vFirst: 0, iFirst: 0 } : null;
  }
  const part = piece.partId ? pack.byId.get(piece.partId) : undefined;
  if (!part) return null;
  return { ...part, vertices: pack.vertices, indices: pack.indices };
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
 * `aim` is the mid the unit will ship with, when it is not the box's middle.
 * The radius is measured from there for the same reason, so a unit given an aim
 * point of its own still gets a sphere that covers it. The `mid` returned is
 * always the box's middle: what the header writes is decided by `buildS3o`.
 *
 * `radius` and `height` are only honoured above 0.01, so a unit with no
 * geometry writes zeros and lets the engine work them out.
 *
 * `sizeX`, `sizeY` and `sizeZ` are the same box's extent along each axis, for
 * `buildUnitDef` to derive a footprint and a collision volume from. They come
 * straight off `box` rather than off `radius`, because a unit longer than it
 * is wide has no single sphere that describes both axes.
 */
function header(
  world: THREE.Vector3[],
  aim?: [number, number, number],
): UnitBounds & {
  radius: number;
  height: number;
} {
  if (world.length === 0) {
    return { ...emptyBounds(), radius: 0, height: 0 };
  }
  const box = new THREE.Box3().setFromPoints(world);
  const centre = box.getCenter(new THREE.Vector3());
  const from = aim ? new THREE.Vector3(...aim) : centre;
  let radius = 0;
  let height = 0;
  for (const point of world) {
    radius = Math.max(radius, point.distanceTo(from));
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
export function unitBounds(
  project: LegoProject,
  pack: LoadedPack,
  raw: RawGeometry | null,
): UnitBounds {
  const { world } = bakedPieces(project, pack, raw);
  if (world.length === 0) return emptyBounds();
  const { mid, sizeX, sizeY, sizeZ } = header(world);
  return { mid, sizeX, sizeY, sizeZ };
}

/**
 * The radius and height the exported header would carry, which is what the
 * engine keeps as the unit's own `radius` and `height` and answers a script
 * asking how big it is with.
 */
export function unitSize(
  project: LegoProject,
  pack: LoadedPack,
  raw: RawGeometry | null,
): { radius: number; height: number } {
  const { world } = bakedPieces(project, pack, raw);
  const measured = header(world, project.mid);
  return {
    radius: project.radius ?? measured.radius,
    height: project.height ?? measured.height,
  };
}
