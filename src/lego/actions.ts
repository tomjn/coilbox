/**
 * Actions (#3356): a named list of saved poses in time, written into the unit's
 * script as a thread of `Turn` and `Move` calls.
 *
 * A key is a saved pose (`pose.ts`) and the seconds to reach it from the key
 * before. The thread reaches each key on time by choosing the speed of every
 * `Turn` and `Move`: the distance on that axis divided by the seconds, because
 * the engine moves a piece at a constant rate toward its destination.
 *
 * Nothing here knows about the viewport. The preview plays an action by running
 * the script this writes, so what is shown is what an export would do.
 */

import { plural, t } from "@lingui/core/macro";
import type { LuaHook } from "./animPresets";
import { PRESETS } from "./animPresets";
import type {
  LegoAction,
  LegoActionTrack,
  LegoPiece,
  LegoPose,
  LegoProject,
} from "./model";
import { type PoseOffsets, withPieceOffset } from "./pose";
import { type Problem, problem } from "./problems";
import type { ScriptTimeline } from "./scriptPlayback";
import { luaString } from "./unitDef";
import { scriptWeapons } from "./weaponModule";

/** Sim frames per second, the engine's `GAME_SPEED`. */
export const FPS = 30;

/** Milliseconds per frame as the framework's `Sleep` counts them. See
 *  `SLEEP_FRAME_MS` in `animPresets.ts`. */
const SLEEP_FRAME_MS = 33;

/** The speed pieces return to rest at when a looping action is stopped, the
 *  one the presets' stop functions use. */
const REST_SPEED = 4;

const AXES = ["x_axis", "y_axis", "z_axis"];

/** The call-in that ends a looping action started by the key. */
export const STOP_CALLIN: Partial<Record<string, LuaHook>> = {
  StartMoving: "StopMoving",
  Activate: "Deactivate",
  StartBuilding: "StopBuilding",
};

const FIXED_TRIGGERS: LuaHook[] = [
  "Create",
  "StartMoving",
  "StopMoving",
  "Activate",
  "Deactivate",
  "StartBuilding",
  "StopBuilding",
];

/** The engine call-ins an action can be started by on this unit. */
export function actionHooks(project: LegoProject): string[] {
  const weapons = Math.max(1, scriptWeapons(project).length);
  return [
    ...FIXED_TRIGGERS,
    ...Array.from({ length: weapons }, (_, index) => `Shot${index + 1}`),
  ];
}

const RESERVED_WORDS = new Set([
  "and",
  "break",
  "do",
  "else",
  "elseif",
  "end",
  "false",
  "for",
  "function",
  "goto",
  "if",
  "in",
  "local",
  "nil",
  "not",
  "or",
  "repeat",
  "return",
  "then",
  "true",
  "until",
  "while",
]);

/** Names the script already defines, which a function of an action's own must
 *  not take: every call-in the generator writes. */
const ENGINE_NAMES =
  /^(Create|Killed|Start(Moving|Building)|Stop(Moving|Building)|Activate|Deactivate|QueryNanoPiece|(AimWeapon|AimFromWeapon|QueryWeapon|Shot)\d+)$/;

/** Whether the trigger is a call-in the engine makes. */
export function isHookTrigger(project: LegoProject, trigger: string): boolean {
  return actionHooks(project).includes(trigger);
}

/**
 * Why a trigger cannot start an action, or null when it can. A trigger is an
 * engine call-in from `actionHooks` or the name of a function of the action's
 * own, which has to be a Lua name the script does not already use.
 */
export function triggerProblem(
  project: LegoProject,
  trigger: string,
): string | null {
  if (isHookTrigger(project, trigger)) return null;
  if (!/^[A-Za-z_]\w*$/.test(trigger)) {
    return t`The function name needs letters, digits and underscores, and cannot start with a digit.`;
  }
  if (RESERVED_WORDS.has(trigger)) return t`${trigger} is a Lua keyword.`;
  if (ENGINE_NAMES.test(trigger)) {
    return t`${trigger} is a call-in this script already defines or the engine does not let an action start from.`;
  }
  return null;
}

/** A pose's offset on an axis: the destination of one `Turn` or `Move`. */
type Values = { turn: number[]; move: number[] };

const REST: Values = { turn: [0, 0, 0], move: [0, 0, 0] };

/** Rounded to the four places the script is written to, before anything is
 *  compared, so floating point dust is not read as movement. */
function round4(n: number): number {
  return Number(n.toFixed(4));
}

function lua(n: number): string {
  return round4(n).toString();
}

function valuesOf(pose: LegoPose, pieceId: string): Values {
  const offset = pose.pieces[pieceId];
  const pick = (v: number[] | undefined) =>
    [0, 1, 2].map((axis) => round4(v?.[axis] ?? 0));
  return { turn: pick(offset?.turn), move: pick(offset?.move) };
}

/** A key that can be written: its pose exists. `seconds` has the time of any
 *  key before it that could not be, so the action keeps its length. */
interface Step {
  pose: LegoPose;
  seconds: number;
}

/** The keys whose poses still exist. A key whose pose was deleted is skipped
 *  and its time goes to the key after it. */
export function liveSteps(action: LegoAction, project: LegoProject): Step[] {
  const poses = new Map((project.poses ?? []).map((pose) => [pose.id, pose]));
  const steps: Step[] = [];
  let carried = 0;
  for (const key of action.keys) {
    const pose = poses.get(key.pose);
    if (!pose) {
      carried += key.seconds;
      continue;
    }
    steps.push({ pose, seconds: key.seconds + carried });
    carried = 0;
  }
  return steps;
}

/** The pieces the action moves, in document order: those its tracks, or the
 *  poses of its live keys, name that the unit still has. */
export function actionPieces(
  action: LegoAction,
  project: LegoProject,
): LegoPiece[] {
  const named = new Set(
    action.tracks
      ? action.tracks.map((track) => track.piece)
      : liveSteps(action, project).flatMap((step) =>
          Object.keys(step.pose.pieces),
        ),
  );
  return project.pieces.filter((piece) => named.has(piece.id));
}

/** Frames a step lasts: whole frames, because `Sleep` waits whole frames and
 *  the engine moves a piece once a frame. Zero for a key with no time. */
function framesOf(seconds: number): number {
  return seconds <= 0 ? 0 : Math.max(1, Math.round(seconds * FPS));
}

interface Target {
  piece: LegoPiece;
  name: string;
}

/** The axes each piece moves on, by kind. */
interface Moved {
  turn: Map<string, Set<number>>;
  move: Map<string, Set<number>>;
}

/** The call a line makes: the engine's, or the one that also records where the
 *  piece is going when the unit blends (see `BLEND_HELPERS`). */
function callName(kind: "turn" | "move", tracked: boolean): string {
  if (kind === "turn") return tracked ? "ActTurn" : "Turn";
  return tracked ? "ActMove" : "Move";
}

const KINDS = ["turn", "move"];

// --- Tracks ------------------------------------------------------------------

/**
 * Pose keys as tracks. Each channel any live pose moves gets a key at every
 * key's frame, 0 where that pose leaves it alone. A frame is the running sum of
 * each key's seconds rounded to whole frames (`framesOf`). A track has one key
 * to a frame, so a key with no time of its own after a key that has been
 * reached goes one frame after it, and the keys after it keep their own sums.
 * Keys with no time on frame 0 are one pose, the last, because nothing has been
 * reached before them.
 *
 * A channel no pose moves has no track, because it never writes a call. Pieces
 * the poses name that the unit no longer has are kept, so lowering an action
 * loses nothing.
 */
export function actionTracks(
  action: LegoAction,
  project: LegoProject,
): LegoActionTrack[] {
  const steps = liveSteps(action, project);
  const frames: number[] = [];
  let at = 0;
  for (const step of steps) {
    at += framesOf(step.seconds);
    const last = frames[frames.length - 1];
    frames.push(last !== undefined && last > 0 && at <= last ? last + 1 : at);
  }

  const named = new Set(steps.flatMap((step) => Object.keys(step.pose.pieces)));
  const ids = [
    ...project.pieces.filter((piece) => named.has(piece.id)).map((p) => p.id),
    ...[...named].filter((id) => !project.pieces.some((p) => p.id === id)),
  ];

  const tracks: LegoActionTrack[] = [];
  for (const piece of ids) {
    for (const kind of KINDS as ("turn" | "move")[]) {
      for (const axis of [0, 1, 2] as const) {
        const values = steps.map(
          (step) => valuesOf(step.pose, piece)[kind][axis],
        );
        if (values.every((value) => value === 0)) continue;
        const keys: LegoActionTrack["keys"] = [];
        values.forEach((value, index) => {
          const last = keys[keys.length - 1];
          if (last && last.frame === frames[index]) last.value = value;
          else keys.push({ frame: frames[index], value });
        });
        tracks.push({ piece, kind, axis, keys });
      }
    }
  }
  return tracks;
}

/** The action with its pose keys lowered to tracks. An action that has tracks
 *  is returned as it is. */
export function withTracks(
  action: LegoAction,
  project: LegoProject,
): LegoAction {
  if (action.tracks) return action;
  return { ...action, keys: [], tracks: actionTracks(action, project) };
}

/**
 * The tracks without the keys that start no change and end no change: one that
 * repeats the value before it (the rest position before a channel's first key)
 * and is followed by a key with the same value, or by nothing. The script does
 * not write them, so a reader cannot bring them back. A track left with no keys
 * goes.
 *
 * A key on the action's first frame stays, because a blend in goes to the
 * values there. A looping action's lap is as long as its last key frame, so a
 * key on that frame stays too. Pass `loop` for a looping action.
 */
export function normaliseTracks(
  tracks: LegoActionTrack[],
  loop = false,
): LegoActionTrack[] {
  const frames = tracks.flatMap((track) => track.keys.map((k) => k.frame));
  const kept = new Set([
    Math.min(...frames),
    ...(loop ? [Math.max(...frames)] : []),
  ]);
  const out: LegoActionTrack[] = [];
  for (const track of tracks) {
    const value = (index: number) => round4(track.keys[index].value);
    const keys = track.keys.filter((key, i) => {
      if (kept.has(key.frame)) return true;
      const ends = value(i) !== (i === 0 ? 0 : value(i - 1));
      const next =
        i === track.keys.length - 1 ? (loop ? value(0) : null) : value(i + 1);
      const starts = next !== null && next !== value(i);
      return ends || starts;
    });
    if (keys.length > 0) out.push({ ...track, keys });
  }
  return out;
}

/** One channel of an action on a piece the unit has, its keys rounded as the
 *  script is written and in frame order. */
interface Channel {
  piece: LegoPiece;
  /** The piece's place in the unit, which is the order calls are written in. */
  order: number;
  kind: "turn" | "move";
  axis: 0 | 1 | 2;
  keys: { frame: number; value: number }[];
}

/** The channels the action writes: its tracks, or its pose keys lowered to
 *  tracks, without those of pieces the unit no longer has. */
function channelsOf(action: LegoAction, project: LegoProject): Channel[] {
  const tracks = action.tracks ?? actionTracks(action, project);
  const channels: Channel[] = [];
  for (const track of tracks) {
    const order = project.pieces.findIndex((p) => p.id === track.piece);
    if (order < 0) continue;
    const taken = channels.some(
      (c) =>
        c.order === order && c.kind === track.kind && c.axis === track.axis,
    );
    if (taken) continue;
    const byFrame = new Map<number, number>();
    for (const key of track.keys) {
      if (!Number.isFinite(key.frame) || !Number.isFinite(key.value)) continue;
      byFrame.set(Math.max(0, Math.round(key.frame)), round4(key.value));
    }
    if (byFrame.size === 0) continue;
    channels.push({
      piece: project.pieces[order],
      order,
      kind: track.kind,
      axis: track.axis,
      keys: [...byFrame]
        .sort((a, b) => a[0] - b[0])
        .map(([frame, value]) => ({ frame, value })),
    });
  }
  return channels.sort(
    (a, b) =>
      a.order - b.order ||
      KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind) ||
      a.axis - b.axis,
  );
}

/** How many of the action's tracks name a piece the unit no longer has. */
function deletedTracks(action: LegoAction, project: LegoProject): number {
  return (action.tracks ?? []).filter(
    (track) => !project.pieces.some((piece) => piece.id === track.piece),
  ).length;
}

// --- The plan ----------------------------------------------------------------

/** One `Turn` or `Move` the action's thread makes. */
export interface PlanCall {
  /** The frame it is made on, counted from the frame the thread starts, or for
   *  a call in `lap` from the start of the lap. */
  frame: number;
  /** A piece id. */
  piece: string;
  kind: "turn" | "move";
  axis: 0 | 1 | 2;
  dest: number;
  /** Radians or elmos a second. Absent puts the piece there at once. */
  speed?: number;
  /** Set on the call that blends in: the seconds to take from wherever the
   *  piece is, so its speed is not known until it plays. */
  blend?: number;
}

/**
 * What an action's thread does, decided once. `emitActions` prints it as Lua
 * and `bakeAction` plays it.
 *
 * The thread makes the `lead` calls, and a looping action then repeats `lap`.
 * `leadFrames` is the frame the lead waits until, which is where the lap starts,
 * and a lap is `lapFrames` long. A one shot action's thread ends after its last
 * call.
 */
export interface ActionPlan {
  /** The pieces the action moves, in the unit's order. */
  pieces: LegoPiece[];
  lead: PlanCall[];
  leadFrames: number;
  lap: PlanCall[];
  lapFrames: number;
  looping: boolean;
  /** Frames to play the lead until everything has stopped moving, or for a
   *  looping action the lead and one lap. */
  frames: number;
  /** The channels that make a call, in the order they are first called, with
   *  no blend. A blend out sends these home. */
  moved: { piece: string; kind: "turn" | "move"; axis: 0 | 1 | 2 }[];
}

/** A stretch of one channel from one value to another. */
interface Segment {
  channel: Channel;
  start: number;
  arrive: number;
  from: number;
  dest: number;
}

/**
 * The segments of one channel: the first key reached from rest starting on
 * frame 0, then key to key, and for a looping action the wrap from the last key
 * to the first, which arrives `length` frames after the first key's frame, where
 * the next lap has it.
 */
function segmentsOf(
  channel: Channel,
  loop: boolean,
  length: number,
): { first: Segment; between: Segment[]; wrap: Segment | null } {
  const keys = channel.keys;
  const segment = (
    a: { frame: number; value: number } | null,
    b: { frame: number; value: number },
    arrive = b.frame,
  ): Segment => ({
    channel,
    start: a?.frame ?? 0,
    arrive,
    from: a?.value ?? 0,
    dest: b.value,
  });
  return {
    first: segment(null, keys[0]),
    between: keys.slice(1).map((key, i) => segment(keys[i], key)),
    wrap: loop
      ? segment(keys[keys.length - 1], keys[0], length + keys[0].frame)
      : null,
  };
}

/** How far a turn of `delta` goes, as the engine takes it: the shorter way
 *  round, `fmod(delta + 3π, 2π) - π` (`UnitScript.cpp:142`). Exactly half a
 *  circle is the negative way. */
export function shortestTurn(delta: number): number {
  const tau = 2 * Math.PI;
  return ((((delta + 3 * Math.PI) % tau) + tau) % tau) - Math.PI;
}

/** The call a segment makes, or null when its value does not change. */
function callOf(segment: Segment, frame: number): PlanCall | null {
  if (segment.dest === segment.from) return null;
  const frames = segment.arrive - segment.start;
  const { channel } = segment;
  return {
    frame,
    piece: channel.piece.id,
    kind: channel.kind,
    axis: channel.axis,
    dest: segment.dest,
    ...(frames > 0
      ? { speed: Math.abs(segment.dest - segment.from) / (frames / FPS) }
      : {}),
  };
}

/** A call with what is needed to order it. */
interface Placed {
  call: PlanCall;
  channel: Channel;
  /** The frame its motion ends on. */
  arrive: number;
}

/** Calls in the order they are written: by frame, then the calls that put a
 *  piece there before those that set it moving, then piece, turn before move,
 *  x, y, z. The calls of a blend go turns first, as they always have. */
function ordered(placed: Placed[]): Placed[] {
  const rank = (p: Placed) => [
    p.call.speed === undefined && p.call.blend === undefined ? 0 : 1,
    p.call.blend !== undefined ? KINDS.indexOf(p.call.kind) : p.channel.order,
    p.call.blend !== undefined ? p.channel.order : KINDS.indexOf(p.call.kind),
    p.call.axis,
    p.arrive,
  ];
  return placed
    .map((p, index) => ({ p, index }))
    .sort((a, b) => {
      if (a.p.call.frame !== b.p.call.frame) {
        return a.p.call.frame - b.p.call.frame;
      }
      const ra = rank(a.p);
      const rb = rank(b.p);
      for (let i = 0; i < ra.length; i++) {
        if (ra[i] !== rb[i]) return ra[i] - rb[i];
      }
      return a.index - b.index;
    })
    .map(({ p }) => p);
}

/**
 * The thread an action writes, from its tracks. An action of pose keys is
 * lowered to tracks first, so one set of rules covers both. Null when it moves
 * no piece the unit has.
 *
 * - A channel with a segment that starts on a frame gets one call there, to its
 *   next key's value at the speed that arrives on that key's frame. A channel
 *   whose value does not change gets no call.
 * - A channel's first key is reached from rest, starting on frame 0.
 * - Calls on one frame are in piece order, then turn before move, then x, y, z.
 *   One `Sleep` waits for the next frame that has calls.
 * - A looping action's length is its last key frame over every channel. Each
 *   channel wraps from its last key to its first. The lead covers frames 0 to
 *   the length and the lap one lap after it.
 * - A one shot action ends after its last calls, with no `Sleep`.
 * - With a blend in, every channel that moves blends to its value on the first
 *   key frame over the blend time, and the lead goes on from there. A channel
 *   keyed later than that is part way along its way from rest, so it blends to
 *   where that is and goes on to its first key from there.
 */
export function planAction(
  action: LegoAction,
  project: LegoProject,
): ActionPlan | null {
  const channels = channelsOf(action, project);
  if (channels.length === 0) return null;

  const keyFrames = new Set(
    channels.flatMap((channel) => channel.keys.map((key) => key.frame)),
  );
  const length = Math.max(...keyFrames);
  const first = Math.min(...keyFrames);
  // A loop that never moves on from one frame has no lap.
  const looping = action.loop && keyFrames.size > 1;

  /** The lead and the lap. `blend` is the frames the blend in takes, if any. */
  const build = (blendFrames: number | null) => {
    const shift = blendFrames === null ? 0 : blendFrames - first;
    const lead: Placed[] = [];
    const lap: Placed[] = [];
    const add = (
      into: Placed[],
      segment: Segment,
      frame: number,
      moveBy = 0,
    ) => {
      const call = callOf(segment, frame + moveBy);
      if (call) {
        into.push({
          call,
          channel: segment.channel,
          arrive: segment.arrive + moveBy,
        });
      }
    };
    for (const channel of channels) {
      const parts = segmentsOf(channel, looping, length);
      const head = channel.keys[0];
      if (blendFrames === null) {
        add(lead, parts.first, 0);
      } else if (head.frame > first) {
        const reached = round4((head.value * first) / head.frame);
        add(
          lead,
          { ...parts.first, start: first, from: reached },
          first,
          shift,
        );
      }
      for (const segment of parts.between) {
        add(lead, segment, segment.start, shift);
        if (looping) add(lap, segment, segment.start);
      }
      const { wrap } = parts;
      if (wrap) {
        if (wrap.start < length) add(lead, wrap, wrap.start, shift);
        add(lap, wrap, wrap.start % length || 0);
      }
    }
    return { lead: ordered(lead), lap: ordered(lap), shift };
  };

  const plain = build(null);
  const moved: ActionPlan["moved"] = [];
  for (const { call } of [...plain.lead, ...plain.lap]) {
    const known = moved.some(
      (m) =>
        m.piece === call.piece && m.kind === call.kind && m.axis === call.axis,
    );
    if (!known)
      moved.push({ piece: call.piece, kind: call.kind, axis: call.axis });
  }

  const { blendIn } = blendOf(action, project);
  let { lead, lap } = plain;
  let leadFrames = length;
  if (blendIn > 0) {
    const blendFrames = framesOf(blendIn);
    const built = build(blendFrames);
    const blends: Placed[] = [];
    for (const channel of channels) {
      const goes = moved.some(
        (m) =>
          m.piece === channel.piece.id &&
          m.kind === channel.kind &&
          m.axis === channel.axis,
      );
      if (!goes) continue;
      const head = channel.keys[0];
      blends.push({
        call: {
          frame: 0,
          piece: channel.piece.id,
          kind: channel.kind,
          axis: channel.axis,
          dest:
            head.frame === first
              ? head.value
              : round4((head.value * first) / head.frame),
          blend: blendIn,
        },
        channel,
        arrive: blendFrames,
      });
    }
    lead = [...ordered(blends), ...built.lead];
    lap = built.lap;
    leadFrames = length + built.shift;
  }

  const pieces = project.pieces.filter((piece) =>
    channels.some((channel) => channel.piece.id === piece.id),
  );
  const calls = (placed: Placed[]) => placed.map(({ call }) => call);
  const all = lead.map((p) => p);
  // Frames until nothing is moving: a call with a speed ends where its segment
  // does, and one that puts a piece there ends on its own frame.
  const settled = Math.max(
    1,
    ...all.map((p) =>
      p.call.speed !== undefined || p.call.blend !== undefined
        ? p.arrive
        : p.call.frame + 1,
    ),
  );
  return {
    pieces,
    lead: calls(lead),
    leadFrames,
    lap: calls(lap),
    lapFrames: looping ? length : 0,
    looping,
    frames: looping ? leadFrames + length : settled,
    moved,
  };
}

/** Where a call's channel is in a baked frame: six numbers a piece, the move
 *  on x, y, z and then the turn on x, y, z. */
function slotIndex(
  project: LegoProject,
  call: { piece: string; kind: "turn" | "move"; axis: 0 | 1 | 2 },
): number {
  return (
    project.pieces.findIndex((piece) => piece.id === call.piece) * 6 +
    (call.kind === "turn" ? 3 : 0) +
    call.axis
  );
}

/**
 * An action played frame by frame, as the engine plays the script `emitActions`
 * writes for it: each piece goes to its destination at a constant speed, and a
 * turn takes the shorter way round (`shortestTurn`). A looping action plays its
 * lead and one lap, a one shot action its lead until everything has stopped.
 * It plays from rest, by itself, from the frame it starts.
 *
 * Frame `n` holds the pieces after the thread has made its calls on frame `n`
 * and the engine has moved every piece once. An angle is the number the script
 * wrote, not wrapped into one turn.
 *
 * The timeline has the unit's pieces in order and no frames when the action
 * moves none that the unit has. It carries the action's id, and what playback
 * does at its end: a looping action repeats its lap, a one shot action holds.
 */
export function bakeAction(
  action: LegoAction,
  project: LegoProject,
): ScriptTimeline {
  const timeline: ScriptTimeline = {
    fps: FPS,
    pieces: project.pieces.map((piece) => piece.name),
    frames: [],
    hidden: [],
    error: null,
    warnings: [],
    asked: [],
    functions: [],
    linesRun: [],
    offsetsRun: [],
    events: [],
    action: action.id,
  };
  const plan = planAction(action, project);
  if (!plan) return timeline;
  // A lap goes on from where the lead ended, and a one shot action holds.
  timeline.end = plan.looping ? { loopFrom: plan.leadFrames } : "hold";

  const slotOf = (call: PlanCall) => slotIndex(project, call);
  const calls = new Map<number, PlanCall[]>();
  const queue = (call: PlanCall, frame: number) =>
    calls.set(frame, [...(calls.get(frame) ?? []), call]);
  for (const call of plan.lead) queue(call, call.frame);
  if (plan.looping) {
    for (const call of plan.lap) queue(call, plan.leadFrames + call.frame);
  }

  const values = new Array<number>(project.pieces.length * 6).fill(0);
  const moving = new Map<number, { dest: number; speed: number }>();
  for (let frame = 0; frame < plan.frames; frame++) {
    for (const call of calls.get(frame) ?? []) {
      const slot = slotOf(call);
      const turns = call.kind === "turn";
      let speed = call.speed;
      if (call.blend !== undefined) {
        // A blend goes from where the piece is, by the way the engine will go.
        const way = turns
          ? shortestTurn(call.dest - values[slot])
          : call.dest - values[slot];
        speed = Math.abs(way) < 0.0001 ? undefined : Math.abs(way) / call.blend;
      }
      if (speed === undefined) {
        values[slot] = call.dest;
        moving.delete(slot);
      } else {
        moving.set(slot, { dest: call.dest, speed });
      }
    }
    for (const [slot, { dest, speed }] of moving) {
      const step = speed / FPS;
      const way =
        slot % 6 >= 3 ? shortestTurn(dest - values[slot]) : dest - values[slot];
      if (Math.abs(way) <= step) {
        values[slot] = dest;
        moving.delete(slot);
      } else {
        values[slot] += Math.sign(way) * step;
      }
    }
    timeline.frames.push(values.slice());
  }
  return timeline;
}

/** What emitting the actions of a unit adds to its script. */
export interface ActionEmit {
  /** `local SIG_... = "..."` lines. */
  signals: string[];
  /** Threads and their stop functions, written above the call-ins. */
  functions: string[];
  /** Lines to add to engine call-ins. */
  hooks: Partial<Record<string, string[]>>;
  /** Functions of an action's own, written below the call-ins. */
  own: string[];
}

function slug(name: string): string {
  return name.replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "");
}

/**
 * The lines that make `calls`, with a `Sleep` before each frame that has calls
 * to wait for it. `end` is the frame to wait until after the last call, which
 * is how long a lap lasts, and null for a thread that stops there.
 */
function planLines(
  calls: PlanCall[],
  end: number | null,
  indent: string,
  nameOf: (id: string) => string,
  tracked: boolean,
): string[] {
  const lines: string[] = [];
  let at = 0;
  for (const call of calls) {
    if (call.frame > at) {
      lines.push(`${indent}Sleep(${(call.frame - at) * SLEEP_FRAME_MS})`);
      at = call.frame;
    }
    const target = `${nameOf(call.piece)}, ${AXES[call.axis]}, ${lua(call.dest)}`;
    if (call.blend !== undefined) {
      const blend = call.kind === "turn" ? "BlendTurn" : "BlendMove";
      lines.push(`${indent}${blend}(${target}, ${lua(call.blend)})`);
    } else if (call.speed === undefined) {
      lines.push(`${indent}${callName(call.kind, tracked)}(${target})`);
    } else {
      lines.push(
        `${indent}${callName(call.kind, tracked)}(${target}, ${lua(call.speed)})`,
      );
    }
  }
  if (end !== null && end > at) {
    lines.push(`${indent}Sleep(${(end - at) * SLEEP_FRAME_MS})`);
  }
  return lines;
}

/**
 * The Lua for every action of the unit. `use` names a piece in the script, and
 * marks it so the script declares it. An action that moves no piece the unit
 * has writes nothing. Each action is written from its plan (`planAction`).
 *
 * A looping action first goes from rest to its first key, then loops from the
 * second key round to the first again, so every lap after the first is from
 * the key before it exactly as written. Its signal is a string and not a bit:
 * a unit with many presets and actions would run out of bits (the same reason
 * `buildLuaScript` names a weapon's).
 */
export function emitActions(
  project: LegoProject,
  use: (piece: LegoPiece) => string,
): ActionEmit {
  const out: ActionEmit = { signals: [], functions: [], hooks: {}, own: [] };
  const taken = new Set<string>();
  const addHook = (hook: string, lines: string[]) => {
    out.hooks[hook] = [...(out.hooks[hook] ?? []), ...lines];
  };

  const plans: Entry[] = [];
  for (const action of project.actions ?? []) {
    if (triggerProblem(project, action.trigger)) continue;
    const plan = planAction(action, project);
    if (!plan) continue;

    let base = slug(action.name) || "action";
    for (let n = 2; taken.has(base.toLowerCase()); n++) {
      base = `${slug(action.name) || "action"}_${n}`;
    }
    taken.add(base.toLowerCase());
    plans.push({
      action,
      plan,
      pieces: plan.pieces,
      thread: `action_${base}`,
      signal: `SIG_ACTION_${base.toUpperCase()}`,
      ...blendOf(action, project),
    });
  }

  // A unit blends when any action eases in or out. Then every action writes
  // through the helpers, because the action that is interrupted is whichever
  // one was running.
  const blending = unitBlends(project);
  if (blending) out.functions.push(...BLEND_HELPERS, "");

  for (const entry of plans) {
    const { action, plan, pieces, thread, signal, blendOut } = entry;
    const targets = pieces.map((piece) => ({ piece, name: use(piece) }));
    const nameOf = (id: string) =>
      targets.find((t) => t.piece.id === id)?.name as string;

    const moved: Moved = {
      turn: new Map<string, Set<number>>(),
      move: new Map<string, Set<number>>(),
    };
    for (const m of plan.moved) {
      const set = moved[m.kind].get(m.piece) ?? new Set<number>();
      set.add(m.axis);
      moved[m.kind].set(m.piece, set);
    }

    const lead = planLines(
      plan.lead,
      action.loop ? plan.leadFrames : null,
      "  ",
      nameOf,
      blending,
    );
    const loop = plan.looping
      ? planLines(plan.lap, plan.lapFrames, "    ", nameOf, blending)
      : [];
    const looping = plan.looping;

    // The pieces another action also moves. Whichever starts last takes them,
    // and the one it took them from no longer sends them home.
    const sharedWith = plans.filter(
      (other) =>
        other !== entry &&
        other.pieces.some((p) => pieces.some((mine) => mine.id === p.id)),
    );
    const sharedIds = new Set(
      pieces
        .filter((mine) =>
          sharedWith.some((other) =>
            other.pieces.some((p) => p.id === mine.id),
          ),
        )
        .map((piece) => piece.id),
    );

    const stop = STOP_CALLIN[action.trigger];
    const stopName = `${thread}Stop`;
    const restLine = (
      kind: "turn" | "move",
      id: string,
      axis: number,
    ): string => {
      const name = targets.find((t) => t.piece.id === id)?.name;
      if (!blending) {
        return `  ${callName(kind, false)}(${name}, ${AXES[axis]}, 0, ${REST_SPEED})`;
      }
      const call =
        blendOut > 0
          ? `Blend${kind === "turn" ? "Turn" : "Move"}(${name}, ${AXES[axis]}, 0, ${lua(blendOut)})`
          : `${callName(kind, true)}(${name}, ${AXES[axis]}, 0, ${REST_SPEED})`;
      return sharedIds.has(id)
        ? `  if ACT_OWNER[${name}] == ${signal} then ${call} end`
        : `  ${call}`;
    };
    const restLines = (["turn", "move"] as const).flatMap((kind) =>
      [...moved[kind]].flatMap(([id, axes]) =>
        [...axes].map((axis) => restLine(kind, id, axis)),
      ),
    );

    out.signals.push(`local ${signal} = ${luaString(signal)}`);
    out.functions.push(
      `-- Action: ${action.name.replace(/[\r\n]+/g, " ")}`,
      `local function ${thread}()`,
      `  SetSignalMask(${signal})`,
      ...lead,
      ...(looping ? ["  while true do", ...loop, "  end"] : []),
      "end",
    );
    if (looping && (stop || !isHookTrigger(project, action.trigger))) {
      out.functions.push(
        "",
        `local function ${stopName}()`,
        `  Signal(${signal})`,
        ...restLines,
        "end",
      );
    }
    out.functions.push("");

    const start = [`  Signal(${signal})`, `  StartThread(${thread})`];
    if (blending) {
      start.unshift(
        ...sharedWith.map((other) => `  Signal(${other.signal})`),
        ...targets
          .filter((t) => sharedIds.has(t.piece.id))
          .map((t) => `  ACT_OWNER[${t.name}] = ${signal}`),
      );
    }
    if (isHookTrigger(project, action.trigger)) {
      addHook(action.trigger, start);
      if (looping && stop) addHook(stop, [`  ${stopName}()`]);
    } else {
      out.own.push(`function script.${action.trigger}()`, ...start, "end", "");
      if (looping) {
        out.own.push(`function script.${action.trigger}Stop()`);
        out.own.push(`  ${stopName}()`, "end", "");
      }
    }
  }
  return out;
}

/** An action with the things emitting it needs settled first. */
interface Entry {
  action: LegoAction;
  plan: ActionPlan;
  pieces: LegoPiece[];
  thread: string;
  signal: string;
  blendIn: number;
  blendOut: number;
}

/** Seconds an action eases in over and out over: its own, or the project's. */
export function blendOf(
  action: LegoAction,
  project: LegoProject,
): { blendIn: number; blendOut: number } {
  const fallback = project.actionBlend ?? 0;
  return {
    blendIn: action.blendIn ?? fallback,
    blendOut: action.blendOut ?? fallback,
  };
}

/**
 * The helpers a blending unit's script carries. The engine and the preview
 * runtime both move a piece by `speed / 30` a frame toward its destination,
 * so these note each call an action makes and work out from the frames since
 * where the piece has got to. A blend starts from that.
 *
 * The engine can read a piece's angle back with `GetPieceRotation`
 * (`LuaUnitScript.cpp:1919`), but the preview's script runtime has no such
 * call, and a script that used it would not play there. `Spring.GetGameFrame`
 * is in both.
 */
const BLEND_HELPERS = [
  "-- Where the actions have left each piece, so a blend can start from there.",
  "local ACT_AT = {}",
  "local ACT_OWNER = {}",
  "",
  "local function act_entry(kind, p, axis)",
  '  local key = kind .. p .. ":" .. axis',
  "  local a = ACT_AT[key]",
  "  if not a then",
  '    a = { at = 0, to = 0, speed = 0, since = 0, turn = kind == "t" }',
  "    ACT_AT[key] = a",
  "  end",
  "  return a",
  "end",
  "",
  "-- The piece moves speed / 30 a frame, starting the frame of the call.",
  "local function act_now(a)",
  "  local travel = (Spring.GetGameFrame() - a.since) * a.speed / 30",
  "  local delta = a.to - a.at",
  "  if a.turn then",
  "    delta = math.fmod(delta + 3 * math.pi, 2 * math.pi) - math.pi",
  "  end",
  "  if travel <= 0 then",
  "    return a.at",
  "  elseif travel >= math.abs(delta) then",
  "    return a.to",
  "  end",
  "  local at = a.at + (delta > 0 and travel or -travel)",
  "  if a.turn and at > math.pi then",
  "    at = at - 2 * math.pi",
  "  elseif a.turn and at < -math.pi then",
  "    at = at + 2 * math.pi",
  "  end",
  "  return at",
  "end",
  "",
  "local function act_go(fn, kind, p, axis, to, speed)",
  "  local a = act_entry(kind, p, axis)",
  "  a.at = act_now(a)",
  "  a.since = Spring.GetGameFrame()",
  "  a.to = to",
  "  if speed then",
  "    a.speed = speed",
  "    fn(p, axis, to, speed)",
  "  else",
  "    a.at = to",
  "    a.speed = 0",
  "    fn(p, axis, to)",
  "  end",
  "end",
  "",
  "local function act_over(fn, kind, p, axis, to, seconds)",
  "  local a = act_entry(kind, p, axis)",
  "  local now = act_now(a)",
  "  local distance = math.abs(to - now)",
  '  if kind == "t" then',
  "    distance = math.abs(math.fmod(to - now + 3 * math.pi, 2 * math.pi) - math.pi)",
  "  end",
  "  if distance < 0.0001 then",
  "    act_go(fn, kind, p, axis, to)",
  "  else",
  "    act_go(fn, kind, p, axis, to, distance / seconds)",
  "  end",
  "end",
  "",
  'local function ActTurn(p, axis, to, speed) act_go(Turn, "t", p, axis, to, speed) end',
  'local function ActMove(p, axis, to, speed) act_go(Move, "m", p, axis, to, speed) end',
  'local function BlendTurn(p, axis, to, seconds) act_over(Turn, "t", p, axis, to, seconds) end',
  'local function BlendMove(p, axis, to, seconds) act_over(Move, "m", p, axis, to, seconds) end',
];

/**
 * The call-in the preview plays an action through, as a scenario id from
 * `scriptPlayback.ts`, or null for a function of its own, which the panel calls
 * by name. A looping action is played in a scenario that also sends its stop.
 */
export function actionScenario(
  project: LegoProject,
  action: LegoAction,
): string | null {
  if (!isHookTrigger(project, action.trigger)) return null;
  switch (action.trigger) {
    case "StartMoving":
    case "StopMoving":
      return "starting-stopping";
    case "Activate":
    case "Deactivate":
      return "take-off-landing";
    case "StartBuilding":
    case "StopBuilding":
      return "building";
    case "Create":
      return "idle";
    default:
      return "firing";
  }
}

/** The project with only one action in it and no presets: what a solo preview
 *  of the action runs, leaving the project itself alone. */
export function soloActionProject(
  project: LegoProject,
  actionId: string,
): LegoProject {
  return {
    ...project,
    animations: [],
    actions: (project.actions ?? []).filter((a) => a.id === actionId),
  };
}

/** A piece that an action moves and something else moves too. */
export interface ActionClash {
  action: LegoAction;
  piece: LegoPiece;
  /** What else moves it: another action's name or a preset's label. */
  with: string;
  /** The other action, when it is one and not a preset. */
  other?: LegoAction;
}

/**
 * Where an action and another action or a preset move the same piece. Two
 * motions on one piece at once fight. A unit that blends gives the piece to
 * whichever action started last (`emitActions`), and one that does not leaves
 * it to whichever call came last. Either way the game maker is told who shares
 * it.
 */
export function actionClashes(project: LegoProject): ActionClash[] {
  const actions = project.actions ?? [];
  const clashes: ActionClash[] = [];
  const presetPieces = (project.animations ?? []).flatMap((entry) => {
    const preset = PRESETS.find((p) => p.id === entry.presetId);
    if (!preset) return [];
    const roles = new Set(preset.animates);
    return [
      {
        label: preset.label,
        ids: new Set(
          project.pieces
            .filter(
              (piece) =>
                piece.role !== undefined &&
                (roles.has(piece.role) ||
                  (preset.moves?.(piece.role) ?? false)),
            )
            .map((piece) => piece.id),
        ),
      },
    ];
  });
  const owned = actions.map((action) => ({
    action,
    pieces: actionPieces(action, project),
  }));
  for (const { action, pieces } of owned) {
    for (const piece of pieces) {
      const actionsWith = owned
        .filter((o) => o.action.id !== action.id)
        .filter((o) => o.pieces.some((p) => p.id === piece.id));
      for (const o of actionsWith) {
        clashes.push({ action, piece, with: o.action.name, other: o.action });
      }
      for (const p of presetPieces.filter((p) => p.ids.has(piece.id))) {
        clashes.push({ action, piece, with: p.label });
      }
    }
  }
  return clashes;
}

/** What happens to a shared piece, in a few words. */
export function sharedOutcome(project: LegoProject): string {
  return unitBlends(project)
    ? t`The one started last takes it.`
    : t`The one called last wins.`;
}

/** Whether any action of the unit eases in or out, which is what makes its
 *  script track where the pieces are. */
export function unitBlends(project: LegoProject): boolean {
  return (project.actions ?? []).some((action) => {
    if (triggerProblem(project, action.trigger)) return false;
    if (channelsOf(action, project).length === 0) return false;
    const { blendIn, blendOut } = blendOf(action, project);
    return blendIn > 0 || blendOut > 0;
  });
}

/** The turns of an action that go half a circle or more between two keys. The
 *  engine takes the shorter way round, which is not the way the keys say, so the
 *  game maker is asked to add a key between them. The script is still written
 *  as the engine will play it. */
function turnProblems(
  action: LegoAction,
  channels: Channel[],
  keyFrames: Set<number>,
): Problem[] {
  const found: Problem[] = [];
  const looping = action.loop && keyFrames.size > 1;
  const length = Math.max(0, ...keyFrames);
  const actionName = action.name;
  for (const channel of channels) {
    if (channel.kind !== "turn") continue;
    const parts = segmentsOf(channel, looping, length);
    const segments = [parts.first, ...parts.between, parts.wrap];
    for (const segment of segments) {
      if (!segment || Math.abs(segment.dest - segment.from) < Math.PI) continue;
      const pieceName = channel.piece.name;
      const axisName = ["x", "y", "z"][channel.axis];
      const from = segment.start;
      const to = segment.arrive;
      found.push(
        problem(
          "actions",
          "warning",
          t`${actionName}: ${pieceName} turns on ${axisName} by half a circle or more between frames ${from} and ${to}, so the engine takes the shorter way round. Add a key between them.`,
          [channel.piece.id],
        ),
      );
    }
  }
  return found;
}

/** What is wrong with each action, for the problems list. */
export function actionProblems(project: LegoProject): Problem[] {
  const found: Problem[] = [];
  for (const action of project.actions ?? []) {
    const bad = triggerProblem(project, action.trigger);
    if (bad) {
      found.push(problem("actions", "error", `${action.name}: ${bad}`));
      continue;
    }
    const missing = action.keys.filter(
      (key) => !project.poses?.some((pose) => pose.id === key.pose),
    ).length;
    const actionName = action.name;
    if (missing > 0) {
      found.push(
        problem(
          "actions",
          "warning",
          plural(missing, {
            one: `${actionName}: # key names a pose that no longer exists, so it is skipped.`,
            other: `${actionName}: # keys name poses that no longer exist, so they are skipped.`,
          }),
        ),
      );
    }
    const gone = deletedTracks(action, project);
    if (gone > 0) {
      found.push(
        problem(
          "actions",
          "warning",
          plural(gone, {
            one: `${actionName}: # track names a piece that no longer exists, so it is skipped.`,
            other: `${actionName}: # tracks name pieces that no longer exist, so they are skipped.`,
          }),
        ),
      );
    }
    const channels = channelsOf(action, project);
    const keyFrames = new Set(
      channels.flatMap((channel) => channel.keys.map((key) => key.frame)),
    );
    const keyCount = action.tracks
      ? keyFrames.size
      : liveSteps(action, project).length;
    if (action.loop && keyCount < 2) {
      found.push(
        problem(
          "actions",
          "note",
          t`${actionName}: a looping action needs two keys to loop.`,
        ),
      );
    }
    found.push(...turnProblems(action, channels, keyFrames));
  }
  // Two actions that share a piece are one finding, told from the one listed
  // first.
  const listed = (project.actions ?? []).map((a) => a.id);
  const byPiece = new Map<string, ActionClash[]>();
  for (const clash of actionClashes(project)) {
    if (
      clash.other &&
      listed.indexOf(clash.other.id) < listed.indexOf(clash.action.id)
    ) {
      continue;
    }
    const key = `${clash.action.id}:${clash.with}`;
    byPiece.set(key, [...(byPiece.get(key) ?? []), clash]);
  }
  for (const group of byPiece.values()) {
    const { action, with: other } = group[0];
    const actionName = action.name;
    const pieces = group.map((c) => c.piece.name).join(", ");
    found.push(
      problem(
        "actions",
        "warning",
        `${t`${actionName} and ${other} both move ${pieces}.`} ${sharedOutcome(project)}`,
        group.map((c) => c.piece.id),
      ),
    );
  }
  return found;
}

// --- Editing. Each function is one edit of the document. -------------------

/** Seconds a new key takes to reach. */
export const DEFAULT_KEY_SECONDS = 0.5;

function mapAction(
  project: LegoProject,
  id: string,
  change: (action: LegoAction) => LegoAction,
): LegoProject {
  if (!project.actions?.some((a) => a.id === id)) return project;
  return {
    ...project,
    actions: project.actions.map((a) => (a.id === id ? change(a) : a)),
  };
}

/** A name no other action has: `base`, then `base 2`, ... */
export function freeActionName(project: LegoProject, base: string): string {
  const taken = new Set((project.actions ?? []).map((a) => a.name));
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    if (!taken.has(`${base} ${n}`)) return `${base} ${n}`;
  }
}

export function addAction(
  project: LegoProject,
  options: { id: string; name: string },
): LegoProject {
  const action: LegoAction = {
    id: options.id,
    name: freeActionName(project, options.name.trim() || "Action"),
    trigger: "StartMoving",
    loop: true,
    keys: [],
  };
  return { ...project, actions: [...(project.actions ?? []), action] };
}

/** Delete an action. The last one going takes the key with it. */
export function deleteAction(project: LegoProject, id: string): LegoProject {
  if (!project.actions?.some((a) => a.id === id)) return project;
  const { actions: _was, ...rest } = project;
  const actions = project.actions.filter((a) => a.id !== id);
  return actions.length > 0 ? { ...rest, actions } : rest;
}

/** Rename an action. A blank name, or one another action has, changes nothing. */
export function renameAction(
  project: LegoProject,
  id: string,
  name: string,
): LegoProject {
  const next = name.trim();
  if (next === "") return project;
  if (project.actions?.some((a) => a.id !== id && a.name === next)) {
    return project;
  }
  return mapAction(project, id, (a) => ({ ...a, name: next }));
}

export function setActionTrigger(
  project: LegoProject,
  id: string,
  trigger: string,
): LegoProject {
  return mapAction(project, id, (a) => ({ ...a, trigger }));
}

export function setActionLoop(
  project: LegoProject,
  id: string,
  loop: boolean,
): LegoProject {
  return mapAction(project, id, (a) => ({ ...a, loop }));
}

/** Set how long an action eases in or out over, in seconds. Null goes back to
 *  the project's time. Not negative and not a number that is not one. */
export function setActionBlend(
  project: LegoProject,
  id: string,
  which: "blendIn" | "blendOut",
  seconds: number | null,
): LegoProject {
  if (seconds !== null && (!Number.isFinite(seconds) || seconds < 0)) {
    return project;
  }
  return mapAction(project, id, (a) => {
    const { [which]: _was, ...rest } = a;
    return seconds === null ? rest : { ...rest, [which]: seconds };
  });
}

/** Set the blend time every action without one of its own uses. 0 removes it. */
export function setDefaultBlend(
  project: LegoProject,
  seconds: number,
): LegoProject {
  if (!Number.isFinite(seconds) || seconds < 0) return project;
  const { actionBlend: _was, ...rest } = project;
  return seconds === 0 ? rest : { ...rest, actionBlend: seconds };
}

/** Add a key for a pose at the end of the action. */
export function addKey(
  project: LegoProject,
  id: string,
  poseId: string,
  seconds = DEFAULT_KEY_SECONDS,
): LegoProject {
  if (!project.poses?.some((pose) => pose.id === poseId)) return project;
  return mapAction(project, id, (a) => ({
    ...a,
    keys: [...a.keys, { pose: poseId, seconds }],
  }));
}

export function removeKey(
  project: LegoProject,
  id: string,
  index: number,
): LegoProject {
  return mapAction(project, id, (a) => ({
    ...a,
    keys: a.keys.filter((_, at) => at !== index),
  }));
}

/** Move a key one place earlier (`by` -1) or later (1), with its time. */
export function moveKey(
  project: LegoProject,
  id: string,
  index: number,
  by: -1 | 1,
): LegoProject {
  return mapAction(project, id, (a) => {
    const to = index + by;
    if (index < 0 || index >= a.keys.length || to < 0 || to >= a.keys.length) {
      return a;
    }
    const keys = a.keys.slice();
    [keys[index], keys[to]] = [keys[to], keys[index]];
    return { ...a, keys };
  });
}

export function setKeyPose(
  project: LegoProject,
  id: string,
  index: number,
  poseId: string,
): LegoProject {
  if (!project.poses?.some((pose) => pose.id === poseId)) return project;
  return mapAction(project, id, (a) => ({
    ...a,
    keys: a.keys.map((key, at) =>
      at === index ? { ...key, pose: poseId } : key,
    ),
  }));
}

/** Set the time to a key. Not negative and not a number that is not one. */
export function setKeySeconds(
  project: LegoProject,
  id: string,
  index: number,
  seconds: number,
): LegoProject {
  if (!Number.isFinite(seconds) || seconds < 0) return project;
  return mapAction(project, id, (a) => ({
    ...a,
    keys: a.keys.map((key, at) => (at === index ? { ...key, seconds } : key)),
  }));
}

// --- Keying on the timeline (#5397) ------------------------------------------
//
// Positions here are ruler frames, the frames of `bakeAction`'s preview, which
// are the action's own frames plus the frames a blend in takes before the first
// key (`actionShift`). A key is stored on the action's own frame.

/** One channel of a piece: what a track is for. */
export interface ChannelRef {
  piece: string;
  kind: "turn" | "move";
  axis: 0 | 1 | 2;
}

/** A channel and the value to key on it, in radians or elmos. */
export interface ChannelValue extends ChannelRef {
  value: number;
}

/** How far a blend in moves the keys on the ruler: a key on action frame `n` is
 *  on ruler frame `n + shift`, because the blend takes the place of the time
 *  before the first key. Zero when there is no blend in. */
export function actionShift(action: LegoAction, project: LegoProject): number {
  const plan = planAction(action, project);
  if (!plan) return 0;
  const frames = channelsOf(action, project).flatMap((channel) =>
    channel.keys.map((key) => key.frame),
  );
  return plan.leadFrames - Math.max(...frames);
}

/** The first ruler frame a key can be written on. A blend in takes the frames
 *  before the first key, and the pieces are mid blend on them, so nothing there
 *  has a value to key. Without a blend in, every frame can be keyed. */
function keyableFrom(action: LegoAction, project: LegoProject): number {
  if (blendOf(action, project).blendIn <= 0) return 0;
  const frames = channelsOf(action, project).flatMap((channel) =>
    channel.keys.map((key) => key.frame),
  );
  return frames.length === 0
    ? 0
    : Math.min(...frames) + actionShift(action, project);
}

/**
 * The pose the action has on a ruler frame, as the offsets pose mode holds: what
 * the unit looks like after that many frames of the action. A key is on its own
 * frame with its own value, so a diamond and the pose under it agree. Frame 0 is
 * the rest pose with any key that jumps on that frame applied.
 *
 * Past the end of the preview, and for a one shot action once everything has
 * stopped, it is the last pose. An action that moves nothing is at rest.
 *
 * Pass the action's `bakeAction` timeline when there is one, to not bake it
 * again.
 */
export function actionPoseAt(
  action: LegoAction,
  project: LegoProject,
  frame: number,
  baked: ScriptTimeline = bakeAction(action, project),
): PoseOffsets {
  const { frames } = baked;
  if (frames.length === 0) return {};
  let values: number[];
  if (frame <= 0) {
    values = new Array<number>(project.pieces.length * 6).fill(0);
    for (const call of planAction(action, project)?.lead ?? []) {
      if (call.frame !== 0) continue;
      if (call.speed !== undefined || call.blend !== undefined) continue;
      values[slotIndex(project, call)] = call.dest;
    }
  } else {
    values = frames[Math.min(frame, frames.length) - 1];
  }
  let offsets: PoseOffsets = {};
  project.pieces.forEach((piece, index) => {
    const v = values.slice(index * 6, index * 6 + 6).map(round4);
    offsets = withPieceOffset(offsets, piece.id, {
      move: [v[0], v[1], v[2]],
      turn: [v[3], v[4], v[5]],
    });
  });
  return offsets;
}

/**
 * The channels whose value in `held` differs from the action's own on a ruler
 * frame, with the held value. Empty while a blend in is under way, which has
 * no key to write.
 */
export function poseChanges(
  action: LegoAction,
  project: LegoProject,
  frame: number,
  held: PoseOffsets,
  baked?: ScriptTimeline,
): ChannelValue[] {
  if (frame < keyableFrom(action, project)) return [];
  const base = actionPoseAt(action, project, frame, baked);
  const changes: ChannelValue[] = [];
  for (const piece of project.pieces) {
    for (const kind of KINDS as ("turn" | "move")[]) {
      for (const axis of [0, 1, 2] as const) {
        const was = base[piece.id]?.[kind]?.[axis] ?? 0;
        const now = held[piece.id]?.[kind]?.[axis] ?? 0;
        if (round4(now) !== round4(was)) {
          changes.push({ piece: piece.id, kind, axis, value: round4(now) });
        }
      }
    }
  }
  return changes;
}

const sameChannel = (a: ChannelRef, b: ChannelRef) =>
  a.piece === b.piece && a.kind === b.kind && a.axis === b.axis;

/** An action's tracks with a key set on one channel's track, which is made if the
 *  action has none for it. A key already on the frame is replaced. */
function withKey(
  tracks: LegoActionTrack[],
  channel: ChannelValue,
  frame: number,
): LegoActionTrack[] {
  const key = { frame, value: channel.value };
  const place = (keys: LegoActionTrack["keys"]) =>
    [...keys.filter((k) => k.frame !== frame), key].sort(
      (a, b) => a.frame - b.frame,
    );
  if (!tracks.some((track) => sameChannel(track, channel))) {
    return [
      ...tracks,
      {
        piece: channel.piece,
        kind: channel.kind,
        axis: channel.axis,
        keys: [key],
      },
    ];
  }
  return tracks.map((track) =>
    sameChannel(track, channel) ? { ...track, keys: place(track.keys) } : track,
  );
}

/** Lower an action's pose keys to tracks, in one edit. An action that has tracks
 *  is left as it is. */
export function convertToTracks(project: LegoProject, id: string): LegoProject {
  const action = project.actions?.find((a) => a.id === id);
  if (!action || action.tracks) return project;
  return mapAction(project, id, (a) => withTracks(a, project));
}

/**
 * Key every channel whose held value differs from the action's on a ruler frame.
 * A key already on the frame is replaced, and a channel with no track gets one.
 * An action of pose keys becomes tracks in the same edit, so one undo puts the
 * pose keys back. Nothing changes when no channel differs.
 */
export function keyFromPose(
  project: LegoProject,
  id: string,
  frame: number,
  held: PoseOffsets,
): LegoProject {
  const action = project.actions?.find((a) => a.id === id);
  if (!action) return project;
  const changes = poseChanges(action, project, frame, held);
  if (changes.length === 0) return project;
  const at = frame - actionShift(action, project);
  return mapAction(project, id, (a) => {
    const lowered = withTracks(a, project);
    const tracks = changes.reduce(
      (all, change) => withKey(all, change, at),
      lowered.tracks ?? [],
    );
    return { ...lowered, tracks };
  });
}

/**
 * Set the value of the key a channel has on a ruler frame, in radians for a turn
 * and elmos for a move. One edit, which converts an action of pose keys to
 * tracks first. Nothing changes when there is no such key, or its value is that
 * already.
 */
export function setKeyValue(
  project: LegoProject,
  id: string,
  channel: ChannelRef,
  frame: number,
  value: number,
): LegoProject {
  const action = project.actions?.find((a) => a.id === id);
  if (!action || !Number.isFinite(value)) return project;
  const at = frame - actionShift(action, project);
  const lowered = withTracks(action, project);
  const key = lowered.tracks
    ?.find((track) => sameChannel(track, channel))
    ?.keys.find((k) => k.frame === at);
  if (!key || round4(key.value) === round4(value)) return project;
  return mapAction(project, id, () => ({
    ...lowered,
    tracks: withKey(lowered.tracks ?? [], { ...channel, value }, at),
  }));
}

// --- Moving and deleting keys (#5398) ------------------------------------------

/** A key on a channel, by its ruler frame. */
export interface KeyRef extends ChannelRef {
  frame: number;
}

/**
 * The earliest offset a move of these keys can have: the one that puts the
 * first of them on frame 0, the action's first instant. A key cannot go before
 * it, because a `Sleep` cannot wait a negative time. Zero for no keys.
 */
export function earliestMove(
  action: LegoAction,
  project: LegoProject,
  keys: KeyRef[],
): number {
  if (keys.length === 0) return 0;
  const shift = actionShift(action, project);
  return -Math.min(...keys.map((key) => key.frame - shift));
}

/**
 * Move keys by a whole number of frames, in one edit. Each key goes with its own
 * value, on its own channel. An action of pose keys becomes tracks in the same
 * edit.
 *
 * Nothing changes when a key would land before frame 0, or on a frame its
 * channel already keys, which is the same as the key going back where it was.
 * The whole move is refused, so a piece's keys never part. With a blend in the
 * keys are named by ruler frame and the offset is in the action's own frames,
 * which are the same distance.
 */
export function moveKeys(
  project: LegoProject,
  id: string,
  keys: KeyRef[],
  by: number,
): LegoProject {
  const action = project.actions?.find((a) => a.id === id);
  if (!action || !Number.isInteger(by) || by === 0) return project;
  const shift = actionShift(action, project);
  const lowered = withTracks(action, project);
  const tracks = lowered.tracks ?? [];

  // The action frames to move, on each track that has keys there.
  const moving = new Map<LegoActionTrack, Set<number>>();
  for (const ref of keys) {
    const at = ref.frame - shift;
    const track = tracks.find((t) => sameChannel(t, ref));
    if (!track?.keys.some((k) => k.frame === at)) continue;
    moving.set(track, (moving.get(track) ?? new Set<number>()).add(at));
  }
  if (moving.size === 0) return project;

  for (const [track, frames] of moving) {
    for (const at of frames) {
      const to = at + by;
      if (to < 0) return project;
      if (!frames.has(to) && track.keys.some((k) => k.frame === to)) {
        return project;
      }
    }
  }

  return mapAction(project, id, () => ({
    ...lowered,
    tracks: tracks.map((track) => {
      const frames = moving.get(track);
      if (!frames) return track;
      return {
        ...track,
        keys: track.keys
          .map((k) => (frames.has(k.frame) ? { ...k, frame: k.frame + by } : k))
          .sort((a, b) => a.frame - b.frame),
      };
    }),
  }));
}

/**
 * Delete keys by ruler frame, in one edit. A track left with no keys goes, and
 * an action of pose keys becomes tracks in the same edit. Nothing changes when
 * none of the keys exist.
 */
export function deleteKeys(
  project: LegoProject,
  id: string,
  keys: KeyRef[],
): LegoProject {
  const action = project.actions?.find((a) => a.id === id);
  if (!action) return project;
  const shift = actionShift(action, project);
  const lowered = withTracks(action, project);
  let removed = false;
  const tracks: LegoActionTrack[] = [];
  for (const track of lowered.tracks ?? []) {
    const kept = track.keys.filter((k) => {
      const gone = keys.some(
        (ref) => sameChannel(ref, track) && ref.frame - shift === k.frame,
      );
      removed ||= gone;
      return !gone;
    });
    if (kept.length === track.keys.length) tracks.push(track);
    else if (kept.length > 0) tracks.push({ ...track, keys: kept });
  }
  if (!removed) return project;
  return mapAction(project, id, () => ({ ...lowered, tracks }));
}
