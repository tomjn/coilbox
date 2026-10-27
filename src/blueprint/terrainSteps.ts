/**
 * Moving a layout's terrain steps with the layout (issue #4790).
 *
 * A step's points are offsets in the same space as a building's, so turning or
 * flipping a layout has to carry them round too, or a wall drawn in front of a
 * gate ends up behind it. The turn is `turnedAbout` in
 * `../lib/scenarioEditing/editing.ts`, the arithmetic that turns buildings, so
 * both go the same way round and four quarter turns come home exactly.
 *
 * Heights, width and `before` are the same after either: a height is measured
 * from the ground rather than from a direction, and a step keeps its place in
 * the build order. A ramp keeps its end order, so its low end is still the end
 * its first height describes.
 *
 * `lua/blueprint-widget/luaui/coilbox_blueprints/place.lua` does the same turn
 * and flip in the widget, and the two are tested against the same cases.
 */

import { turnedAbout } from "@/lib/scenarioEditing/editing";
import type { Point } from "../scenario/model";
import type { TerrainStep } from "./model";

/** A step with its points mapped, and every other field carried over. */
function withPoints(
  step: TerrainStep,
  map: (point: Point) => Point,
): TerrainStep {
  return {
    ...step,
    points: step.points.map(map),
    ...(step.heights ? { heights: [step.heights[0], step.heights[1]] } : {}),
  };
}

/** A step turned `quarters` quarter turns about a pivot. */
export function turnedStep(
  step: TerrainStep,
  pivot: Point,
  quarters: number,
): TerrainStep {
  return withPoints(step, (point) => turnedAbout(point, pivot, quarters));
}

/**
 * A step flipped side to side (`x`, east and west swap) or top to bottom (`z`),
 * about a pivot. A flip comes after a turn, so it is always along the map's own
 * axes, the way the widget does it.
 */
export function flippedStep(
  step: TerrainStep,
  pivot: Point,
  flip: { x?: boolean; z?: boolean },
): TerrainStep {
  return withPoints(step, (point) => ({
    x: flip.x ? 2 * pivot.x - point.x : point.x,
    z: flip.z ? 2 * pivot.z - point.z : point.z,
  }));
}

/** How many terrain steps a layout has. */
export function terrainCount(layout: { terrain?: readonly unknown[] }): number {
  return layout.terrain?.length ?? 0;
}
