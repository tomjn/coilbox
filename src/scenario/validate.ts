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

/**
 * A map's extent in elmos, the way `useMissionMapAssets` reports it.
 *
 * The validator reads a file, not a map, so a caller that knows which map the
 * scenario is set on hands the size in. Without it only the near edge can be
 * checked, because a coordinate below zero is off every map and one above zero
 * is only off a map you have measured.
 */
export interface MapExtent {
  width: number;
  height: number;
}

/** The parameter kinds that hold a cross-reference, and what to call each one. */
const NOUN = {
  zoneId: "zone",
  actorId: "actor or building",
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

/**
 * The ids the prefab buildings declare. A named building answers to the same
 * `units` table an actor does, so it is picked out of the same list and resolves
 * against the same kind (issue #878).
 */
function declaredBuildings(prefabs: unknown): Set<string> {
  const ids = new Set<string>();
  for (const prefab of asArray(prefabs)) {
    for (const id of declared(asRecord(prefab).buildings)) ids.add(id);
  }
  return ids;
}

function registries(mission: Record<string, unknown>): Registry {
  return {
    zoneId: declared(mission.zones),
    actorId: new Set([
      ...declared(mission.actors),
      ...declaredBuildings(mission.prefabs),
    ]),
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
 * document allows to be an actor, a named prefab building or a group, so the
 * target resolves against both registries. The first two share a registry.
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
      issues.push({ path: where, message: "no target given" });
      return;
    }
    if (!known.actorId.has(target) && !known.groupId.has(target)) {
      issues.push({
        path: where,
        message: `nothing called "${target}" for an order to aim at`,
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

/* -------------------------------------------------------------------------- *
 * Coordinates that are not on the map.
 *
 * Spring measures a map from its north-west corner, so every position in a
 * scenario is a positive offset from that corner and a negative one is off the
 * map. `CUnit::PreInit` answers an off-map creation by clamping it into bounds
 * rather than refusing it, so the mission that plays is not the mission that was
 * authored: units pile onto the edge and nothing says why. Issue #868 shipped
 * three fixtures laid out around a centre origin and the headless engine run
 * passed anyway.
 *
 * This is about the places a mission puts something, so a zone's own bounds are
 * left out. A zone is an area a condition tests against rather than a creation,
 * nothing clamps it, and an area that overhangs the edge simply covers less
 * ground. The editor draws one that way itself: `atLeastMinimum` in `zones.ts`
 * grows a box below the minimum size about its own centre, so a small zone drawn
 * against the edge legitimately sits a few elmos past it.
 *
 * Zero is the map edge, not off it, for the same reason. The editor's
 * `clampToMap` puts a drag that overshoots on exactly zero, so refusing it here
 * would refuse an ordinary edit. The fixture corpus is stricter about its own
 * coordinates for a different reason, that a fixture sitting on the edge cannot
 * show it was not clamped there.
 * -------------------------------------------------------------------------- */

/** One `{ x, z }` found in a compiled mission, and where it sits. */
interface FoundPoint {
  path: string;
  x: number;
  z: number;
}

const isPoint = (v: unknown): v is { x: number; z: number } =>
  isRecord(v) && typeof v.x === "number" && typeof v.z === "number";

/**
 * Every `{ x, z }` anywhere in a value, with the compiled path it sits at.
 *
 * A walk rather than a list of the fields that hold one, because a position
 * reaches the file through an actor, a group, a waypoint, a prefab and any
 * `point` trigger parameter, including one a game's own extension declared. An
 * entry carrying an id is named by it, the way {@link at} names one.
 */
function pointsIn(value: unknown, path = ""): FoundPoint[] {
  if (isPoint(value)) return [{ path, x: value.x, z: value.z }];
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => {
      const id = asRecord(entry).id;
      const ref = typeof id === "string" ? JSON.stringify(id) : String(index);
      return pointsIn(entry, `${path}[${ref}]`);
    });
  }
  if (isRecord(value)) {
    return Object.entries(value).flatMap(([key, entry]) =>
      pointsIn(entry, path ? `${path}.${key}` : key),
    );
  }
  return [];
}

/** Why a position is not on the map, or null when it is. */
function offMap(x: number, z: number, map?: MapExtent): string | null {
  if (x < 0 || z < 0) {
    return `${x},${z} is off the map. Spring measures a map from its north-west corner, so x and z start at 0.`;
  }
  if (!map || map.width <= 0 || map.height <= 0) return null;
  if (x > map.width || z > map.height) {
    return `${x},${z} is off the map, which is ${map.width} by ${map.height} elmos.`;
  }
  return null;
}

function checkPositions(
  mission: Record<string, unknown>,
  map: MapExtent | undefined,
  issues: MissionIssue[],
): void {
  for (const point of pointsIn(mission)) {
    // A zone is an area rather than a placement, and an ordinary edit puts one a
    // little past the edge. See the note above.
    if (point.path.startsWith("zones")) continue;
    // A prefab building's offset is measured from its prefab's origin and is
    // free to point north or west of it. Where it lands is checked below.
    if (point.path.endsWith(".offset")) continue;
    const message = offMap(point.x, point.z, map);
    if (message) issues.push({ path: point.path, message });
  }

  asArray(mission.prefabs).forEach((raw, index) => {
    const prefab = asRecord(raw);
    const origin = prefab.origin;
    if (!isPoint(origin)) return;
    const where = at("prefabs", prefab, index);
    asArray(prefab.buildings).forEach((entry, i) => {
      const building = asRecord(entry);
      const offset = building.offset;
      if (!isPoint(offset)) return;
      const message = offMap(origin.x + offset.x, origin.z + offset.z, map);
      if (message) {
        issues.push({ path: `${where}.buildings[${i}].offset`, message });
      }
    });
  });
}

/**
 * Two things answering to one name. Actors and named prefab buildings share the
 * runtime's `units` table, so a building that takes an actor's id, or another
 * building's, leaves every trigger naming it pointing at whichever the runtime
 * placed last.
 */
function checkUnitNames(
  mission: Record<string, unknown>,
  issues: MissionIssue[],
): void {
  const taken = declared(mission.actors);
  asArray(mission.prefabs).forEach((raw, index) => {
    const prefab = asRecord(raw);
    const where = at("prefabs", prefab, index);
    asArray(prefab.buildings).forEach((entry, i) => {
      const id = asRecord(entry).id;
      if (typeof id !== "string" || id === "") return;
      if (taken.has(id)) {
        issues.push({
          path: `${where}.buildings[${i}].id`,
          message: `"${id}" already names an actor or another building, and a trigger naming it would reach only one of them.`,
        });
      }
      taken.add(id);
    });
  });
}

/**
 * Resolve every cross-reference in an evaluated mission, and report all of them
 * rather than the first. An author fixing one typo at a time through the engine
 * is the failure this whole step exists to avoid.
 *
 * `map` is the extent of the map the scenario is set on, when the caller knows
 * it. Without it a position is only checked against the near edge.
 */
export function validateMission(
  mission: unknown,
  map?: MapExtent,
): MissionIssue[] {
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

  checkUnitNames(mission, issues);
  checkPositions(mission, map, issues);

  return issues;
}

/* -------------------------------------------------------------------------- *
 * Saying where an issue is, in the author's words.
 *
 * The paths above locate a problem in the compiled file, which is the right
 * thing to carry around and the wrong thing to put in front of the person who
 * wrote the scenario. `triggers["open"].actions[0].params.group` is the same
 * fact as `Trigger "open", action 1, group`, and only the second one tells them
 * where to click.
 * -------------------------------------------------------------------------- */

/** What each part of a compiled path is called in the editor. */
const PART: Record<string, string> = {
  actors: "Actor",
  groups: "Group",
  prefabs: "Prefab",
  zones: "Zone",
  triggers: "Trigger",
  objectives: "Objective",
  dialogue: "Dialogue line",
  teams: "Team",
  conditions: "Condition",
  actions: "Action",
  orders: "Order",
  waypoints: "Waypoint",
  buildings: "Building",
};

/** A name, optionally subscripted by an id or a position. */
const PART_PATTERN =
  /([A-Za-z_][A-Za-z0-9_]*)(?:\[(\d+|"(?:[^"\\]|\\.)*")\])?/y;

interface PathPart {
  name: string;
  /** The `["id"]` or `[0]` that followed the name, verbatim. */
  ref: string | null;
}

/**
 * Split a compiled path into its parts, or null when it is not one. The load
 * failure an unreadable mission comes back as is located by file name rather
 * than by path, and that is worth showing as it stands.
 */
function pathParts(path: string): PathPart[] | null {
  const parts: PathPart[] = [];
  let at = 0;
  while (at < path.length) {
    PART_PATTERN.lastIndex = at;
    const match = PART_PATTERN.exec(path);
    if (!match) return null;
    parts.push({ name: match[1], ref: match[2] ?? null });
    at = PART_PATTERN.lastIndex;
    if (at === path.length) break;
    if (path[at] !== ".") return null;
    at += 1;
  }
  return parts.length > 0 ? parts : null;
}

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/**
 * Where an issue is, in the terms the editor uses. Null when the path does not
 * point into the mission table.
 *
 * A list position is counted from one, because that is how the panel that holds
 * it is read. An entry that has an id is named by it, because that is what the
 * author typed.
 */
export function issueLocation(path: string): string | null {
  const parts = pathParts(path);
  if (!parts) return null;
  const said: string[] = [];
  for (const { name, ref } of parts) {
    // `params` is how the compiled file nests a step's parameters. The author
    // sees the parameter, not the table it sits in.
    if (name === "params") continue;
    // A name with no entry here is a parameter or a field, which is already
    // what the form calls it.
    const label = PART[name] ?? name;
    if (ref === null) said.push(label);
    else if (ref.startsWith('"')) said.push(`${label} ${quoted(ref)}`);
    else said.push(`${label} ${Number(ref) + 1}`);
  }
  const [first, ...rest] = said;
  if (!first) return null;
  return [first, ...rest.map(lowerFirst)].join(", ");
}

/** An id out of a compiled path, in plain quotes rather than Lua escapes. */
function quoted(ref: string): string {
  try {
    return `"${JSON.parse(ref)}"`;
  } catch {
    return ref;
  }
}

/** One issue as the author is told it: where it is, then what is wrong. */
export function describeIssue(issue: MissionIssue): string {
  return `${issueLocation(issue.path) ?? issue.path}: ${issue.message}`;
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
  map?: MapExtent,
): Promise<MissionIssue[]> {
  const path = missionPath(scenarioId);
  let mission: unknown;
  try {
    ({ mission } = await scenarioReadMission({ root, path }));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return [{ path, message }];
  }
  return validateMission(mission, map);
}
