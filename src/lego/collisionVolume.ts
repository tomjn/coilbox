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
 * - `offsets` are measured from the model's middle, not its origin.
 *   `GetWorldSpacePos` adds them to the object's `midPos`, which comes from
 *   the s3o header's `mid`, and that is the centre of the same bounding box.
 *   So a volume that matches the box exactly has offsets of zero.
 *
 * The whole unit gets one volume. The engine can also collide a model piece by
 * piece, which is a different job with a different answer, and is not this.
 */

import type {
  CollisionVolumeType,
  LegoCollisionVolume,
  LegoProject,
} from "./model";
import type { UnitBounds } from "./s3oBuild";

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
 * sphere for anyone who wants it. Offsets are zero because the box's centre
 * is exactly the point the engine measures offsets from.
 */
export function derivedCollisionVolume(
  bounds: UnitBounds,
): LegoCollisionVolume {
  return {
    type: "box",
    scales: [bounds.sizeX, bounds.sizeY, bounds.sizeZ],
    offsets: [0, 0, 0],
  };
}

/** The volume this unit exports: its own if it has one, else the derived one. */
export function effectiveCollisionVolume(
  project: LegoProject,
  bounds: UnitBounds,
): LegoCollisionVolume {
  return project.collisionVolume ?? derivedCollisionVolume(bounds);
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
): LegoCollisionVolume {
  const built = engineScales(volume);
  const fixed = volume.offsets[axis] - (sign * built[axis]) / 2;
  const size = Math.max(MIN_COLLISION_SIZE, sign * (face - fixed));
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
