/**
 * Import a Lua unit script into a unit (#643): from a file, or from a unit of
 * a game.
 *
 * The script's piece names are matched to the unit's. A name the unit has, as
 * coilbox spells it or as the model file did, stays. A name that differs from
 * one of the unit's only in case is rewritten to the unit's spelling, because
 * an `.s3o` keeps its piece names exactly and a script asking for `Arm` on a
 * model whose piece is `arm` fails to load. Anything else is left as written
 * and reported, for the Script tab to offer a rename.
 *
 * A simple script is read back as actions (`actions.ts`), so the builder can
 * edit it: poses when every piece arrives as the next `Sleep` ends, tracks when
 * pieces arrive on different frames or the unit blends. Anything else becomes the unit's own
 * script, exactly as imported apart from the case renames. Reading back is all
 * or nothing: if any part of the script is outside what {@link readActions}
 * recognises, none of it is taken apart.
 */

import { plural, t } from "@lingui/core/macro";
import {
  actionHooks,
  BLEND_HELPERS,
  framesOf,
  type PlanCall,
  planAction,
  STOP_CALLIN,
  triggerProblem,
  unitBlends,
} from "./actions";
import { pieceNameLiterals, renameScriptPieces } from "./luaPieces";
import { buildLuaScript } from "./luaScript";
import type {
  LegoAction,
  LegoActionTrack,
  LegoPiece,
  LegoPose,
  LegoProject,
} from "./model";
import { freePoseName } from "./pose";

/** Sim frames per second, and milliseconds per frame as `Sleep` counts them.
 *  The same two numbers `actions.ts` writes with. */
const FPS = 30;
const SLEEP_FRAME_MS = 33;

const AXES = ["x_axis", "y_axis", "z_axis"];

/** How a script's piece names line up with the unit's. */
export interface PieceMatch {
  /** Names rewritten to the unit's spelling, which differed only in case. */
  renamed: { from: string; to: string }[];
  /** Names the unit has no piece for, each once, in script order. */
  unmatched: string[];
}

/** The names a piece answers to: coilbox's, and the model file's own. */
function namesOf(piece: LegoPiece): string[] {
  return piece.originalName ? [piece.name, piece.originalName] : [piece.name];
}

/** The unit's piece a script name means, or null. Exact first, then by case. */
function pieceFor(pieces: LegoPiece[], name: string): LegoPiece | null {
  const exact = pieces.find((piece) => namesOf(piece).includes(name));
  if (exact) return exact;
  const lower = name.toLowerCase();
  const loose = pieces.filter((piece) =>
    namesOf(piece).some((n) => n.toLowerCase() === lower),
  );
  return loose.length === 1 ? loose[0] : null;
}

/** Match the script's piece names to the unit's, and rewrite the ones that
 *  differ only in case. */
export function matchScriptPieces(
  lua: string,
  pieces: LegoPiece[],
): PieceMatch & { lua: string } {
  const renamed: PieceMatch["renamed"] = [];
  const unmatched: string[] = [];
  const mapping: Record<string, string> = {};
  const names = [...new Set(pieceNameLiterals(lua).map((l) => l.name))];
  for (const name of names) {
    const piece = pieceFor(pieces, name);
    if (!piece) unmatched.push(name);
    else if (!namesOf(piece).includes(name)) {
      mapping[name] = piece.name;
      renamed.push({ from: name, to: piece.name });
    }
  }
  return { lua: renameScriptPieces(lua, mapping), renamed, unmatched };
}

// --- Reading a script back into actions. ------------------------------------

const NUMBER = String.raw`-?\d+(?:\.\d+)?`;
const NAME = String.raw`[A-Za-z_]\w*`;
/** `Turn` or `Move`, or `ActTurn` or `ActMove`, which a unit that blends writes
 *  instead. */
const MOVE_LINE = new RegExp(
  String.raw`^(Act)?(Turn|Move)\(\s*(${NAME})\s*,\s*([xyz]_axis)\s*,\s*(${NUMBER})\s*(?:,\s*(${NUMBER})\s*)?\)$`,
);
const BLEND_LINE = new RegExp(
  String.raw`^Blend(Turn|Move)\(\s*(${NAME})\s*,\s*([xyz]_axis)\s*,\s*(${NUMBER})\s*,\s*(${NUMBER})\s*\)$`,
);
/** A rest call a unit that blends guards, for a piece two actions share. */
const OWNER_LINE = new RegExp(
  String.raw`^if\s+ACT_OWNER\[\s*${NAME}\s*\]\s*==\s*${NAME}\s+then\s+(.+?)\s+end$`,
);
const SLEEP_LINE = /^Sleep\(\s*(\d+)\s*\)$/;
const MASK_LINE = new RegExp(String.raw`^SetSignalMask\(\s*(${NAME})\s*\)$`);
const SIGNAL_LINE = new RegExp(String.raw`^Signal\(\s*(${NAME})\s*\)$`);
const START_LINE = new RegExp(String.raw`^StartThread\(\s*(${NAME})\s*\)$`);
const CALL_LINE = new RegExp(String.raw`^(${NAME})\(\s*\)$`);
const PIECE_DECL = new RegExp(
  String.raw`^local\s+(${NAME}(?:\s*,\s*${NAME})*)\s*=\s*piece\s*(?:\((.*)\)|("[^"]*"|'[^']*'))$`,
);
const SIGNAL_DECL = new RegExp(
  String.raw`^local\s+(${NAME})\s*=\s*(?:"[^"]*"|'[^']*'|\d+)$`,
);
const LOCAL_FUNCTION = new RegExp(
  String.raw`^local\s+function\s+(${NAME})\(\s*\)$`,
);
const SCRIPT_FUNCTION = new RegExp(
  String.raw`^function\s+script\.(${NAME})\(\s*(?:${NAME}(?:\s*,\s*${NAME})*)?\s*\)$`,
);

/** The line with its `--` comment gone, or null for a line this reader will
 *  not take apart: a block comment, or a comment marker inside a string. */
function codeOf(line: string): string | null {
  const at = line.indexOf("--");
  if (at < 0) return line.trim();
  if (line.slice(at).startsWith("--[[")) return null;
  const before = line.slice(0, at);
  if (/["'[]/.test(before) && /["'\]]/.test(line.slice(at))) return null;
  return before.trim();
}

/** A function's name and its body, one trimmed line each. */
interface Block {
  name: string;
  body: string[];
}

/** One `Turn` or `Move` call, or a `BlendTurn` or `BlendMove`. */
interface MoveCall {
  kind: "turn" | "move";
  piece: string;
  axis: number;
  value: number;
  speed: number | null;
  /** The seconds a blend takes, which is also what makes the call one. */
  blend: number | null;
}

/**
 * The call a line makes, or null for any other line. A unit that blends writes
 * every call through the helpers, and one that does not has none of them, so a
 * line of the wrong kind is no call: that script is not what the builder wrote.
 */
function readCall(line: string, blending: boolean): MoveCall | null {
  const move = MOVE_LINE.exec(line);
  if (move) {
    if ((move[1] !== undefined) !== blending) return null;
    return {
      kind: move[2] === "Turn" ? "turn" : "move",
      piece: move[3],
      axis: AXES.indexOf(move[4]),
      value: Number(move[5]),
      speed: move[6] === undefined ? null : Number(move[6]),
      blend: null,
    };
  }
  const blend = blending ? BLEND_LINE.exec(line) : null;
  if (!blend) return null;
  return {
    kind: blend[1] === "Turn" ? "turn" : "move",
    piece: blend[2],
    axis: AXES.indexOf(blend[3]),
    value: Number(blend[4]),
    speed: null,
    blend: Number(blend[5]),
  };
}

/** The calls up to and including one `Sleep`, or the calls after the last. */
interface Segment {
  moves: MoveCall[];
  sleepMs: number | null;
}

interface Thread {
  name: string;
  lead: Segment[];
  loop: Segment[];
}

/** A thread's body as segments, or null when it holds anything else. */
function readThread(block: Block, blending: boolean): Thread | null {
  const lead: Segment[] = [];
  const loop: Segment[] = [];
  let into = lead;
  let current: MoveCall[] = [];
  let inLoop = false;
  let loopClosed = false;
  let lines = block.body;
  if (lines.length > 0 && MASK_LINE.test(lines[0])) lines = lines.slice(1);
  for (const line of lines) {
    if (loopClosed) return null;
    const move = readCall(line, blending);
    if (move) {
      current.push(move);
      continue;
    }
    const sleep = SLEEP_LINE.exec(line);
    if (sleep) {
      into.push({ moves: current, sleepMs: Number(sleep[1]) });
      current = [];
      continue;
    }
    if (line === "while true do" && !inLoop) {
      if (current.length > 0) return null;
      inLoop = true;
      into = loop;
      continue;
    }
    if (line === "end" && inLoop) {
      // Every lap has to wait, or the engine never gets to run.
      if (current.length > 0 || loop.length === 0) return null;
      loopClosed = true;
      continue;
    }
    return null;
  }
  if (inLoop && !loopClosed) return null;
  if (current.length > 0) lead.push({ moves: current, sleepMs: null });
  if (lead.length === 0 && loop.length === 0) return null;
  return { name: block.name, lead, loop };
}

/** The calls a stop function makes, or null when it is not a stop function: a
 *  `Signal` and pieces sent back to rest, nothing else. A unit that blends may
 *  guard a rest call with the piece's owner. */
function restCalls(block: Block, blending: boolean): MoveCall[] | null {
  if (block.body.length === 0 || !SIGNAL_LINE.test(block.body[0])) return null;
  const calls: MoveCall[] = [];
  for (const line of block.body.slice(1)) {
    const guarded = blending ? OWNER_LINE.exec(line) : null;
    const call = readCall(guarded ? guarded[1] : line, blending);
    if (!call || call.value !== 0) return null;
    calls.push(call);
  }
  return calls;
}

/** The seconds a stop function blends out over, or 0 when it does not. */
function blendOutOf(calls: MoveCall[]): number {
  return calls.find((call) => call.blend !== null)?.blend ?? 0;
}

/** The lines of the helpers a unit that blends carries, as this reader sees
 *  them: no comments and no blank lines. */
const HELPER_LINES = BLEND_HELPERS.map((line) => codeOf(line) ?? "").filter(
  (line) => line !== "",
);

/** Where the builder's blend helpers start in `lines`, or -1. All of them have
 *  to be there, as written: a script with some of them, or a changed one, has
 *  lines this reader does not take. */
function helpersAt(lines: string[]): number {
  const [first] = HELPER_LINES;
  for (
    let at = lines.indexOf(first);
    at >= 0;
    at = lines.indexOf(first, at + 1)
  ) {
    if (HELPER_LINES.every((line, i) => lines[at + i] === line)) return at;
  }
  return -1;
}

/** A file's top level, split into the parts this reader takes. Null for any
 *  line it does not. `blending` is whether it carries the helpers a unit that
 *  blends has, which are taken out and are not read as functions. */
function readTopLevel(lua: string): {
  pieces: Map<string, string>;
  locals: Block[];
  callins: Block[];
  blending: boolean;
} | null {
  const pieces = new Map<string, string>();
  const locals: Block[] = [];
  const callins: Block[] = [];
  const lines: string[] = [];
  for (const raw of lua.split("\n")) {
    const code = codeOf(raw);
    if (code === null) return null;
    if (code !== "") lines.push(code);
  }
  const helpers = helpersAt(lines);
  const blending = helpers >= 0;
  if (blending) lines.splice(helpers, HELPER_LINES.length);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const decl = PIECE_DECL.exec(line);
    if (decl) {
      const vars = decl[1].split(",").map((v) => v.trim());
      const names = pieceNameLiterals(line).map((l) => l.name);
      if (names.length !== vars.length) return null;
      vars.forEach((v, at) => {
        pieces.set(v, names[at]);
      });
      continue;
    }
    if (SIGNAL_DECL.test(line)) continue;
    const local = LOCAL_FUNCTION.exec(line);
    const callin = local ? null : SCRIPT_FUNCTION.exec(line);
    if (!local && !callin) return null;
    // The body runs to the `end` that closes this function.
    const body: string[] = [];
    let depth = 1;
    for (i++; i < lines.length; i++) {
      const inner = lines[i];
      if (inner === "end") {
        depth--;
        if (depth === 0) break;
      } else if (/\b(do|then)$/.test(inner) || /^function\b/.test(inner)) {
        depth++;
      }
      body.push(inner);
    }
    if (depth !== 0) return null;
    const name = (local ?? callin)?.[1] ?? "";
    (local ? locals : callins).push({ name, body });
  }
  return { pieces, locals, callins, blending };
}

function round4(n: number): number {
  return Number(n.toFixed(4));
}

/** Frames a `Sleep` waits: the engine wakes the thread `floor(ms / 33)`
 *  frames later. */
function sleepFrames(ms: number): number {
  return Math.floor(ms / SLEEP_FRAME_MS);
}

type State = Map<string, { turn: number[]; move: number[] }>;

function stateCopy(state: State): State {
  return new Map(
    [...state].map(([k, v]) => [k, { turn: [...v.turn], move: [...v.move] }]),
  );
}

/**
 * Play the segments from `state`, checking each is what `actions.ts` would
 * write for a key reached in its time: a speed per axis of the distance over
 * the seconds, every move in a timed segment given one, one call per axis.
 * Returns each segment's seconds, or null at the first that is not.
 */
function playSegments(segments: Segment[], state: State): number[] | null {
  const seconds: number[] = [];
  for (const segment of segments) {
    const seen = new Set<string>();
    const deltas: { distance: number; speed: number | null }[] = [];
    for (const move of segment.moves) {
      const key = `${move.piece}:${move.kind}:${move.axis}`;
      if (seen.has(key)) return null;
      seen.add(key);
      const values = state.get(move.piece) ?? {
        turn: [0, 0, 0],
        move: [0, 0, 0],
      };
      const was = values[move.kind][move.axis];
      values[move.kind][move.axis] = round4(move.value);
      state.set(move.piece, values);
      deltas.push({
        distance: Math.abs(round4(move.value) - was),
        speed: move.speed,
      });
    }
    let frames: number;
    if (segment.sleepMs !== null) {
      frames = sleepFrames(segment.sleepMs);
      if (frames === 0) return null;
    } else {
      // The last key of an action that does not loop has no sleep after it,
      // so its time is in the speeds, which have to agree on it.
      const moving = deltas.filter((d) => d.distance > 0);
      if (moving.every((d) => d.speed === null)) frames = 0;
      else {
        if (moving.some((d) => d.speed === null || d.speed <= 0)) return null;
        const each = moving.map((d) =>
          Math.max(1, Math.round((d.distance / (d.speed as number)) * FPS)),
        );
        if (each.some((f) => f !== each[0])) return null;
        frames = each[0];
      }
    }
    for (const d of deltas) {
      if (d.distance === 0) continue;
      if (frames === 0) {
        if (d.speed !== null) return null;
        continue;
      }
      if (d.speed === null) return null;
      if (round4(d.speed) !== round4(d.distance / (frames / FPS))) return null;
    }
    seconds.push(frames / FPS);
  }
  return seconds;
}

/** Each segment's pose: where every piece is once it has played. */
function posesOf(
  segments: Segment[],
  state: State,
): Map<string, { turn: number[]; move: number[] }>[] {
  const out: State[] = [];
  for (const segment of segments) {
    for (const move of segment.moves) {
      const values = state.get(move.piece) ?? {
        turn: [0, 0, 0],
        move: [0, 0, 0],
      };
      values[move.kind][move.axis] = round4(move.value);
      state.set(move.piece, values);
    }
    out.push(stateCopy(state));
  }
  return out;
}

function sameState(a: State, b: State): boolean {
  const keys = new Set([...a.keys(), ...b.keys()]);
  for (const key of keys) {
    const x = a.get(key) ?? { turn: [0, 0, 0], move: [0, 0, 0] };
    const y = b.get(key) ?? { turn: [0, 0, 0], move: [0, 0, 0] };
    for (let axis = 0; axis < 3; axis++) {
      if (x.turn[axis] !== y.turn[axis] || x.move[axis] !== y.move[axis]) {
        return false;
      }
    }
  }
  return true;
}

/** A thread as keys: one pose and its seconds each, and whether it loops. */
function keysOf(
  thread: Thread,
): { poses: State[]; seconds: number[]; loop: boolean } | null {
  const { lead, loop } = thread;
  if (loop.length === 0) {
    // A trailing sleep after the last key changes nothing anyone can see.
    const seconds = playSegments(lead, new Map());
    if (!seconds) return null;
    return { poses: posesOf(lead, new Map()), seconds, loop: false };
  }
  // Every lap after the first starts where the last one ended, which is what
  // the speeds in the loop are for. Without a lead in, the first lap starts
  // from rest instead, so its speeds are checked from the second lap on, and
  // the action's own lead in from rest takes the first key's time.
  const start = new Map() as State;
  if (!playSegments(lead, start)) return null;
  const leadPoses = posesOf(lead, new Map());
  const settled = stateCopy(start);
  if (lead.length === 0) posesOf(loop, settled);
  else if (!playSegments(loop, settled)) return null;
  const lap = stateCopy(settled);
  const seconds = playSegments(loop, lap);
  if (!seconds) return null;
  const loopPoses = posesOf(loop, stateCopy(settled));
  if (lead.length > 0) {
    // What `actions.ts` writes: the keys once from rest, then the same keys
    // round again.
    if (lead.length !== loop.length) return null;
    const leadSeconds = playSegments(lead, new Map());
    if (!leadSeconds?.every((s, at) => s === seconds[at])) return null;
    if (!leadPoses.every((pose, at) => sameState(pose, loopPoses[at]))) {
      return null;
    }
  }
  return { poses: loopPoses, seconds, loop: true };
}

// --- Reading pieces that arrive on different frames. ------------------------

/** One call as the script makes it, in the terms of a plan's. */
interface Made {
  frame: number;
  piece: string;
  kind: "turn" | "move";
  axis: number;
  dest: number;
  speed: number | null;
  /** The seconds of a blend in, on the call that makes it. */
  blend: number | null;
}

/** A channel's keys so far: one piece, `turn` or `move`, and an axis. */
interface Channel {
  piece: string;
  kind: "turn" | "move";
  axis: 0 | 1 | 2;
  keys: { frame: number; value: number }[];
}

/**
 * The whole frames a piece takes to go `distance` at `speed` a second, or null
 * when no whole number of frames makes the builder write that speed. The
 * builder writes the distance over the seconds to four places, so a speed that
 * does not come out of a whole number of frames does not fit. The nearest
 * frames are tried first, because the four places can nudge the sum across a
 * frame.
 */
function framesTaken(distance: number, speed: number): number | null {
  const exact = (distance / speed) * FPS;
  const near = Math.round(exact);
  return (
    [near - 1, near, near + 1]
      .filter((n) => n >= 1)
      .sort((a, b) => Math.abs(a - exact) - Math.abs(b - exact))
      .find((n) => round4(distance / (n / FPS)) === round4(speed)) ?? null
  );
}

/**
 * A thread's calls as keys on channels of their own, or null when it is not the
 * motion `planAction` writes for some set of tracks. A call on frame s that goes
 * to d at speed v makes a key on s holding the channel's value there, and a key
 * on the frame it arrives, `s + |d - value| / v * 30` rounded to a whole frame.
 *
 * - A channel's first call from rest on frame 0 is its first key's arrival, as
 *   the plan has it. A first call later has a key at rest on its frame.
 * - A call with no speed is a key on frame 0, because a track cannot hold two
 *   values on one frame anywhere else.
 * - A call has to come after the channel's last one has arrived, and has to
 *   change the channel's value.
 * - A looping thread's lead has to be as long as its lap. The last call of each
 *   channel in the lead goes back to its first key, arriving after the lap's
 *   length, and that arrival is not a key of its own. A lap longer than any
 *   channel's last key gets a key at its end that holds the value of the first
 *   channel that ends where it began.
 *
 * A thread that blends in starts with a `BlendTurn` or `BlendMove` for every
 * channel that moves, on frame 0, and goes on from the frame the blend ends on.
 * The script does not say which frame the first key was on, only the frames it
 * is played on, so the first key frame is chosen:
 *
 * - A looping action's lead in is as long as its lap and the frames the blend
 *   replaces, because the lap starts where the action's last key is. The
 *   frames the blend replaces put the first key on `blend frames - (lead in -
 *   lap)`.
 * - Any other action has the first key on the frame the blend ends on. Two
 *   actions with different first key frames and the same blend time write the
 *   same script, so this is as good as any, and it does not change the script.
 *
 * Every channel that blends has a key on that frame, holding the value the
 * blend goes to. A channel that was part way from rest when the blend ended,
 * which only a loop can show, is the key it goes on to instead, where the lap
 * goes back to that and not to the blend's value.
 *
 * The keys are then written again with `planAction` and the calls compared
 * with the script's, which is what makes all of the above all or nothing.
 */
function tracksOf(
  thread: Thread,
  pieceIds: Map<string, string>,
  project: LegoProject,
  trigger: string,
): LegoAction | null {
  const channels = new Map<string, Channel>();
  const lead: Made[] = [];
  const lap: Made[] = [];

  const place = (move: MoveCall, at: number): Made | null => {
    const piece = pieceIds.get(move.piece);
    if (!piece) return null;
    return {
      frame: at,
      piece,
      kind: move.kind,
      axis: move.axis,
      dest: round4(move.value),
      speed: move.speed === null ? null : round4(move.speed),
      blend: move.blend === null ? null : round4(move.blend),
    };
  };

  // The blend in is the calls that blend, all in the first run of calls.
  const blendCalls = [...thread.lead, ...thread.loop]
    .flatMap((segment) => segment.moves)
    .filter((move) => move.blend !== null);
  const firstRun = thread.lead[0]?.moves.filter((move) => move.blend !== null);
  if (blendCalls.length !== (firstRun?.length ?? 0)) return null;
  const blendTimes = new Set(blendCalls.map((move) => round4(move.blend ?? 0)));
  if (blendTimes.size > 1 || blendTimes.has(0)) return null;
  const blendIn = [...blendTimes][0] ?? 0;
  const blendFrames = framesOf(blendIn);

  const span = (segments: Segment[]) =>
    segments.reduce<number | null>((sum, segment) => {
      if (sum === null || segment.sleepMs === null) return sum;
      const frames = sleepFrames(segment.sleepMs);
      return frames === 0 ? null : sum + frames;
    }, 0);
  const leadSpan = span(thread.lead);
  const lapSpan = span(thread.loop);
  if (leadSpan === null || lapSpan === null) return null;
  const looping = thread.loop.length > 0;
  // How far the blend moves the action's frames on, as `planAction` has it.
  const shift = blendIn > 0 && looping ? leadSpan - lapSpan : 0;
  const firstFrame = blendFrames - shift;
  if (blendIn > 0 && firstFrame < 0) return null;

  const play = (segments: Segment[], into: Made[], keyed: boolean) => {
    let at = 0;
    for (const segment of segments) {
      for (const move of segment.moves) {
        const made = place(move, at);
        if (!made) return null;
        into.push(made);
        if (!keyed) continue;
        if (made.blend !== null) {
          if (!keyBlend(channels, made, firstFrame)) return null;
        } else if (blendIn > 0 && at < blendFrames) {
          return null;
        } else if (!keyCall(channels, made, shift)) {
          return null;
        }
      }
      if (segment.sleepMs !== null) {
        const frames = sleepFrames(segment.sleepMs);
        if (frames === 0) return null;
        at += frames;
      }
    }
    return at;
  };

  const leadFrames = play(thread.lead, lead, true);
  if (leadFrames === null) return null;
  const lapFrames = looping ? play(thread.loop, lap, false) : 0;
  if (lapFrames === null) return null;
  if (looping && leadFrames !== lapFrames + shift) return null;
  if (channels.size === 0) return null;

  const order = (channel: Channel) =>
    project.pieces.findIndex((p) => p.id === channel.piece);
  const sorted = [...channels.values()].sort(
    (a, b) =>
      order(a) - order(b) ||
      (a.kind === b.kind ? 0 : a.kind === "turn" ? -1 : 1) ||
      a.axis - b.axis,
  );
  const lastOf = (channel: Channel) => channel.keys[channel.keys.length - 1];

  if (looping) {
    for (const channel of sorted) {
      const last = lastOf(channel);
      const wrapped = last.frame > lapFrames;
      const [head, next] = wrapped ? channel.keys.slice(0, -1) : channel.keys;
      if (blendIn > 0 && next) {
        // A channel that was part way from rest when the blend ended starts
        // with the key the blend goes to, which is not one of its own: the lap
        // goes back to the key after it. The wrap is in the lead unless the
        // channel ends on the lap's last frame, and the lap always has it.
        const wrap = lap.find(
          (call) =>
            channelId(call) === channelId(channel) &&
            call.frame === last.frame % lapFrames,
        );
        const goesTo = wrapped ? last.value : (wrap?.dest ?? last.value);
        if (goesTo !== head.value && goesTo === next.value) {
          channel.keys.shift();
        }
      }
      if (!wrapped) continue;
      const [first] = channel.keys;
      if (last.frame !== lapFrames + first.frame) return null;
      if (last.value !== first.value) return null;
      channel.keys.pop();
    }
    if (
      Math.max(...sorted.map((channel) => lastOf(channel).frame)) < lapFrames
    ) {
      // The lap waits after every channel's last key. A key at its end that
      // holds a value goes on a channel that has no wrap to move, because
      // putting one on a channel that wraps would start that wrap later.
      const holder = sorted.find(
        (channel) => lastOf(channel).value === channel.keys[0].value,
      );
      if (!holder) return null;
      holder.keys.push({ frame: lapFrames, value: lastOf(holder).value });
    }
  }

  const tracks: LegoActionTrack[] = sorted.map(
    ({ piece, kind, axis, keys }) => ({ piece, kind, axis, keys }),
  );
  const action: LegoAction = {
    id: "",
    name: "",
    trigger,
    loop: looping,
    keys: [],
    tracks,
    ...(blendIn > 0 ? { blendIn } : {}),
  };

  const plan = planAction(action, { ...project, actionBlend: 0 });
  if (!plan || plan.looping !== looping) return null;
  if (
    looping &&
    (plan.leadFrames !== leadFrames || plan.lapFrames !== lapFrames)
  ) {
    return null;
  }
  if (!sameCalls(lead, plan.lead)) return null;
  if (looping && !sameCalls(lap, plan.lap)) return null;
  return action;
}

/** A channel's id in the map of channels. */
function channelId(of: { piece: string; kind: string; axis: number }): string {
  return `${of.piece}:${of.kind}:${of.axis}`;
}

/** Add the key a blend in makes: the value it goes to, on the frame it ends on.
 *  False when the channel already has keys. */
function keyBlend(
  channels: Map<string, Channel>,
  call: Made,
  frame: number,
): boolean {
  const id = channelId(call);
  if (channels.has(id)) return false;
  channels.set(id, {
    piece: call.piece,
    kind: call.kind,
    axis: call.axis as 0 | 1 | 2,
    keys: [{ frame, value: call.dest }],
  });
  return true;
}

/** Add the keys a call makes, on the action's frames, which are the frames the
 *  call is on less `shift`. False when the call does not fit. */
function keyCall(
  channels: Map<string, Channel>,
  call: Made,
  shift: number,
): boolean {
  const id = channelId(call);
  const channel = channels.get(id) ?? {
    piece: call.piece,
    kind: call.kind,
    axis: call.axis as 0 | 1 | 2,
    keys: [],
  };
  const at = call.frame - shift;
  const last = channel.keys[channel.keys.length - 1];
  const was = last?.value ?? 0;
  if (call.dest === was) return false;
  if (last && last.frame > at) return false;
  const { speed } = call;
  if (speed === null) {
    if (last || at !== 0) return false;
    channel.keys.push({ frame: 0, value: call.dest });
  } else {
    if (speed <= 0) return false;
    const frames = framesTaken(Math.abs(call.dest - was), speed);
    if (frames === null) return false;
    if (!last && at > 0) channel.keys.push({ frame: at, value: 0 });
    else if (last && last.frame < at) {
      channel.keys.push({ frame: at, value: was });
    }
    channel.keys.push({ frame: at + frames, value: call.dest });
  }
  channels.set(id, channel);
  return true;
}

/** Whether the script's calls are the plan's, whatever order they are in on
 *  one frame. */
function sameCalls(made: Made[], planned: PlanCall[]): boolean {
  const text = (c: {
    frame: number;
    piece: string;
    kind: string;
    axis: number;
    dest: number;
    speed?: number | null;
    blend?: number | null;
  }) =>
    `${c.frame}|${c.piece}|${c.kind}|${c.axis}|${round4(c.dest)}|${
      c.speed == null ? "-" : round4(c.speed)
    }|${c.blend == null ? "-" : round4(c.blend)}`;
  const a = made.map(text).sort();
  const b = planned.map(text).sort();
  return a.length === b.length && a.every((line, at) => line === b[at]);
}

/** The script lines `actions.ts` writes to start and stop its own threads,
 *  which are not compared with the import's. */
function isActionLine(line: string): boolean {
  return (
    /^Signal\(SIG_ACTION_\w+\)$/.test(line) ||
    /^StartThread\(action_\w+\)$/.test(line) ||
    /^action_\w+Stop\(\)$/.test(line)
  );
}

/** The poses and actions a script is, or null when it is anything more. */
export function readActions(
  lua: string,
  project: LegoProject,
  newId: () => string,
): { poses: LegoPose[]; actions: LegoAction[] } | null {
  const top = readTopLevel(lua);
  if (!top) return null;

  const pieceIds = new Map<string, string>();
  for (const [variable, name] of top.pieces) {
    const piece = pieceFor(project.pieces, name);
    if (!piece) return null;
    pieceIds.set(variable, piece.id);
  }

  const { blending } = top;
  const threads: Thread[] = [];
  const stops = new Map<string, MoveCall[]>();
  for (const block of top.locals) {
    const rest = restCalls(block, blending);
    if (rest) {
      stops.set(block.name, rest);
      continue;
    }
    const thread = readThread(block, blending);
    if (!thread) return null;
    threads.push(thread);
  }
  if (threads.length === 0) return null;
  const threadNames = new Set(threads.map((t) => t.name));

  // What each call-in does: starts threads, stops them, and the rest.
  const starts = new Map<string, string[]>();
  const stopped = new Map<string, string[]>();
  for (const callin of top.callins) {
    for (const line of callin.body) {
      const start = START_LINE.exec(line);
      if (start) {
        if (!threadNames.has(start[1])) return null;
        starts.set(start[1], [...(starts.get(start[1]) ?? []), callin.name]);
        continue;
      }
      const call = CALL_LINE.exec(line);
      if (call && stops.has(call[1])) {
        stopped.set(callin.name, [
          ...(stopped.get(callin.name) ?? []),
          call[1],
        ]);
      }
    }
  }

  const poses: LegoPose[] = [];
  const actions: LegoAction[] = [];
  const named = { ...project, poses: [...(project.poses ?? [])] };
  for (const thread of threads) {
    const triggers = starts.get(thread.name) ?? [];
    if (triggers.length !== 1) return null;
    const trigger = triggers[0];
    if (triggerProblem(project, trigger)) return null;
    // A unit that blends has no actions of poses to read: the blend takes the
    // place of the first key's time, so each is read as tracks.
    const keys = blending ? null : keysOf(thread);
    const wide = keys ? null : tracksOf(thread, pieceIds, project, trigger);
    if (!keys && !wide) return null;
    const looping = keys?.loop ?? wide?.loop ?? false;
    const stopCallin = STOP_CALLIN[trigger] ?? `${trigger}Stop`;
    const hasStop = stopped.has(stopCallin);
    const custom = !actionHooks(project).includes(trigger);
    if (looping && (STOP_CALLIN[trigger] || custom) && !hasStop) return null;
    if (!looping && hasStop) return null;

    // The times the script blends over. A time that is the unit's default is
    // left to follow it, and any other is the action's own, including none on a
    // unit that has a default. A blend out is only in the stop function of a
    // looping action, so any other action takes the default, which is nothing
    // the script shows.
    const fallback = project.actionBlend ?? 0;
    const blendIn = wide?.blendIn ?? 0;
    let blendOut: number | null = blending ? null : 0;
    const rest = looping ? stops.get(`${thread.name}Stop`) : undefined;
    if (blending && rest) blendOut = blendOutOf(rest);

    const name = thread.name.replace(/^action_/, "") || thread.name;
    const action: LegoAction = {
      id: newId(),
      name,
      trigger,
      loop: looping,
      keys: [],
      ...(wide ? { tracks: wide.tracks } : {}),
      ...(blendIn !== fallback ? { blendIn } : {}),
      ...(blendOut !== null && blendOut !== fallback ? { blendOut } : {}),
    };
    keys?.poses.forEach((state, at) => {
      const pieces: LegoPose["pieces"] = {};
      for (const [variable, values] of state) {
        const id = pieceIds.get(variable);
        if (!id) continue;
        const turned = values.turn.some((v) => v !== 0);
        const moved = values.move.some((v) => v !== 0);
        if (!turned && !moved) continue;
        pieces[id] = {
          ...(turned ? { turn: values.turn as [number, number, number] } : {}),
          ...(moved ? { move: values.move as [number, number, number] } : {}),
        };
      }
      const pose: LegoPose = {
        id: newId(),
        name: freePoseName(named, `${name} ${at + 1}`),
        pieces,
      };
      named.poses.push(pose);
      poses.push(pose);
      action.keys.push({ pose: pose.id, seconds: keys?.seconds[at] ?? 0 });
    });
    actions.push(action);
  }
  // Every piece a thread moves has to be one the script declared.
  for (const thread of threads) {
    for (const segment of [...thread.lead, ...thread.loop]) {
      if (segment.moves.some((m) => !pieceIds.has(m.piece))) return null;
    }
  }

  // Whatever else the call-ins do has to be what the builder writes anyway,
  // or nothing, so a call-in left empty takes the builder's default.
  const built = { ...project, poses: named.poses, actions };
  const rebuilt = readTopLevel(buildLuaScript(built));
  if (!rebuilt) return null;
  if (blending) {
    // The helpers are only there when an action blends, and the stop functions
    // have to be written as they are, because only their blend time is read.
    if (!unitBlends(built)) return null;
    const stopsOf = (blocks: Block[]) =>
      blocks
        .filter((block) => restCalls(block, true))
        .map((block) => `${block.name}\n${block.body.join("\n")}`)
        .sort();
    const mine = stopsOf(top.locals);
    const theirs = stopsOf(rebuilt.locals);
    if (mine.join("\n\n") !== theirs.join("\n\n")) return null;
  } else if (unitBlends(built)) {
    return null;
  }
  const written = new Map(rebuilt.callins.map((c) => [c.name, c.body]));
  for (const callin of top.callins) {
    const own = callin.body.filter(
      (line) =>
        !START_LINE.test(line) &&
        !SIGNAL_LINE.test(line) &&
        !(CALL_LINE.test(line) && stops.has(CALL_LINE.exec(line)?.[1] ?? "")),
    );
    if (own.length === 0) continue;
    const theirs = (written.get(callin.name) ?? []).filter(
      (line) => !isActionLine(line),
    );
    if (own.join("\n") !== theirs.join("\n")) return null;
  }
  return { poses, actions };
}

// --- The import itself. ------------------------------------------------------

export interface ScriptImport {
  project: LegoProject;
  /** Read back as actions, or kept as the unit's own script. */
  as: "actions" | "script";
  /** How many actions it was read back as. */
  actions: number;
  renamed: PieceMatch["renamed"];
  unmatched: string[];
}

/**
 * The project with `lua` imported into it.
 *
 * Read back as actions only on a unit with no presets applied and no compiled
 * script, because either would still play beside the actions and the unit
 * would no longer do what the script did. Those actions replace the unit's
 * own. Otherwise the script becomes the unit's own, with the definition and
 * library files that came with it, for a script out of a game.
 */
export function importScript(
  project: LegoProject,
  lua: string,
  options: {
    newId: () => string;
    includes?: Record<string, string>;
    unitDef?: Record<string, unknown> | null;
  },
): ScriptImport {
  const match = matchScriptPieces(lua, project.pieces);
  const plain =
    match.unmatched.length === 0 &&
    (project.animations ?? []).length === 0 &&
    project.compiledScript === undefined;
  const read = plain ? readActions(match.lua, project, options.newId) : null;
  if (read) {
    const { script: _dropped, ...rest } = project;
    return {
      project: {
        ...rest,
        poses: [...(project.poses ?? []), ...read.poses],
        actions: read.actions,
      },
      as: "actions",
      actions: read.actions.length,
      renamed: match.renamed,
      unmatched: [],
    };
  }
  const includes =
    options.includes && Object.keys(options.includes).length > 0
      ? { gameScriptIncludes: options.includes }
      : {};
  return {
    project: {
      ...project,
      script: match.lua,
      ...includes,
      ...(options.unitDef ? { gameUnitDef: options.unitDef } : {}),
    },
    as: "script",
    actions: 0,
    renamed: match.renamed,
    unmatched: match.unmatched,
  };
}

/** What an import did, in one short line for a notice. */
export function importSummary(result: ScriptImport): string {
  const actions = result.actions;
  const parts = [
    result.as === "actions"
      ? plural(actions, {
          one: "Read as # action.",
          other: "Read as # actions.",
        })
      : t`Kept as this unit's own script.`,
  ];
  if (result.renamed.length > 0) {
    const renamed = result.renamed.map((r) => `${r.from} → ${r.to}`).join(", ");
    parts.push(t`Renamed ${renamed}.`);
  }
  if (result.unmatched.length > 0) {
    const unmatched = result.unmatched.join(", ");
    parts.push(t`Not on this unit: ${unmatched}.`);
  }
  return parts.join(" ");
}
