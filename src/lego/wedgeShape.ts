/**
 * A wedge or a ramp as the numbers a person sets (#3328): width, depth, height
 * at the high end, height at the low end and which way the slope runs. The
 * document stores a box `size` (width, height, depth) and options `low` and
 * `flip`, so this turns one into the other.
 */

import type { LegoProject } from "./model";
import type { LoadedPack } from "./pack";
import { type LegoShape, wedgeProfile } from "./shapes";
import { type Anchor, type Bounds, localAnchors } from "./snapping";

export interface WedgeNumbers {
  width: number;
  depth: number;
  /** Height at the high end, which is the box's height. */
  height: number;
  /** Height at the low end. 0 comes to an edge, the height is a box. */
  low: number;
  /** Whether the high end is at the front (+z) rather than the back. */
  flip: boolean;
}

/** A wedge's numbers as it is drawn, defaults filled in. */
export function wedgeNumbers(shape: LegoShape): WedgeNumbers {
  return {
    width: shape.size[0],
    height: shape.size[1],
    depth: shape.size[2],
    ...wedgeProfile(shape),
  };
}

const SIZE_LABELS = { width: "Width", depth: "Depth", height: "Height" };

/**
 * The wedge with one of its numbers changed, or why it cannot take it. `flip`
 * is 1 to flip and 0 to put it back.
 */
export function withWedgeNumber(
  shape: LegoShape,
  name: keyof WedgeNumbers,
  value: number,
): { shape: LegoShape } | { problem: string } {
  const next = {
    ...wedgeNumbers(shape),
    ...(name === "flip" ? { flip: value !== 0 } : { [name]: value }),
  };
  for (const key of ["width", "depth", "height"] as const) {
    if (!(next[key] > 0)) {
      return { problem: `${SIZE_LABELS[key]} must be above 0.` };
    }
  }
  if (!(next.low >= 0 && next.low <= next.height)) {
    return { problem: "Low end must be between 0 and the height." };
  }
  return {
    shape: {
      ...shape,
      size: [next.width, next.height, next.depth],
      options: { ...shape.options, low: next.low, flip: next.flip ? 1 : 0 },
    },
  };
}

/**
 * A wedge's anchors in its part's own space: the box's, less what is not on
 * it. The two corners at the top of the low end are in empty space unless the
 * low end is as tall as the high end, so they go. The middles of the top and
 * of the low end move onto the sloped face and the low end's own face, which
 * stop short of the box's.
 */
export function wedgeAnchors(bounds: Bounds, shape: LegoShape): Anchor[] {
  const { min, max } = bounds;
  const { low, flip } = wedgeProfile(shape);
  const height = max[1] - min[1];
  const lowOut = flip ? -1 : 1;
  const ramp = low < height;
  const at = (anchor: Anchor, y: number): Anchor => ({
    ...anchor,
    position: [anchor.position[0], y, anchor.position[2]],
  });
  return localAnchors(bounds).flatMap((anchor): Anchor[] => {
    const out = anchor.out;
    if (!out) return [anchor];
    if (anchor.kind === "corner" && ramp && out[1] === 1 && out[2] === lowOut) {
      return [];
    }
    if (anchor.kind === "face" && out[1] === 1) {
      return [at(anchor, min[1] + (height + low) / 2)];
    }
    if (anchor.kind === "face" && out[2] === lowOut) {
      return [at(anchor, min[1] + low / 2)];
    }
    return [anchor];
  });
}
