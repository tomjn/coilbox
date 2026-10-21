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
import type { LegoAction, LegoPiece, LegoPose, LegoProject } from "./model";
import { type Problem, problem } from "./problems";
import { luaString } from "./unitDef";
import { scriptWeapons } from "./weaponModule";

/** Sim frames per second, the engine's `GAME_SPEED`. */
const FPS = 30;

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

/** The pieces the action moves, in document order: those some live key's pose
 *  names that the unit still has. */
export function actionPieces(
  action: LegoAction,
  project: LegoProject,
): LegoPiece[] {
  const named = new Set(
    liveSteps(action, project).flatMap((step) => Object.keys(step.pose.pieces)),
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

/**
 * The calls that take every target from `from` to `to` in `seconds`, then the
 * sleep that waits for them. Per axis, so one axis that has to travel further
 * goes faster than another that has a short way to go and both arrive together.
 * An axis that does not change writes nothing.
 */
function stepLines(
  targets: Target[],
  from: Map<string, Values>,
  to: Map<string, Values>,
  seconds: number,
  indent: string,
  moved: Moved,
  sleep: boolean,
  tracked: boolean,
): { lines: string[]; frames: number } {
  const frames = framesOf(seconds);
  const lines: string[] = [];
  for (const { piece, name } of targets) {
    const before = from.get(piece.id) ?? REST;
    const after = to.get(piece.id) ?? REST;
    for (const kind of ["turn", "move"] as const) {
      const call = callName(kind, tracked);
      for (let axis = 0; axis < 3; axis++) {
        const was = before[kind][axis];
        const now = after[kind][axis];
        if (was === now) continue;
        const set = moved[kind].get(piece.id) ?? new Set<number>();
        set.add(axis);
        moved[kind].set(piece.id, set);
        if (frames === 0) {
          lines.push(`${indent}${call}(${name}, ${AXES[axis]}, ${lua(now)})`);
          continue;
        }
        const speed = Math.abs(now - was) / (frames / FPS);
        lines.push(
          `${indent}${call}(${name}, ${AXES[axis]}, ${lua(now)}, ${lua(speed)})`,
        );
      }
    }
  }
  if (sleep && frames > 0) {
    lines.push(`${indent}Sleep(${frames * SLEEP_FRAME_MS})`);
  }
  return { lines, frames };
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
 * The Lua for every action of the unit. `use` names a piece in the script, and
 * marks it so the script declares it. An action with no live key, or one that
 * moves no piece the unit has, writes nothing.
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

  const plans: Plan[] = [];
  for (const action of project.actions ?? []) {
    if (triggerProblem(project, action.trigger)) continue;
    const steps = liveSteps(action, project);
    const pieces = actionPieces(action, project);
    if (steps.length === 0 || pieces.length === 0) continue;

    let base = slug(action.name) || "action";
    for (let n = 2; taken.has(base.toLowerCase()); n++) {
      base = `${slug(action.name) || "action"}_${n}`;
    }
    taken.add(base.toLowerCase());
    plans.push({
      action,
      steps,
      pieces,
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

  for (const plan of plans) {
    const { action, steps, pieces, thread, signal, blendIn, blendOut } = plan;
    const targets = pieces.map((piece) => ({ piece, name: use(piece) }));
    const keyed = steps.map(
      (step) =>
        new Map(
          pieces.map((piece) => [piece.id, valuesOf(step.pose, piece.id)]),
        ),
    );
    const moved: Moved = {
      turn: new Map<string, Set<number>>(),
      move: new Map<string, Set<number>>(),
    };
    const rest = new Map<string, Values>();

    const leadParts: string[][] = [];
    let previous = rest;
    steps.forEach((step, index) => {
      const last = !action.loop && index === steps.length - 1;
      leadParts.push(
        stepLines(
          targets,
          previous,
          keyed[index],
          step.seconds,
          "  ",
          moved,
          !last,
          blending,
        ).lines,
      );
      previous = keyed[index];
    });

    // The laps after the first. The first lap has run every key, so a lap
    // starts by going back from the last key to the first and then through the
    // rest. A loop whose steps take no time at all would never sleep and so
    // never let the engine run, so it does not loop.
    const loop: string[] = [];
    let loopFrames = 0;
    if (action.loop && steps.length > 1) {
      const lap = [
        stepLines(
          targets,
          keyed[steps.length - 1],
          keyed[0],
          steps[0].seconds,
          "    ",
          moved,
          true,
          blending,
        ),
        ...steps
          .slice(1)
          .map((step, index) =>
            stepLines(
              targets,
              keyed[index],
              keyed[index + 1],
              step.seconds,
              "    ",
              moved,
              true,
              blending,
            ),
          ),
      ];
      for (const made of lap) {
        loop.push(...made.lines);
        loopFrames += made.frames;
      }
    }
    const looping = loop.length > 0 && loopFrames > 0;

    // With a blend in, the first key is reached over that time from wherever
    // the pieces are, on every axis the action ever moves, because the action
    // that held them left them anywhere.
    if (blendIn > 0) {
      const last = !action.loop && steps.length === 1;
      const lines = blendLines(targets, moved, keyed[0], blendIn, "  ");
      if (!last) lines.push(`  Sleep(${framesOf(blendIn) * SLEEP_FRAME_MS})`);
      leadParts[0] = lines;
    }
    const lead = leadParts.flat();

    // The pieces another action also moves. Whichever starts last takes them,
    // and the one it took them from no longer sends them home.
    const sharedWith = plans.filter(
      (other) =>
        other !== plan &&
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
interface Plan {
  action: LegoAction;
  steps: Step[];
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
 * The calls that take every axis the action moves to its first key over
 * `seconds`, each at the speed that covers what is left to go by then.
 */
function blendLines(
  targets: Target[],
  moved: Moved,
  first: Map<string, Values>,
  seconds: number,
  indent: string,
): string[] {
  const lines: string[] = [];
  for (const kind of ["turn", "move"] as const) {
    const call = kind === "turn" ? "BlendTurn" : "BlendMove";
    for (const { piece, name } of targets) {
      const axes = moved[kind].get(piece.id);
      if (!axes) continue;
      const to = first.get(piece.id) ?? REST;
      for (const axis of [...axes].sort()) {
        lines.push(
          `${indent}${call}(${name}, ${AXES[axis]}, ${lua(to[kind][axis])}, ${lua(seconds)})`,
        );
      }
    }
  }
  return lines;
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
    if (liveSteps(action, project).length === 0) return false;
    if (actionPieces(action, project).length === 0) return false;
    const { blendIn, blendOut } = blendOf(action, project);
    return blendIn > 0 || blendOut > 0;
  });
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
    if (action.loop && liveSteps(action, project).length < 2) {
      found.push(
        problem(
          "actions",
          "note",
          t`${actionName}: a looping action needs two keys to loop.`,
        ),
      );
    }
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
