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

import { t } from "@lingui/core/macro";
import {
  type LegoShape,
  SPHERE_BOWL,
  SPHERE_DOME,
  SPHERE_WHOLE,
  type SphereKeep,
  sphereProfile,
} from "./shapes";

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
      return {
        problem:
          key === "radiusX"
            ? t`Radius X must be above 0.`
            : key === "radiusY"
              ? t`Radius Y must be above 0.`
              : t`Radius Z must be above 0.`,
      };
    }
  }
  if (
    next.keep !== SPHERE_WHOLE &&
    next.keep !== SPHERE_DOME &&
    next.keep !== SPHERE_BOWL
  ) {
    return {
      problem: t`A sphere keeps all, the upper half or the lower half.`,
    };
  }
  if (!(Number.isInteger(next.rings) && next.rings >= 2)) {
    return { problem: t`Rings must be a whole number, 2 or more.` };
  }
  if (!(Number.isInteger(next.sides) && next.sides >= 3)) {
    return { problem: t`Sides must be a whole number, 3 or more.` };
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
