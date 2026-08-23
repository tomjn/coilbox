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
  /** Whether this is the preview describing the world rather than putting the
   *  unit through something. Almost no unit defines those call-ins, so a
   *  runtime saying it does not have one would say it about nearly every
   *  unit. */
  ambient?: boolean;
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

/** What one call-in that answers with a piece said. */
export interface ScriptProbe {
  /** Key in the script's `script` table, such as `QueryNanoPiece`. */
  callin: string;
  /** The pieces it named, in call order and with repeats kept, because the
   *  order is the cycle a multi-nozzle builder walks. */
  pieces: string[];
  /** Why it named nothing: no such call-in, a throw, or an answer that is not
   *  a piece of this unit. */
  note: string | null;
}

/** Every probe of one script, plus whatever stopped it loading at all. */
export interface ScriptProbes {
  pieces: string[];
  probes: ScriptProbe[];
  /** Set when nothing could be asked, in which case `probes` is empty. */
  error: string | null;
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
 * What the engine tells a unit standing on solid ground.
 *
 * `SFX_TERRAINTYPE_LAND` in `rts/Sim/Units/Unit.cpp`, where the others are
 * nothing (0) and two kinds of water (1 and 2).
 */
export const ON_LAND = 4;

/**
 * How every scenario starts: the unit exists, and it is standing on land.
 *
 * `Create` because the engine does it and because a script's rest pose is often
 * set there. `setSFXoccupy` because a unit does not work out what it is
 * standing on, the engine tells it, and a script that branches on the answer
 * gets nothing until something does. Expand and Exterminate's construction mech
 * only walks on land or shallow water and stands still on anything else, so
 * without this it never walks at all (#1940).
 *
 * Land rather than water because the viewport draws a unit on a ground plane,
 * and a preview should agree with what it is showing.
 *
 * Exported because anything that drives a script itself needs the same two
 * events for the same reason, not only the scenarios below.
 *
 * A frame after `Create` rather than alongside it, which is not a detail. A
 * script routinely starts its own `setSFXoccupy` from `Create` with no argument
 * at all, which sets the surface to nothing, and a started thread runs after
 * the call that started it. Told on the same frame, the unit is told and then
 * immediately un-told. The engine has the same order for the same reason: it
 * works the terrain out in the unit's update, which is a later frame than the
 * one the unit was made on.
 */
export const CREATED: ScriptEvent[] = [
  { frame: 0, callin: "Create" },
  { frame: 1, callin: "setSFXoccupy", args: [ON_LAND], ambient: true },
];

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
    events: [...CREATED, { frame: 0, callin: "StartMoving" }],
  },
  {
    id: "starting-stopping",
    label: "Starting and stopping",
    description: "Moves for half the preview, then stops, so both are visible.",
    events: [
      ...CREATED,
      { frame: 0, callin: "StartMoving" },
      { frame: at(PREVIEW_SECONDS / 2), callin: "StopMoving" },
    ],
  },
  {
    id: "idle",
    label: "Standing still",
    description: "Created and nothing else. Shows what a script does unasked.",
    events: CREATED,
  },
  {
    id: "active",
    label: "Switched on",
    description: "Activated, for a unit that opens or spins up when it is on.",
    events: [...CREATED, { frame: 0, callin: "Activate" }],
  },
  {
    id: "building",
    label: "Building (mobile)",
    description:
      "A construction unit reaching one way, stopping, then reaching the other. Its nanolathe is aimed, so this is the one with angles in it.",
    events: [
      ...CREATED,
      // Heading and pitch in radians, relative to the unit's own facing, which
      // is what the engine works out from the build target and hands over.
      { frame: at(0.5), callin: "StartBuilding", args: [0.7, -0.2] },
      { frame: at(2.5), callin: "StopBuilding" },
      { frame: at(3.5), callin: "StartBuilding", args: [-0.6, 0.15] },
      { frame: at(5.5), callin: "StopBuilding" },
    ],
  },
  {
    id: "building-factory",
    label: "Building (factory)",
    description:
      "A factory opening its yard and then building, which is a different pair of call-ins from a construction unit's.",
    events: [
      ...CREATED,
      // A factory is opened first. `CFactory::Update` calls `Activate` when the
      // yard opens and that is what sets the build stance, so a factory script
      // that animates its doors does it from here and most of them will not
      // animate a build at all until it has happened.
      { frame: at(0.5), callin: "Activate" },
      // No arguments. `CFactory::StartBuild` calls the no-argument form, unlike
      // a construction unit, which is handed a heading and a pitch to aim its
      // nanolathe with (`CBuilder`).
      { frame: at(1.5), callin: "StartBuilding" },
      { frame: at(4.5), callin: "StopBuilding" },
      { frame: at(5.5), callin: "Deactivate" },
    ],
  },
  {
    id: "destroyed",
    label: "Hit and destroyed",
    description:
      "Takes a hit, then dies. A unit's death is usually its biggest animation: pieces are thrown off and the rest is hidden.",
    events: [
      ...CREATED,
      // `HitByWeapon(dirX, dirZ, weaponDefID, damage)`, the direction the hit
      // came from and what it did. Straight on from the front, because a
      // flinch is easier to read when it is not also turning away.
      { frame: at(1), callin: "HitByWeapon", args: [0, 1, 0, 100] },
      // `Killed(recentDamage, maxHealth)`. A script works the severity out as
      // the ratio of the two and picks how thoroughly to come apart, so the
      // numbers matter only against each other. Half, which is the middle of
      // the three or four bands every script written from the same template
      // has, and the one that neither leaves the unit whole nor removes it.
      { frame: at(2), callin: "Killed", args: [50, 100] },
    ],
  },
  {
    id: "firing",
    label: "Aiming and firing",
    description: "Aims one way, fires, aims the other, fires again.",
    events: [
      ...CREATED,
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
