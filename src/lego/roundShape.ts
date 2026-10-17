/**
 * A cylinder, a tube or a cone as the numbers a person sets (#3327, #3329):
 * radius, length, the axis it runs along, its sides and, for a tube, its wall
 * or, for a cone, its top radius. The document stores a box `size` and options,
 * so this turns one into the other.
 *
 * The radius is half the smaller size across the axis, the size a tube's hole
 * and a cone's top are measured against. For a cone it is the bottom radius,
 * at the low end of the axis. Setting it makes the shape round again.
 */

import type { LegoProject } from "./model";
import type { LoadedPack } from "./pack";
import {
  coneTopRadius,
  DEFAULT_CYLINDER_SIDES,
  type LegoShape,
  type ShapeSwatch,
  tubeInnerRadius,
} from "./shapes";

export type RoundKind = "cylinder" | "tube" | "cone";

export interface RoundNumbers {
  /** 0, 1 or 2 for x, y or z. */
  axis: number;
  radius: number;
  length: number;
  sides: number;
  /** Only a tube has one. */
  wall?: number;
  /** Only a cone has one: the radius of its top, 0 for a point. */
  top?: number;
}

/** A new one is 1 across and 1 long, upright, near the size of the pack's
 *  smaller blocks. A tube's wall is a quarter of that. */
const NEW_SIZE = 1;
const NEW_WALL = 0.25;

/**
 * A new cylinder or tube for this unit, or null when the pack lists no
 * swatches, which means it offers no shapes. It takes the colourway most of
 * the unit's parts use, or the pack's first swatch when none has one.
 */
export function newRoundShape(
  kind: RoundKind,
  project: LegoProject,
  pack: Pick<LoadedPack, "manifest" | "byId">,
): LegoShape | null {
  const swatches = pack.manifest.swatches ?? [];
  if (swatches.length === 0) return null;
  const swatch = mostUsedSwatch(project, pack, swatches);
  const options: Record<string, number> = {
    axis: 1,
    sides: DEFAULT_CYLINDER_SIDES,
  };
  if (kind === "tube") options.inner = NEW_SIZE / 2 - NEW_WALL;
  if (kind === "cone") options.top = 0;
  return {
    kind,
    size: [NEW_SIZE, NEW_SIZE, NEW_SIZE],
    swatch,
    options,
  };
}

export function mostUsedSwatch(
  project: LegoProject,
  pack: Pick<LoadedPack, "byId">,
  swatches: ShapeSwatch[],
): string {
  const counts = new Map<string, number>();
  for (const piece of project.pieces) {
    const colourway = piece.partId
      ? pack.byId.get(piece.partId)?.colourway
      : piece.shape?.swatch;
    if (colourway) counts.set(colourway, (counts.get(colourway) ?? 0) + 1);
  }
  let best = swatches[0];
  for (const swatch of swatches) {
    if ((counts.get(swatch.id) ?? 0) > (counts.get(best.id) ?? 0)) {
      best = swatch;
    }
  }
  return best.id;
}

function axisOf(shape: LegoShape): number {
  const axis = shape.options?.axis;
  return axis === 0 || axis === 2 ? axis : 1;
}

/** A round shape's numbers as it is drawn, defaults filled in. */
export function roundNumbers(shape: LegoShape): RoundNumbers {
  const axis = axisOf(shape);
  const radius =
    Math.min(shape.size[(axis + 1) % 3], shape.size[(axis + 2) % 3]) / 2;
  const sides = Math.round(shape.options?.sides ?? NaN);
  return {
    axis,
    radius,
    length: shape.size[axis],
    sides: sides >= 3 ? sides : DEFAULT_CYLINDER_SIDES,
    ...(shape.kind === "tube" ? { wall: radius - tubeInnerRadius(shape) } : {}),
    ...(shape.kind === "cone" ? { top: coneTopRadius(shape) } : {}),
  };
}

/**
 * The shape with one of its numbers changed, or why it cannot take it. A tube
 * keeps its wall when its radius changes, so the wall must still fit.
 */
export function withRoundNumber(
  shape: LegoShape,
  name: keyof RoundNumbers,
  value: number,
): { shape: LegoShape } | { problem: string } {
  const next = { ...roundNumbers(shape), [name]: value };
  if (!(next.radius > 0)) return { problem: "Radius must be above 0." };
  if (!(next.length > 0)) return { problem: "Length must be above 0." };
  if (!Number.isInteger(next.sides) || next.sides < 3) {
    return { problem: "Sides must be a whole number, 3 or more." };
  }
  if (next.wall !== undefined && !(next.wall > 0 && next.wall < next.radius)) {
    return { problem: "Wall must be above 0 and below the radius." };
  }
  if (next.top !== undefined) {
    if (next.top === next.radius) {
      return {
        problem:
          "A top as wide as the bottom is a cylinder. Add a cylinder instead.",
      };
    }
    if (!(next.top >= 0 && next.top < next.radius)) {
      return {
        problem: "Top radius must be 0 or more and below the bottom radius.",
      };
    }
  }
  const size: [number, number, number] = [
    next.radius * 2,
    next.radius * 2,
    next.radius * 2,
  ];
  size[next.axis] = next.length;
  const options: Record<string, number> = {
    ...shape.options,
    axis: next.axis,
    sides: next.sides,
  };
  if (next.wall !== undefined) options.inner = next.radius - next.wall;
  if (next.top !== undefined) options.top = next.top;
  return { shape: { ...shape, size, options } };
}
