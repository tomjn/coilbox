/**
 * What a key press on the map means (issue #2269).
 *
 * A 3D view has no tab order and no rows to arrow through, so the keyboard
 * model here is a small fixed table rather than anything the browser gives for
 * free. This file is the table, and nothing else: no document, no scene, no
 * React. What each action then does to the scenario is `mapKeyboard.ts`, and
 * where the two are wired together is `useMapKeyboard.ts`.
 *
 * Two decisions are worth writing down.
 *
 * The arrows are compass directions rather than screen directions. The view can
 * be turned with a right-drag, so "up the screen" is not a fixed thing, and it
 * is not a thing that can be said out loud either. "North" is both. So Up is
 * north whatever the camera is doing, and every announcement can name the
 * direction it moved.
 *
 * Everything an author would type is left alone. A press carrying Ctrl or the
 * Command key is not ours, so undo, redo and every browser and window shortcut
 * still work while the map has the focus.
 */

import { BUILD_SQUARE } from "@/blueprint/footprint";
import type { Point } from "@/scenario/model";

/**
 * The step an arrow takes, in elmos.
 *
 * One build square, because that is the grid every building in the document is
 * standing on: an arrow press moves a building to the next square it can
 * legally occupy rather than to a place the engine would refuse.
 */
export const STEP_ELMOS = BUILD_SQUARE;

/** How many squares Shift takes at once, for crossing a map rather than
 *  adjusting a building. */
export const COARSE_SQUARES = 10;

/** The finest step there is, in elmos. A scenario stores whole elmos, so this
 *  is as small as a move can be. */
export const FINE_ELMOS = 1;

/** What the map does about one key press. */
export type MapKeyAction =
  /** Move what is selected, `delta` elmos. */
  | { kind: "move"; delta: Point; step: number; heading: Heading }
  /** Nothing is selected, so the view's own cursor moves instead. */
  | { kind: "pan"; delta: Point; step: number; heading: Heading }
  /** Select the next or previous thing the map holds. */
  | { kind: "cycle"; by: 1 | -1 }
  /** Turn what is selected a quarter turn. */
  | { kind: "turn"; steps: 1 | -1 }
  | { kind: "delete" }
  /** Act at the cursor: answer whatever the map is waiting for, or place what
   *  the current mode places. */
  | { kind: "act" }
  /** Let go of the selection. */
  | { kind: "clear" }
  /** Read the key list out. */
  | { kind: "help" };

/** A compass direction, which is what an arrow means and what an announcement
 *  says. */
export type Heading = "north" | "south" | "east" | "west";

/** The bare parts of a key event this reads, so it can be called with a plain
 *  object in a test. */
export interface MapKeyPress {
  key: string;
  shiftKey?: boolean;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
}

/** What the map holds at the moment of the press. */
export interface MapKeyState {
  /** Whether anything is selected, which is what decides between moving a
   *  thing and moving the cursor. */
  selected: boolean;
}

/** Engine coordinates run east and south from the map's north-west corner. */
const HEADINGS: Record<string, { heading: Heading; x: number; z: number }> = {
  ArrowUp: { heading: "north", x: 0, z: -1 },
  ArrowDown: { heading: "south", x: 0, z: 1 },
  ArrowLeft: { heading: "west", x: -1, z: 0 },
  ArrowRight: { heading: "east", x: 1, z: 0 },
};

/**
 * How far one arrow press goes.
 *
 * Alt is the fine step and Shift the coarse one, which is the nudge scheme
 * every drawing program uses, so an author who has used one has used this.
 * Alt wins when both are held, because asking for the fine step and getting ten
 * squares would be the worse surprise.
 */
export function stepElmos(press: MapKeyPress): number {
  if (press.altKey) return FINE_ELMOS;
  if (press.shiftKey) return STEP_ELMOS * COARSE_SQUARES;
  return STEP_ELMOS;
}

/**
 * What a press on the map means, or null when it means nothing here and should
 * be left to whatever else is listening.
 *
 * Next and previous are the comma and full stop keys, and their shifted forms
 * are taken too: on a layout where the full stop needs Shift, the key still
 * reads as `>` and the author still gets the next thing.
 */
export function mapKeyAction(
  press: MapKeyPress,
  state: MapKeyState,
): MapKeyAction | null {
  // Not ours. Undo, redo and every window shortcut keep working over the map.
  if (press.ctrlKey || press.metaKey) return null;

  const arrow = HEADINGS[press.key];
  if (arrow) {
    const step = stepElmos(press);
    const delta = { x: arrow.x * step, z: arrow.z * step };
    return state.selected
      ? { kind: "move", delta, step, heading: arrow.heading }
      : { kind: "pan", delta, step, heading: arrow.heading };
  }

  switch (press.key) {
    case ".":
    case ">":
      return { kind: "cycle", by: 1 };
    case ",":
    case "<":
      return { kind: "cycle", by: -1 };
    case "r":
      return state.selected ? { kind: "turn", steps: 1 } : null;
    case "R":
      return state.selected ? { kind: "turn", steps: -1 } : null;
    case "Delete":
    case "Backspace":
      return state.selected ? { kind: "delete" } : null;
    case "Enter":
      return { kind: "act" };
    case "Escape":
      // Only when there is something to let go of. Otherwise Escape keeps
      // every meaning it already has: dropping the building the Bases mode is
      // carrying, and leaving the expanded view.
      return state.selected ? { kind: "clear" } : null;
    case "?":
      return { kind: "help" };
    default:
      return null;
  }
}
