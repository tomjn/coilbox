/**
 * A sphere, dome or bowl as the numbers a person sets (#3330): three radii, how
 * much of the sphere is kept, and its rings and sides. The document stores a
 * box `size` and options `keep`, `rings` and `sides`, so this turns one into
 * the other.
 *
 * The three radii can differ, which makes an ellipsoid. A whole sphere's box is
 * twice each radius. A dome or a bowl keeps half, so the box is as tall as the
 * vertical radius, and that is the number the panel calls its height.
 */

import {
  type LegoShape,
  SPHERE_BOWL,
  SPHERE_DOME,
  SPHERE_WHOLE,
  type SphereKeep,
  sphereProfile,
} from "./shapes";
import { type Anchor, type Bounds, localAnchors } from "./snapping";

export interface SphereNumbers {
  radiusX: number;
  /** The vertical radius. For a dome or a bowl this is its height. */
  radiusY: number;
  radiusZ: number;
  keep: SphereKeep;
  rings: number;
  sides: number;
}

/** A sphere's numbers as it is drawn, defaults filled in. */
export function sphereNumbers(shape: LegoShape): SphereNumbers {
  const profile = sphereProfile(shape);
  const whole = profile.keep === SPHERE_WHOLE;
  return {
    radiusX: shape.size[0] / 2,
    radiusY: whole ? shape.size[1] / 2 : shape.size[1],
    radiusZ: shape.size[2] / 2,
    ...profile,
  };
}

const RADIUS_LABELS = {
  radiusX: "Radius X",
  radiusY: "Radius Y",
  radiusZ: "Radius Z",
};

/**
 * The sphere with one of its numbers changed, or why it cannot take it. Changing
 * what is kept keeps the vertical radius, so a dome made whole is a sphere
 * twice as tall.
 */
export function withSphereNumber(
  shape: LegoShape,
  name: keyof SphereNumbers,
  value: number,
): { shape: LegoShape } | { problem: string } {
  const next = { ...sphereNumbers(shape), [name]: value };
  for (const key of ["radiusX", "radiusY", "radiusZ"] as const) {
    if (!(next[key] > 0)) {
      return { problem: `${RADIUS_LABELS[key]} must be above 0.` };
    }
  }
  if (
    next.keep !== SPHERE_WHOLE &&
    next.keep !== SPHERE_DOME &&
    next.keep !== SPHERE_BOWL
  ) {
    return { problem: "A sphere keeps all, the upper half or the lower half." };
  }
  if (!(Number.isInteger(next.rings) && next.rings >= 2)) {
    return { problem: "Rings must be a whole number, 2 or more." };
  }
  if (!(Number.isInteger(next.sides) && next.sides >= 3)) {
    return { problem: "Sides must be a whole number, 3 or more." };
  }
  const height = next.keep === SPHERE_WHOLE ? next.radiusY * 2 : next.radiusY;
  return {
    shape: {
      ...shape,
      size: [next.radiusX * 2, height, next.radiusZ * 2],
      options: {
        ...shape.options,
        keep: next.keep,
        rings: next.rings,
        sides: next.sides,
      },
    },
  };
}

/**
 * A sphere's anchors in its part's own space: a round shape's, which has no
 * corners, the middle of each face of the box being on a whole sphere. A dome
 * or a bowl keeps only the middle of its flat base and of its apex, the two
 * faces of the box it touches in the middle. The sides of its box are not on it
 * at mid height, so they go.
 */
export function sphereAnchors(bounds: Bounds, shape: LegoShape): Anchor[] {
  const anchors = localAnchors(bounds, true);
  if (sphereProfile(shape).keep === SPHERE_WHOLE) return anchors;
  return anchors.filter(
    (anchor) => !anchor.out || (anchor.out[0] === 0 && anchor.out[2] === 0),
  );
}
