import { scenarioReadMission } from "./bindings";
import { missionPath } from "./compile";
import {
  ACTION_TYPES,
  CONDITION_TYPES,
  type ParamKind,
  type TypeSpec,
} from "./triggerTypes";

/**
 * The read-back validator: load the compiled `mission.lua` the way the mission
 * runtime will, and report every id reference that does not resolve.
 *
 * Most mission bugs are typos in ids, and the engine's answer to one is silence:
 * a trigger that never fires, or a spawn that never happens. So the compile step
 * refuses first.
 *
 * The work is split across the language boundary on purpose:
 *
 * - Rust (`scenario_read_mission`) evaluates the file through `VFS.Include` in a
 *   sandboxed Spring Lua VM rooted at the game archive. That is the gadget's own
 *   code path, so a file the engine cannot load fails here rather than in-game.
 * - This module resolves the ids in what came back, because the table that says
 *   which trigger parameters *are* references is `triggerTypes.ts`. A second
 *   copy of it in Rust would drift the first time a trigger type is added.
 *
 * Everything below therefore reads the *compiled* names, not the document's: a
 * `teams` map keyed by participant id, registries as arrays of records with an
 * `id`, and `vars` keyed by variable name. Those names are pinned by
 * `crates/coilbox-springlua/tests/eval.rs`, which evaluates real emitter output.
 */

/** One unresolved reference, located by where it sits in the compiled file. */
export interface MissionIssue {
  /** For example `triggers["open"].actions[0].params.group`. */
  path: string;
  message: string;
}

/** The parameter kinds that hold a cross-reference, and what to call each one. */
const NOUN = {
  zoneId: "zone",
  actorId: "actor",
  groupId: "group",
  triggerId: "trigger",
  objectiveId: "objective",
  dialogueId: "dialogue line",
  teamId: "team",
  varName: "variable",
} as const;

type IdKind = keyof typeof NOUN;

const isIdKind = (kind: ParamKind): kind is IdKind => kind in NOUN;

/** Every id the compiled mission declares, by the kind that references it. */
type Registry = Record<IdKind, Set<string>>;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const asRecord = (v: unknown): Record<string, unknown> =>
  isRecord(v) ? v : {};

const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** The ids declared by one registry array (`zones`, `actors`, ...). */
function declared(list: unknown): Set<string> {
  const ids = new Set<string>();
  for (const entry of asArray(list)) {
    const id = asRecord(entry).id;
    if (typeof id === "string") ids.add(id);
  }
  return ids;
}

function registries(mission: Record<string, unknown>): Registry {
  return {
    zoneId: declared(mission.zones),
    actorId: declared(mission.actors),
    groupId: declared(mission.groups),
    triggerId: declared(mission.triggers),
    objectiveId: declared(mission.objectives),
    dialogueId: declared(mission.dialogue),
    teamId: new Set(Object.keys(asRecord(mission.teams))),
    varName: new Set(Object.keys(asRecord(mission.vars))),
  };
}

/** Name a registry entry by its id where it has one, so a message can be found. */
function at(
  list: string,
  entry: Record<string, unknown>,
  index: number,
): string {
  const id = entry.id;
  return typeof id === "string"
    ? `${list}[${JSON.stringify(id)}]`
    : `${list}[${index}]`;
}

function resolve(
  kind: IdKind,
  value: unknown,
  path: string,
  known: Registry,
  issues: MissionIssue[],
): void {
  if (typeof value !== "string" || value === "") {
    issues.push({ path, message: `no ${NOUN[kind]} given` });
    return;
  }
  if (!known[kind].has(value)) {
    issues.push({ path, message: `no ${NOUN[kind]} called "${value}"` });
  }
}

/**
 * A `guard` or `attack` order aims at one thing the mission placed, which the
 * document allows to be either an actor or a group, so the target resolves
 * against both registries.
 */
function checkOrders(
  value: unknown,
  path: string,
  known: Registry,
  issues: MissionIssue[],
): void {
  asArray(value).forEach((raw, index) => {
    const order = asRecord(raw);
    if (!("target" in order)) return;
    const where = `${path}[${index}].target`;
    const target = order.target;
    if (typeof target !== "string" || target === "") {
      issues.push({ path: where, message: "no actor or group given" });
      return;
    }
    if (!known.actorId.has(target) && !known.groupId.has(target)) {
      issues.push({
        path: where,
        message: `no actor or group called "${target}"`,
      });
    }
  });
}

/**
 * One condition or action. A type coilbox does not know belongs to a game's
 * `missions/extensions.lua`, and its parameters are that game's business, so it
 * passes through untouched exactly as the parser passes it through.
 */
function checkStep(
  raw: unknown,
  types: Record<string, TypeSpec>,
  path: string,
  known: Registry,
  issues: MissionIssue[],
): void {
  const step = asRecord(raw);
  const type = typeof step.type === "string" ? step.type : "";
  const spec: TypeSpec | undefined = types[type];
  if (!spec) return;

  const params = asRecord(step.params);
  for (const [name, param] of Object.entries(spec)) {
    const where = `${path}.params.${name}`;
    const value = params[name];
    if (param.kind === "orders") {
      checkOrders(value, where, known, issues);
      continue;
    }
    if (!isIdKind(param.kind)) continue;
    // An absent optional parameter is the runtime applying its default.
    if (value === undefined && param.optional) continue;
    resolve(param.kind, value, where, known, issues);
  }
}

/**
 * Resolve every cross-reference in an evaluated mission, and report all of them
 * rather than the first. An author fixing one typo at a time through the engine
 * is the failure this whole step exists to avoid.
 */
export function validateMission(mission: unknown): MissionIssue[] {
  if (!isRecord(mission)) {
    return [
      { path: "mission", message: "the compiled mission returned no table" },
    ];
  }
  const issues: MissionIssue[] = [];
  const known = registries(mission);

  // A team with no engine team number cannot be spawned for. The emitter keeps
  // the entry rather than dropping it precisely so this is sayable.
  for (const [id, raw] of Object.entries(asRecord(mission.teams))) {
    if (typeof asRecord(raw).team !== "number") {
      issues.push({
        path: `teams[${JSON.stringify(id)}]`,
        message: `"${id}" has no engine team, so nothing can spawn for it. It names a spectator, or a participant the setup does not have.`,
      });
    }
  }

  for (const list of ["actors", "groups", "prefabs"] as const) {
    asArray(mission[list]).forEach((raw, index) => {
      const entry = asRecord(raw);
      const where = at(list, entry, index);
      resolve("teamId", entry.team, `${where}.team`, known, issues);
      if (list === "groups") {
        checkOrders(entry.orders, `${where}.orders`, known, issues);
      }
    });
  }

  asArray(mission.triggers).forEach((raw, index) => {
    const trigger = asRecord(raw);
    const where = at("triggers", trigger, index);
    const group = asRecord(trigger.conditions);
    asArray(group.conditions).forEach((condition, i) => {
      checkStep(
        condition,
        CONDITION_TYPES,
        `${where}.conditions[${i}]`,
        known,
        issues,
      );
    });
    asArray(trigger.actions).forEach((action, i) => {
      checkStep(action, ACTION_TYPES, `${where}.actions[${i}]`, known, issues);
    });
  });

  return issues;
}

/**
 * Read a compiled mission back out of the game archive at `root` and validate
 * it. An empty array means the engine can be shown the mission.
 *
 * A file that will not load at all comes back as one issue rather than a thrown
 * error, so a caller has a single list to put in front of the author whatever
 * went wrong.
 */
export async function validateCompiledMission(
  root: string,
  scenarioId: string,
): Promise<MissionIssue[]> {
  const path = missionPath(scenarioId);
  let mission: unknown;
  try {
    ({ mission } = await scenarioReadMission({ root, path }));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return [{ path, message }];
  }
  return validateMission(mission);
}
