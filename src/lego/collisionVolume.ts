/**
 * The unit's collision volume: what the engine hits, clicks and shoots at.
 *
 * A unit definition that names no volume gets the engine's own, which is a
 * sphere around the whole model. The headless run on issue #565 measured that:
 * it is sane, but it is a much larger click target than a long unit looks. So
 * an export always writes one, derived from the model's bounding box unless
 * the unit carries a volume of its own.
 *
 * Two things about the numbers, both read off the engine's `CollisionVolume`
 * rather than assumed:
 *
 * - `scales` are full extents, not radii. `SetAxisScales` keeps what it is
 *   given as `fullAxisScales` and halves it itself.
 * - `offsets` are measured from the unit's aim point, not from its origin.
 *   `GetWorldSpacePos` adds them to the object's `midPos`, which comes from
 *   the s3o header's `mid`. That is the middle of the same bounding box until
 *   somebody moves it, so a volume matching the box has offsets of zero on a
 *   unit that has not been given an aim point of its own, and offsets that
 *   undo the move on one that has. See `aimPoint.ts`.
 *
 * The whole unit gets one volume. A unit can instead be hit piece by piece,
 * which is `pieceCollisionVolume` at the bottom of this file. That one is a
 * reading of what the engine builds by itself, and a piece can be given
 * something else instead: see `pieceCollisionScript.ts`.
 */

import { aimPoint } from "./aimPoint";
import {
  type CollisionVolumeType,
  childrenOf,
  type LegoCollisionVolume,
  type LegoPiece,
  type LegoProject,
  pieceById,
} from "./model";
import type { BakedPiece, UnitBounds } from "./s3oBuild";

/** What each shape is called in the picker. Keyed by the type, so a shape
 *  added to the union has to be named here before this compiles. */
export const COLLISION_VOLUME_LABELS: Record<CollisionVolumeType, string> = {
  box: "Box",
  sphere: "Sphere",
  ellipsoid: "Ellipsoid",
  cylx: "Cylinder along x",
  cyly: "Cylinder along y",
  cylz: "Cylinder along z",
};

/**
 * The volume a unit gets when nobody has set one: its own bounding box.
 *
 * A box rather than a sphere because that is the tighter of the two around
 * the geometry that was actually built, and the engine already provides the
 * sphere for anyone who wants it.
 *
 * `aim` is the point the engine measures offsets from, which is the middle of
 * the box for most units and gives offsets of zero. A unit given an aim point
 * of its own gets offsets that carry the box back onto the geometry, because
 * the box is the geometry and moving the aim point must not move it.
 */
export function derivedCollisionVolume(
  bounds: UnitBounds,
  aim: [number, number, number],
): LegoCollisionVolume {
  return {
    type: "box",
    scales: [bounds.sizeX, bounds.sizeY, bounds.sizeZ],
    offsets: [
      bounds.mid[0] - aim[0],
      bounds.mid[1] - aim[1],
      bounds.mid[2] - aim[2],
    ],
  };
}

/** The volume this unit exports: its own if it has one, else the derived one. */
export function effectiveCollisionVolume(
  project: LegoProject,
  bounds: UnitBounds,
): LegoCollisionVolume {
  return (
    project.collisionVolume ??
    derivedCollisionVolume(bounds, aimPoint(project, bounds))
  );
}

/**
 * The same volume, in the same place, once the point its offsets are measured
 * from has moved.
 *
 * Moving a unit's aim point moves everything measured from it, so a volume
 * somebody fitted to the geometry would slide off it. This is what the aim
 * point control writes back so that it does not: the shape on screen stays
 * where it was put, and only the numbers describing it change.
 */
export function reanchorCollisionVolume(
  volume: LegoCollisionVolume,
  from: [number, number, number],
  to: [number, number, number],
): LegoCollisionVolume {
  return {
    ...volume,
    offsets: [0, 1, 2].map(
      (axis) => volume.offsets[axis] + from[axis] - to[axis],
    ) as [number, number, number],
  };
}

/**
 * The scales the engine will actually use, which are not always the ones
 * written down.
 *
 * `CollisionVolume::FixTypeAndScale` makes a sphere uniform at its largest
 * axis and a cylinder round at the larger of its two cross-section axes,
 * because neither shape can be stretched. Drawing these rather than the typed
 * numbers is what makes the wireframe the volume the engine ends up with.
 *
 * The engine also lifts an ellipsoid's smallest axis to 2% of its largest,
 * which only bites on a volume already flat enough to be a mistake, so it is
 * not reproduced here.
 */
export function engineScales(
  volume: LegoCollisionVolume,
): [number, number, number] {
  const [x, y, z] = volume.scales;
  switch (volume.type) {
    case "sphere": {
      const size = Math.max(x, y, z);
      return [size, size, size];
    }
    case "cylx": {
      const across = Math.max(y, z);
      return [x, across, across];
    }
    case "cyly": {
      const across = Math.max(x, z);
      return [across, y, across];
    }
    case "cylz": {
      const across = Math.max(x, y);
      return [across, across, z];
    }
    default:
      return [x, y, z];
  }
}

/** The smallest a volume may be on any axis. A face dragged past its opposite
 *  stops here rather than turning the shape inside out. */
export const MIN_COLLISION_SIZE = 0.1;

/**
 * Move one face of the volume, leaving the opposite face where it is.
 *
 * `face` is where that face has been dragged to, measured from the model's
 * middle, which is what `offsets` are measured from. `axis` is which of x, y
 * and z the face is on and `sign` is which end of it.
 *
 * `min` is the floor a drag stops at, so a face pushed through its opposite
 * leaves a thin volume rather than an inside-out one. It is a parameter because
 * the engine clamps a unit's volume and a piece's differently: see
 * `MIN_COLLISION_SIZE` and `MIN_PIECE_COLLISION_SIZE`.
 *
 * The size that moves is the one the engine will build, not the one typed in,
 * so a shape that cannot be stretched stays the shape it is: a sphere takes the
 * new size on all three axes and a cylinder takes it on both of its
 * cross-section axes (see `engineScales`). Those extra axes grow about their own
 * middle, since the face that was asked to stay put is only on the dragged one.
 */
export function resizeCollisionFace(
  volume: LegoCollisionVolume,
  axis: 0 | 1 | 2,
  sign: 1 | -1,
  face: number,
  min: number = MIN_COLLISION_SIZE,
): LegoCollisionVolume {
  const built = engineScales(volume);
  const fixed = volume.offsets[axis] - (sign * built[axis]) / 2;
  const size = Math.max(min, sign * (face - fixed));
  const offsets: [number, number, number] = [...volume.offsets];
  offsets[axis] = fixed + (sign * size) / 2;
  return { ...volume, scales: resizedScales(volume, axis, size), offsets };
}

/** Which typed sizes a dragged face writes. More than one of them whenever the
 *  shape has to stay round across the axis that was dragged. */
function resizedScales(
  volume: LegoCollisionVolume,
  axis: 0 | 1 | 2,
  size: number,
): [number, number, number] {
  const [x, y, z] = volume.scales;
  switch (volume.type) {
    case "sphere":
      return [size, size, size];
    case "cylx":
      return axis === 0 ? [size, y, z] : [x, size, size];
    case "cyly":
      return axis === 1 ? [x, size, z] : [size, y, size];
    case "cylz":
      return axis === 2 ? [x, y, size] : [size, size, z];
    default: {
      const scales: [number, number, number] = [x, y, z];
      scales[axis] = size;
      return scales;
    }
  }
}

/**
 * Whether the engine will throw this volume away and put its own sphere round
 * the whole model instead.
 *
 * `InitShape` clamps every scale up to 1 and then reads an all-ones volume as
 * "none was set", so a volume an elmo or less on every axis is not a volume at
 * all. A unit with no geometry derives one of exactly that kind, which is the
 * same deferral the s3o header makes when it writes a radius of zero.
 */
export function isIgnoredByEngine(volume: LegoCollisionVolume): boolean {
  return volume.scales.every((scale) => scale <= 1);
}

/**
 * The extents a piece starts with, before any vertex has been measured.
 *
 * The engine's own `DEF_MIN_SIZE` and `DEF_MAX_SIZE`, which are deliberately
 * the wrong way round so the first vertex replaces both. A piece with no
 * vertices keeps them, and the negative extent that falls out of them is what
 * makes an empty piece's volume the clamped minimum below.
 */
const PIECE_MIN_EXTENT = 10000;

/**
 * The smallest a piece's volume can be on any axis. `InitShape` clamps every
 * scale up to one elmo, and unlike the unit volume there is nothing that reads
 * an all-ones piece volume as "none set": `InitDefault` is only ever called on
 * a unit or a feature, so a one-elmo piece box is a real one-elmo piece box.
 */
export const MIN_PIECE_COLLISION_SIZE = 1;

/**
 * The volume the engine will build around one piece.
 *
 * Nothing declares this. There is no collision volume in an `.s3o` piece and
 * none in a unit definition either: every model parser derives one the same
 * way the moment the model loads, `CollisionVolume('b', 'z', maxs - mins,
 * (maxs + mins) * 0.5f)` over the piece's own vertices, in
 * `CS3OParser::LoadPiece` and `ModelUtils::CalculateModelDimensions`. So this
 * is a reading of what a game will hit by default. The only choice a unit
 * definition has is whether to use these at all. Changing one is a call on the
 * live unit, which is `pieceCollisionScript.ts`.
 *
 * Always a box, always centred on the geometry it wraps, and always in the
 * piece's own space, which is why `pieceCollisionVolumes` carries the piece's
 * position separately.
 */
export function pieceCollisionVolume(piece: BakedPiece): LegoCollisionVolume {
  const min: [number, number, number] = [
    PIECE_MIN_EXTENT,
    PIECE_MIN_EXTENT,
    PIECE_MIN_EXTENT,
  ];
  const max: [number, number, number] = [
    -PIECE_MIN_EXTENT,
    -PIECE_MIN_EXTENT,
    -PIECE_MIN_EXTENT,
  ];
  for (const vertex of piece.vertices) {
    for (const axis of [0, 1, 2] as const) {
      min[axis] = Math.min(min[axis], vertex.pos[axis]);
      max[axis] = Math.max(max[axis], vertex.pos[axis]);
    }
  }

  return {
    type: "box",
    scales: [0, 1, 2].map((axis) =>
      Math.max(MIN_PIECE_COLLISION_SIZE, max[axis] - min[axis]),
    ) as [number, number, number],
    offsets: [0, 1, 2].map((axis) => (max[axis] + min[axis]) / 2) as [
      number,
      number,
      number,
    ],
  };
}

/** One piece's volume, with the piece's own position in the model. */
export interface PieceCollisionVolume {
  pieceId: string;
  /**
   * Where the piece sits in the model, which is what its volume's offsets are
   * measured from. An `.s3o` piece carries a translation and nothing else, so
   * a piece's place in the model is its own offset plus every offset above it,
   * which is exactly what the engine's `GetModelSpaceMatrix` composes for a
   * piece a script has not moved.
   */
  origin: [number, number, number];
  /** The box the engine measures round this piece's own vertices. */
  derived: LegoCollisionVolume;
  /** What the unit is hit with here: `derived` unless the piece carries its own. */
  volume: LegoCollisionVolume;
  /** False when the piece has been switched off, so nothing hits it. */
  hit: boolean;
}

/**
 * The volume in force on one piece, and whether anything hits it.
 *
 * The derived box until the piece is given one of its own, which is the same
 * shape of rule as `effectiveCollisionVolume` above and for the same reason:
 * the panel opens on a reading, and touching it takes it over.
 */
export function effectivePieceCollision(
  piece: LegoPiece,
  derived: LegoCollisionVolume,
): { hit: boolean; volume: LegoCollisionVolume } {
  return {
    hit: piece.collision?.hit !== false,
    volume: piece.collision?.volume ?? derived,
  };
}

/**
 * Every piece's volume, in the order the model stores the pieces.
 *
 * Takes the baked pieces rather than the pack, because these have to be
 * measured off the vertices an export writes, not off the parts they came
 * from: a piece's rotation and scale are baked into its own vertices, so a
 * rotated part has a different box from the one it was cut out of.
 */
export function pieceCollisionVolumes(
  project: LegoProject,
  baked: Map<string, BakedPiece>,
): PieceCollisionVolume[] {
  const out: PieceCollisionVolume[] = [];
  const visit = (pieceId: string, parent: [number, number, number]) => {
    const baked_ = baked.get(pieceId);
    if (!baked_) return;
    const origin: [number, number, number] = [
      parent[0] + baked_.offset[0],
      parent[1] + baked_.offset[1],
      parent[2] + baked_.offset[2],
    ];
    const derived = pieceCollisionVolume(baked_);
    const piece = pieceById(project, pieceId);
    out.push({
      pieceId,
      origin,
      derived,
      ...(piece
        ? effectivePieceCollision(piece, derived)
        : { hit: true, volume: derived }),
    });
    for (const child of childrenOf(project, pieceId)) visit(child.id, origin);
  };

  const root = pieceById(project, project.rootPieceId);
  if (root) visit(root.id, [0, 0, 0]);
  return out;
}
