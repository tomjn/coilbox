/**
 * Playing a unit's own script in the viewport.
 *
 * A script animates in response to events, so a preview has to decide what
 * happens to the unit before it can show anything. That is what a scenario is:
 * a short list of call-ins and the frames to fire them on. The runtime in Rust
 * runs them and hands back a pose per frame, which the viewport plays the same
 * way it plays a preset's `track`.
 *
 * The scenarios live here rather than in Rust because they are wording as much
 * as timing: what the user picked from is the thing that has to make sense.
 */

/** A call-in to fire, and when. Frames are counted from the start of the run. */
export interface ScriptEvent {
  frame: number;
  callin: string;
  args?: number[];
}

/** What one run of a script produced. Mirrors the runtime's own report. */
export interface ScriptTimeline {
  fps: number;
  /** Piece names, in the order every frame's numbers are laid out. */
  pieces: string[];
  /** Per frame, six numbers per piece: x, y, z offset then x, y, z rotation. */
  frames: number[][];
  /** Per frame, one flag per piece, or empty when nothing was ever hidden. */
  hidden: boolean[][];
  /** What stopped the run early, if anything did. */
  error: string | null;
  /** What the run wants to say that did not stop it. */
  warnings: string[];
}

/**
 * How long a preview runs before it loops.
 *
 * Six seconds is two or three cycles of anything the presets generate, which is
 * enough to see a loop as a loop, and short enough that the wait before it
 * plays is not one.
 */
export const PREVIEW_SECONDS = 6;

/** Frames in a preview, at the sim rate the runtime works in. */
export const PREVIEW_FRAMES = PREVIEW_SECONDS * 30;

export interface Scenario {
  id: string;
  label: string;
  /** Why you would pick it, in the panel under the picker. */
  description: string;
  events: ScriptEvent[];
}

/** Seconds to frames, for writing a scenario in the units it reads in. */
function at(seconds: number): number {
  return Math.round(seconds * 30);
}

/**
 * What a preview can put a unit through.
 *
 * Every one of them starts with `Create`, because the engine does and because a
 * script's rest pose is often set there. The rest are the call-ins coilbox's own
 * generator writes, so a unit that took ownership of a generated script has a
 * scenario for everything in it.
 */
export const SCENARIOS: Scenario[] = [
  {
    id: "moving",
    label: "Moving",
    description: "Created, then told to move and left moving.",
    events: [
      { frame: 0, callin: "Create" },
      { frame: 0, callin: "StartMoving" },
    ],
  },
  {
    id: "starting-stopping",
    label: "Starting and stopping",
    description: "Moves for half the preview, then stops, so both are visible.",
    events: [
      { frame: 0, callin: "Create" },
      { frame: 0, callin: "StartMoving" },
      { frame: at(PREVIEW_SECONDS / 2), callin: "StopMoving" },
    ],
  },
  {
    id: "idle",
    label: "Standing still",
    description: "Created and nothing else. Shows what a script does unasked.",
    events: [{ frame: 0, callin: "Create" }],
  },
  {
    id: "active",
    label: "Switched on",
    description: "Activated, for a unit that opens or spins up when it is on.",
    events: [
      { frame: 0, callin: "Create" },
      { frame: 0, callin: "Activate" },
    ],
  },
  {
    id: "firing",
    label: "Aiming and firing",
    description: "Aims one way, fires, aims the other, fires again.",
    events: [
      { frame: 0, callin: "Create" },
      // Heading and pitch in radians, which is what the call-in is handed.
      { frame: at(0.5), callin: "AimWeapon1", args: [0.8, 0.15] },
      { frame: at(2), callin: "Shot1" },
      { frame: at(3), callin: "AimWeapon1", args: [-0.8, 0.3] },
      { frame: at(4.5), callin: "Shot1" },
    ],
  },
];

export function scenarioById(id: string): Scenario | undefined {
  return SCENARIOS.find((scenario) => scenario.id === id);
}

/**
 * Which frame of the timeline a moment belongs to, looping.
 *
 * A run that stopped early is looped at the length it reached, so a script that
 * threw two seconds in plays those two seconds over rather than freezing.
 */
export function frameAt(timeline: ScriptTimeline, seconds: number): number {
  const count = timeline.frames.length;
  if (count === 0) return -1;
  const frame = Math.floor(seconds * timeline.fps);
  return ((frame % count) + count) % count;
}

/** A piece's pose on one frame: x, y, z offset then x, y, z rotation. */
export function poseAt(
  timeline: ScriptTimeline,
  frame: number,
  piece: number,
): [number, number, number, number, number, number] | null {
  const row = timeline.frames[frame];
  if (!row) return null;
  const start = piece * 6;
  if (start + 6 > row.length) return null;
  return [
    row[start],
    row[start + 1],
    row[start + 2],
    row[start + 3],
    row[start + 4],
    row[start + 5],
  ];
}

/**
 * Keep a frame index inside the bounds of a timeline, for scrubbing and
 * stepping: a slider dragged past either end, or a step off the last frame,
 * lands on the frame nearest to it rather than wrapping or going nowhere.
 */
export function clampFrame(timeline: ScriptTimeline, frame: number): number {
  const count = timeline.frames.length;
  if (count === 0) return 0;
  return Math.min(Math.max(frame, 0), count - 1);
}

/** Whether a piece is hidden on a frame. Nothing is hidden when nothing was. */
export function hiddenAt(
  timeline: ScriptTimeline,
  frame: number,
  piece: number,
): boolean {
  return timeline.hidden[frame]?.[piece] ?? false;
}

/**
 * What to say about a run that produced no frames at all.
 *
 * A timeline with an error and frames is worth playing, and the error goes
 * beside it. A timeline with an error and nothing to play is only the error.
 */
export function playable(timeline: ScriptTimeline | null): boolean {
  return timeline !== null && timeline.frames.length > 0;
}
