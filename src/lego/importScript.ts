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
 * A simple script is read back as actions of poses (`actions.ts`), so the
 * builder can edit it. Anything else becomes the unit's own script, exactly as
 * imported apart from the case renames. Reading back is all or nothing: if any
 * part of the script is outside what {@link readActions} recognises, none of
 * it is taken apart.
 */

import { plural, t } from "@lingui/core/macro";
import { actionHooks, STOP_CALLIN, triggerProblem } from "./actions";
import { pieceNameLiterals, renameScriptPieces } from "./luaPieces";
import { buildLuaScript } from "./luaScript";
import type { LegoAction, LegoPiece, LegoPose, LegoProject } from "./model";
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
const MOVE_LINE = new RegExp(
  String.raw`^(Turn|Move)\(\s*(${NAME})\s*,\s*([xyz]_axis)\s*,\s*(${NUMBER})\s*(?:,\s*(${NUMBER})\s*)?\)$`,
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

/** One `Turn` or `Move` call. */
interface MoveCall {
  kind: "turn" | "move";
  piece: string;
  axis: number;
  value: number;
  speed: number | null;
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
function readThread(block: Block): Thread | null {
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
    const move = MOVE_LINE.exec(line);
    if (move) {
      current.push({
        kind: move[1] === "Turn" ? "turn" : "move",
        piece: move[2],
        axis: AXES.indexOf(move[3]),
        value: Number(move[4]),
        speed: move[5] === undefined ? null : Number(move[5]),
      });
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

/** A stop function: a `Signal` and pieces sent back to rest, nothing else. */
function isStopFunction(block: Block): boolean {
  if (block.body.length === 0 || !SIGNAL_LINE.test(block.body[0])) return false;
  return block.body.slice(1).every((line) => {
    const move = MOVE_LINE.exec(line);
    return move !== null && Number(move[4]) === 0;
  });
}

/** A file's top level, split into the parts this reader takes. Null for any
 *  line it does not. */
function readTopLevel(lua: string): {
  pieces: Map<string, string>;
  locals: Block[];
  callins: Block[];
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
  return { pieces, locals, callins };
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

  const threads: Thread[] = [];
  const stops = new Set<string>();
  for (const block of top.locals) {
    if (isStopFunction(block)) {
      stops.add(block.name);
      continue;
    }
    const thread = readThread(block);
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
    const keys = keysOf(thread);
    if (!keys) return null;
    const stopCallin = STOP_CALLIN[trigger] ?? `${trigger}Stop`;
    const hasStop = stopped.has(stopCallin);
    const custom = !actionHooks(project).includes(trigger);
    if (keys.loop && (STOP_CALLIN[trigger] || custom) && !hasStop) return null;
    if (!keys.loop && hasStop) return null;

    const name = thread.name.replace(/^action_/, "") || thread.name;
    const action: LegoAction = {
      id: newId(),
      name,
      trigger,
      loop: keys.loop,
      keys: [],
    };
    keys.poses.forEach((state, at) => {
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
      action.keys.push({ pose: pose.id, seconds: keys.seconds[at] });
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
  const rebuilt = readTopLevel(
    buildLuaScript({ ...project, poses: named.poses, actions }),
  );
  if (!rebuilt) return null;
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
