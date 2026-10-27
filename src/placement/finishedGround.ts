/**
 * The ground a blueprint's terrain steps leave behind on the editor's flat
 * build grid, for its buildings to stand on (issue #4793).
 *
 * The one rule for it: `terraform` in `@/blueprint/terraform.ts`, run over the
 * flat grid with the layout held at the grid's middle, which is where the
 * editor places it. Level and ramp heights are measured from the ground there,
 * which is 0, so a step's top is its own height. The result is a `HeightGrid`
 * in the shape a map's heights arrive in, so the models and the footprint
 * squares stand on it the way they stand on a map. Issue #4794 draws the
 * relief from the same grid.
 *
 * Buildings are not passed in yet, so no building blocks a step that comes
 * after it in the build order. The `footprints` argument is there for that.
 */

import type { Rect } from "@/blueprint/footprint";
import type { BaseBlueprint } from "@/blueprint/model";
import { gridFromGround, terraform } from "@/blueprint/terraform";
import type { Point } from "@/scenario/model";
import { GRID_EXTENT, GRID_ORIGIN } from "./ground";
import type { HeightGrid } from "./terrain";

/** The heightmap square, in elmos. */
const SQUARE = 8;

export interface FinishedGround {
  grid: HeightGrid;
  /** The range the grid's words span, in elmos. */
  minHeight: number;
  maxHeight: number;
}

/** The ground after a layout's steps, or null for a layout with none, which
 *  stands on the flat. */
export function finishedGround(
  layout: Pick<BaseBlueprint, "terrain">,
  footprints: readonly (Rect | null | undefined)[] = [],
  extent: number = GRID_EXTENT,
  origin: Point = GRID_ORIGIN,
): FinishedGround | null {
  const steps = layout.terrain ?? [];
  if (steps.length === 0) return null;
  const side = extent / SQUARE + 1;
  const flat = {
    width: side,
    height: side,
    heights: new Float32Array(side * side),
  };
  const { ground } = terraform(
    flat,
    steps,
    { at: origin, quarters: 0 },
    footprints,
  );
  return gridFromGround(ground);
}
