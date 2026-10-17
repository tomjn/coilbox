/**
 * A wedge or a ramp as the numbers a person sets (#3328): width, depth, height
 * at the high end, height at the low end and which way the slope runs. The
 * document stores a box `size` (width, height, depth) and options `low` and
 * `flip`, so this turns one into the other.
 */

import type { LegoProject } from "./model";
import type { LoadedPack } from "./pack";
import { mostUsedSwatch } from "./roundShape";
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

/** A new wedge is 1 each way, coming to an edge, like the pack's smaller
 *  blocks. */
const NEW_SIZE = 1;

/**
 * A new wedge for this unit, or null when the pack lists no swatches, which
 * means it offers no shapes. It takes the colourway most of the unit's parts
 * use, or the pack's first swatch when none has one.
 */
export function newWedgeShape(
  project: LegoProject,
  pack: Pick<LoadedPack, "manifest" | "byId">,
): LegoShape | null {
  const swatches = pack.manifest.swatches ?? [];
  if (swatches.length === 0) return null;
  return {
    kind: "wedge",
    size: [NEW_SIZE, NEW_SIZE, NEW_SIZE],
    swatch: mostUsedSwatch(project, pack, swatches),
    options: { low: 0, flip: 0 },
  };
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
 * A wedge's corner and middle anchors in its part's own space: the box's, less
 * what is not on it. The two corners at the top of the low end are in empty
 * space unless the low end is as tall as the high end, so they go. Its faces
 * are connectors (`shapeConnectors`), not anchors from here.
 */
export function wedgeAnchors(bounds: Bounds, shape: LegoShape): Anchor[] {
  const { min, max } = bounds;
  const { low, flip } = wedgeProfile(shape);
  const ramp = low < max[1] - min[1];
  const lowOut = flip ? -1 : 1;
  return localAnchors(bounds).filter(
    (anchor) =>
      anchor.kind !== "face" &&
      !(
        anchor.kind === "corner" &&
        ramp &&
        anchor.out?.[1] === 1 &&
        anchor.out[2] === lowOut
      ),
  );
}
