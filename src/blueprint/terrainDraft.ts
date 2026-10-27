/**
 * A terrain step being drawn with one of the editor's tools (issue #4793).
 *
 * Every way of finishing, cancelling and leaving a tool is an input to
 * {@link draftReduce}, so what a click, Enter, a double click, a right click,
 * Escape, Done and Cancel do is decided here and tested, and the pointer
 * layer only reports which of them happened.
 *
 * - A click adds a point. A ramp is made on its second click, and a click on
 *   an area's first corner closes it.
 * - Finish (Enter, a double click, a right click or Done) makes the step when
 *   there are enough points and puts the tool down. With too few it throws the
 *   points away, and with none it puts the tool down.
 * - Escape throws away the points, and a second Escape puts the tool down.
 * - Cancel throws away the points and puts the tool down.
 *
 * The height, Raise or Level, and a ramp's width and ends are set on the tool
 * before and while drawing, and the step is made with them.
 */

import type { Point } from "../scenario/model";
import type { TerrainStep } from "./model";
import { type StepLimit, stepRefusal } from "./terraform";
import {
  enoughPoints,
  NEW_RAMP_RISE,
  NEW_RAMP_WIDTH,
  NEW_WALL_HEIGHT,
  newStep,
  snapPoint,
  type TerrainTool,
} from "./terrainEdit";

/** What a step being drawn will be made with. */
export interface DraftSettings {
  /** Walls and areas: whether the height is added to the ground or is the
   *  ground's new level. */
  kind: "raise" | "level";
  height: number;
  /** Ramps: the height at the low end and the high end. */
  heights: [number, number];
  width: number;
}

export interface DraftState {
  tool: TerrainTool | null;
  /** Offsets from the layout's origin, snapped. */
  points: Point[];
  settings: DraftSettings;
}

/** What a tool starts with. A wall raises the ground it follows and an area
 *  levels it, because those are what most players draw. */
export function draftDefaults(tool: TerrainTool | null): DraftSettings {
  return {
    kind: tool === "wall" ? "raise" : "level",
    height: tool === "wall" ? NEW_WALL_HEIGHT : 0,
    heights: [0, NEW_RAMP_RISE],
    width: NEW_RAMP_WIDTH,
  };
}

export const NO_DRAFT: DraftState = {
  tool: null,
  points: [],
  settings: draftDefaults(null),
};

/** The step a tool makes of these points with these settings. */
export function draftStep(
  tool: TerrainTool,
  points: Point[],
  settings: DraftSettings,
): TerrainStep {
  const step = newStep(tool, points);
  if (tool === "wall" || tool === "area") {
    return { ...step, kind: settings.kind, height: settings.height };
  }
  if (tool === "ramp") {
    return {
      ...step,
      heights: [settings.heights[0], settings.heights[1]],
      width: settings.width,
    };
  }
  return step;
}

export type DraftInput =
  | { type: "pick"; tool: TerrainTool | null }
  | { type: "settings"; settings: Partial<DraftSettings> }
  | { type: "click"; at: Point }
  | { type: "rectangle"; corners: Point[] }
  | { type: "finish" }
  | { type: "escape" }
  | { type: "cancel" };

export interface DraftResult {
  state: DraftState;
  /** A step to add to the layout, when the input made one. */
  step: TerrainStep | null;
  /** The limit that stopped the input, when one did. */
  refused: StepLimit | null;
}

const unchanged = (state: DraftState): DraftResult => ({
  state,
  step: null,
  refused: null,
});

/** Make the step from these points, which puts the tool down. */
function made(state: DraftState, points: Point[]): DraftResult {
  if (!state.tool) return unchanged(state);
  const step = draftStep(state.tool, points, state.settings);
  const refused = stepRefusal(step);
  if (refused) return { state: { ...state, points }, step: null, refused };
  return { state: { ...NO_DRAFT, settings: state.settings }, step, refused };
}

export function draftReduce(state: DraftState, input: DraftInput): DraftResult {
  switch (input.type) {
    case "pick":
      return unchanged({
        tool: input.tool,
        points: [],
        settings: draftDefaults(input.tool),
      });
    case "settings":
      return unchanged({
        ...state,
        settings: { ...state.settings, ...input.settings },
      });
    case "cancel":
      return unchanged(NO_DRAFT);
    case "escape":
      return unchanged(
        state.points.length > 0 ? { ...state, points: [] } : NO_DRAFT,
      );
    case "finish": {
      const { tool, points } = state;
      if (!tool || points.length === 0) return unchanged(NO_DRAFT);
      if (!enoughPoints(tool, points.length)) {
        return unchanged({ ...state, points: [] });
      }
      return made(state, points);
    }
    case "rectangle": {
      const { tool } = state;
      if ((tool !== "area" && tool !== "smooth") || state.points.length > 0) {
        return unchanged(state);
      }
      return made(state, input.corners);
    }
    case "click": {
      const { tool, points } = state;
      if (!tool) return unchanged(state);
      const at = snapPoint(input.at);
      const last = points[points.length - 1];
      // The second click of a double click lands where the first did.
      if (last && last.x === at.x && last.z === at.z) return unchanged(state);
      const closing =
        (tool === "area" || tool === "smooth") &&
        points.length >= 3 &&
        points[0].x === at.x &&
        points[0].z === at.z;
      if (closing) return made(state, points);
      const next = [...points, at];
      if (enoughPoints(tool, next.length)) {
        // Refused here rather than at the end, so a click that would take
        // the step past a limit is the one that does not land.
        const refused = stepRefusal(draftStep(tool, next, state.settings));
        if (refused) return { state, step: null, refused };
      }
      if (tool === "ramp" && next.length === 2) return made(state, next);
      return unchanged({ ...state, points: next });
    }
  }
}
