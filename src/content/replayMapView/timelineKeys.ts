/**
 * The keys of the replay page's timeline (#3808), in one table.
 *
 * The in-engine timeline of the milestone "Replay rewind: play it back in the
 * engine" is not built yet, so these are the conventional keys of a media
 * player. That milestone should match this table, which issue #3794 carries.
 */

/** What one arrow press moves, and what one with Shift held moves. Product
 *  choices, not measurements. */
export const STEP_SECONDS = 1;
export const LARGE_STEP_SECONDS = 10;

export type TimelineAction =
  | { type: "toggle" }
  | { type: "reverse" }
  | { type: "step"; seconds: number }
  | { type: "frame"; frames: number }
  | { type: "start" }
  | { type: "end" }
  | { type: "mark"; direction: 1 | -1 }
  | { type: "faster" }
  | { type: "slower" };

interface KeyRow {
  /** Values of `KeyboardEvent.key` that do it. */
  keys: string[];
  /** Whether Shift must be held. Absent means it is not looked at. */
  shift?: boolean;
  action: TimelineAction;
  /** The key as the help names it. */
  show: string;
  /** What it does, for the help. */
  does: string;
}

export const TIMELINE_KEYS: readonly KeyRow[] = [
  {
    keys: [" "],
    action: { type: "toggle" },
    show: "Space",
    does: "Play or pause",
  },
  {
    keys: ["r"],
    action: { type: "reverse" },
    show: "R",
    does: "Play the other way",
  },
  {
    keys: ["ArrowLeft"],
    shift: false,
    action: { type: "step", seconds: -STEP_SECONDS },
    show: "Left",
    does: `Back ${STEP_SECONDS} second`,
  },
  {
    keys: ["ArrowRight"],
    shift: false,
    action: { type: "step", seconds: STEP_SECONDS },
    show: "Right",
    does: `Forward ${STEP_SECONDS} second`,
  },
  {
    keys: ["ArrowLeft"],
    shift: true,
    action: { type: "step", seconds: -LARGE_STEP_SECONDS },
    show: "Shift and Left",
    does: `Back ${LARGE_STEP_SECONDS} seconds`,
  },
  {
    keys: ["ArrowRight"],
    shift: true,
    action: { type: "step", seconds: LARGE_STEP_SECONDS },
    show: "Shift and Right",
    does: `Forward ${LARGE_STEP_SECONDS} seconds`,
  },
  {
    keys: [","],
    action: { type: "frame", frames: -1 },
    show: ",",
    does: "Back one frame",
  },
  {
    keys: ["."],
    action: { type: "frame", frames: 1 },
    show: ".",
    does: "Forward one frame",
  },
  {
    keys: ["Home"],
    action: { type: "start" },
    show: "Home",
    does: "Go to the start",
  },
  {
    keys: ["End"],
    action: { type: "end" },
    show: "End",
    does: "Go to the end",
  },
  {
    keys: ["["],
    action: { type: "mark", direction: -1 },
    show: "[",
    does: "Go to the previous mark",
  },
  {
    keys: ["]"],
    action: { type: "mark", direction: 1 },
    show: "]",
    does: "Go to the next mark",
  },
  {
    keys: ["-"],
    action: { type: "slower" },
    show: "-",
    does: "Slower",
  },
  {
    keys: ["=", "+"],
    action: { type: "faster" },
    show: "+",
    does: "Faster",
  },
];

/** The action a key press asks for, or null when it is not one of ours. A key
 *  held with Ctrl, Alt or Meta belongs to the browser or the system. */
export function actionFor(event: {
  key: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}): TimelineAction | null {
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  const row = TIMELINE_KEYS.find(
    (r) =>
      r.keys.includes(event.key) &&
      (r.shift === undefined || r.shift === event.shiftKey),
  );
  return row?.action ?? null;
}
