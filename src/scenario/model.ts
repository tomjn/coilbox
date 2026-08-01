import type { SkirmishDraft } from "../play/drafts";
import {
  ACTION_TYPES,
  CONDITION_TYPES,
  type ParamSpec,
  type TypeSpec,
} from "./triggerTypes";

/**
 * Scenario schema: the single source of truth for the shape of a scenario
 * document. Rust stores these as opaque JSON, so this file (and
 * {@link parseScenario}) is the only place the shape is defined and validated,
 * exactly as `parseCampaignJson` is for campaigns.
 *
 * A scenario is the *in-engine* half of a mission: a skirmish setup plus the
 * spawns, zones, triggers, objectives and dialogue the mission runtime plays.
 * Presentation (briefing, panorama, voiceover) stays on the campaign mission
 * that wraps it. A scenario is a standalone document, referenced by id, and
 * snapshotted into a mission at attach time the way presets are today.
 *
 * Every cross-reference in the document is a string id. This parser validates
 * *shape* only. Resolving those ids against each other happens after compile,
 * against the emitted Lua, so the validator runs the same code path the engine
 * will. Keeping the two apart means a half-authored scenario still loads in the
 * editor, and only playing it demands that every reference resolve.
 */

/** The document schema version this build writes. */
export const SCENARIO_SCHEMA_VERSION = 1;

/** The runtime version every launch-set feature needs. */
export const SCENARIO_RUNTIME_VERSION = 1;

/**
 * A position on the map's ground plane, in engine world units. There is no `y`:
 * everything a scenario places sits on the terrain, so the runtime reads the
 * ground height at spawn time and the editor never has to store a height that
 * could drift from the map.
 */
export type Point = { x: number; z: number };

/**
 * Which way a placed unit faces, as the engine's `Spring.CreateUnit` facing:
 * 0 south, 1 east, 2 north, 3 west. Buildings snap to these four, so scenarios
 * use them for everything rather than carrying two rotation conventions.
 */
export type Facing = 0 | 1 | 2 | 3;

/** A named area of the map, referenced by triggers. */
export type ScenarioZone = { id: string; name: string } & (
  | { shape: "box"; min: Point; max: Point }
  | { shape: "circle"; center: Point; radius: number }
);

/** Author overrides applied to a placed unit after it is created. */
export type ActorState = {
  /** Starting health as a fraction of maximum, 0 to 1. */
  hp?: number;
  invulnerable?: boolean;
  unselectable?: boolean;
  /** Display name, for a named character unit. */
  name?: string;
};

/** One individually placed and individually addressable unit. */
export type ScenarioActor = {
  id: string;
  unitDef: string;
  /** A `setup.participants` id. */
  team: string;
  pos: Point;
  facing: Facing;
  state?: ActorState;
};

/**
 * An order for a group, used both as a group's opening orders and as the
 * payload of a `give_orders` action. `target` on a guard or attack order is an
 * actor id or a group id.
 */
export type ScenarioOrder =
  | { kind: "move" | "patrol" | "fight"; waypoints: Point[] }
  | { kind: "guard" | "attack"; target: string };

/** A count of one unit type within a group. */
export type GroupUnit = { def: string; count: number };

/** A block of units spawned and ordered together, addressed by one id. */
export type ScenarioGroup = {
  id: string;
  /** A `setup.participants` id. */
  team: string;
  units: GroupUnit[];
  pos: Point;
  orders: ScenarioOrder[];
  /**
   * Not created at game start. A `spawn_group` action creates a dormant group's
   * units, and `wake_group` releases a created group to run its `orders`. A
   * group that is not dormant is created at start and runs its orders straight
   * away.
   */
  dormant: boolean;
};

/** One building in a prefab, placed relative to the prefab's origin. */
export type PrefabBuilding = {
  def: string;
  offset: Point;
  facing: Facing;
  /** Factory build queue, as unit def names. */
  queue?: string[];
  /** Loop the queue rather than building it once. */
  repeat?: boolean;
};

/** A pre-built base: several buildings placed as one movable cluster. */
export type ScenarioPrefab = {
  id: string;
  /** A `setup.participants` id. */
  team: string;
  origin: Point;
  buildings: PrefabBuilding[];
};

/**
 * What the player may build and do. Distinct from `setup.restrictions`, which is
 * the engine `[RESTRICT]` block a captured skirmish carries. These are enforced
 * by the runtime, so they can be lifted mid-mission by `unlock_unit`.
 */
export type ScenarioRestrictions = {
  /** An allow list (only these) or a deny list (all but these) of unit defs. */
  buildable?: { mode: "allow" | "deny"; units: string[] };
  /** Engine command names withheld, for example `selfd`. */
  commands?: string[];
};

/** Per-participant starting conditions the skirmish setup cannot express. */
export type ScenarioTeam = {
  /** Unit defs handed to the team at its start position. */
  startUnits?: string[];
  /** Starting metal and energy in the bank. */
  resources?: { metal?: number; energy?: number };
  /** Free metal and energy per second, on top of anything the team builds. */
  income?: { metal?: number; energy?: number };
  /** Suppress the commander the game would normally spawn. */
  noCommander?: boolean;
};

export type ScenarioObjective = {
  id: string;
  kind: "primary" | "secondary";
  text: string;
  /** Not shown until a trigger completes or fails it. */
  hidden: boolean;
};

/**
 * An in-engine radio message, fired by a trigger. Portrait and audio are file
 * names rather than the campaign's `ImageRef`, because LuaUI plays them inside
 * the game: the compile step copies them beside the compiled mission and the
 * engine loads them from the game's VFS, where a data URI would be unreachable.
 */
export type ScenarioDialogue = {
  id: string;
  speaker: string;
  text: string;
  /** Image file name in the scenario's media folder. */
  portrait?: string;
  /** Audio file name in the scenario's media folder. */
  audio?: string;
};

/**
 * A trigger parameter value. Deliberately open: known types are validated
 * against `triggerTypes.ts`, and a type declared by a game's
 * `missions/extensions.lua` keeps whatever JSON it carries, so an older coilbox
 * never silently strips a newer or game-specific trigger's parameters.
 */
export type ScenarioParam =
  | string
  | number
  | boolean
  | ScenarioParam[]
  | { [key: string]: ScenarioParam };

/** One condition or action: a type name plus its parameters. */
export type TriggerStep = {
  type: string;
  params: Record<string, ScenarioParam>;
};

export type ScenarioCondition = TriggerStep;
export type ScenarioAction = TriggerStep;

/**
 * A trigger: when its conditions hold, run its actions. There is no nesting
 * inside the condition list, because triggers that enable and disable other
 * triggers already turn the flat list into a state machine, which is easier to
 * read in the editor than a boolean tree.
 */
export type ScenarioTrigger = {
  id: string;
  /** Armed at mission start. A disabled trigger waits for `enable_trigger`. */
  enabled: boolean;
  /** Fire every time the conditions hold, rather than once. */
  repeat: boolean;
  /**
   * Seconds a repeating trigger waits after firing before it may fire again.
   * Absent is no wait, which on the polled tick means twice a second, so this is
   * how a mission slows a repeating trigger down without counting in a var.
   */
  cooldown?: number;
  conditions: { op: "all" | "any"; conditions: ScenarioCondition[] };
  actions: ScenarioAction[];
};

export interface Scenario {
  schemaVersion: 1;
  id: string;
  name: string;
  description: string;
  /**
   * The lowest mission runtime version that can play this scenario, computed by
   * the editor from the trigger types used. Coilbox refuses to launch it against
   * an older vendored runtime, which would otherwise ignore the triggers it does
   * not know and silently play a broken mission.
   */
  runtimeVersion: number;
  /** Map, game, participants and modoptions, in the skirmish launcher's shape. */
  setup: SkirmishDraft;
  /** Keyed by `setup.participants` id. */
  teams: Record<string, ScenarioTeam>;
  zones: ScenarioZone[];
  actors: ScenarioActor[];
  groups: ScenarioGroup[];
  prefabs: ScenarioPrefab[];
  restrictions: ScenarioRestrictions;
  /** Mission variables, keyed by name. Numbers only, so `add_var` can do sums. */
  vars: Record<string, number>;
  triggers: ScenarioTrigger[];
  objectives: ScenarioObjective[];
  dialogue: ScenarioDialogue[];
  /**
   * A hand-written `script.lua` sits beside the compiled mission. The editor
   * shows that it exists but never edits it. Every use of it is a bug report
   * against this format.
   */
  script?: true;
  createdAt: string;
  updatedAt: string;
}

/* -------------------------------------------------------------------------- *
 * Parsing. Everything below narrows untrusted JSON.
 *
 * Two outcomes, chosen the way `parseCampaignJson` chooses them:
 *
 * - Reject the whole document (`null`) when the structure is wrong: a malformed
 *   entry in a registry, a missing id, a duplicate id, a required parameter
 *   absent. Silently dropping any of those produces a mission that compiles and
 *   then misbehaves in-game, which is far harder to diagnose than a refusal.
 * - Drop the field when an *optional* value is the wrong type, and let the
 *   runtime apply its default.
 * -------------------------------------------------------------------------- */

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const str = (v: unknown): string | undefined =>
  typeof v === "string" ? v : undefined;

const num = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;

const bool = (v: unknown): boolean | undefined =>
  typeof v === "boolean" ? v : undefined;

/** A non-empty string id, or undefined. */
const id = (v: unknown): string | undefined =>
  typeof v === "string" && v !== "" ? v : undefined;

/** Coerce an unknown into a string array, dropping non-string members. */
function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

function parsePoint(value: unknown): Point | undefined {
  if (!isRecord(value)) return undefined;
  const x = num(value.x);
  const z = num(value.z);
  return x === undefined || z === undefined ? undefined : { x, z };
}

/** Normalise anything to one of the engine's four facings. */
function parseFacing(value: unknown): Facing {
  const n = num(value);
  if (n === undefined) return 0;
  return (((Math.trunc(n) % 4) + 4) % 4) as Facing;
}

function parseOrder(value: unknown): ScenarioOrder | null {
  if (!isRecord(value)) return null;
  const kind = str(value.kind);
  if (kind === "move" || kind === "patrol" || kind === "fight") {
    if (!Array.isArray(value.waypoints)) return null;
    const waypoints: Point[] = [];
    for (const raw of value.waypoints) {
      const p = parsePoint(raw);
      if (!p) return null;
      waypoints.push(p);
    }
    return { kind, waypoints };
  }
  if (kind === "guard" || kind === "attack") {
    const target = id(value.target);
    return target === undefined ? null : { kind, target };
  }
  return null;
}

function parseOrders(value: unknown): ScenarioOrder[] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return null;
  const out: ScenarioOrder[] = [];
  for (const raw of value) {
    const order = parseOrder(raw);
    if (!order) return null;
    out.push(order);
  }
  return out;
}

/**
 * Parse a list of id-carrying records. Rejects the document on a malformed
 * entry or a repeated id, so a trigger can never reference the second of two
 * things sharing a name.
 */
function parseRegistry<T extends { id: string }>(
  value: unknown,
  parse: (raw: Record<string, unknown>) => T | null,
): T[] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return null;
  const out: T[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (!isRecord(raw)) return null;
    const parsed = parse(raw);
    if (!parsed || seen.has(parsed.id)) return null;
    seen.add(parsed.id);
    out.push(parsed);
  }
  return out;
}

function parseZone(z: Record<string, unknown>): ScenarioZone | null {
  const zid = id(z.id);
  if (zid === undefined) return null;
  const name = str(z.name) ?? zid;
  if (z.shape === "box") {
    const min = parsePoint(z.min);
    const max = parsePoint(z.max);
    if (!min || !max) return null;
    return { id: zid, name, shape: "box", min, max };
  }
  if (z.shape === "circle") {
    const center = parsePoint(z.center);
    const radius = num(z.radius);
    if (!center || radius === undefined) return null;
    return { id: zid, name, shape: "circle", center, radius };
  }
  return null;
}

function parseActorState(value: unknown): ActorState | undefined {
  if (!isRecord(value)) return undefined;
  const out: ActorState = {};
  const hp = num(value.hp);
  if (hp !== undefined) out.hp = hp;
  const invulnerable = bool(value.invulnerable);
  if (invulnerable !== undefined) out.invulnerable = invulnerable;
  const unselectable = bool(value.unselectable);
  if (unselectable !== undefined) out.unselectable = unselectable;
  const name = str(value.name);
  if (name !== undefined) out.name = name;
  return Object.keys(out).length ? out : undefined;
}

function parseActor(a: Record<string, unknown>): ScenarioActor | null {
  const aid = id(a.id);
  const unitDef = id(a.unitDef);
  const team = id(a.team);
  const pos = parsePoint(a.pos);
  if (aid === undefined || unitDef === undefined || team === undefined) {
    return null;
  }
  if (!pos) return null;
  return {
    id: aid,
    unitDef,
    team,
    pos,
    facing: parseFacing(a.facing),
    state: parseActorState(a.state),
  };
}

function parseGroupUnits(value: unknown): GroupUnit[] | null {
  if (!Array.isArray(value)) return null;
  const out: GroupUnit[] = [];
  for (const raw of value) {
    if (!isRecord(raw)) return null;
    const def = id(raw.def);
    const count = num(raw.count);
    if (def === undefined || count === undefined || count < 1) return null;
    out.push({ def, count: Math.trunc(count) });
  }
  return out;
}

function parseGroup(g: Record<string, unknown>): ScenarioGroup | null {
  const gid = id(g.id);
  const team = id(g.team);
  const pos = parsePoint(g.pos);
  const units = parseGroupUnits(g.units);
  const orders = parseOrders(g.orders);
  if (gid === undefined || team === undefined || !pos || !units || !orders) {
    return null;
  }
  return { id: gid, team, units, pos, orders, dormant: g.dormant === true };
}

function parseBuildings(value: unknown): PrefabBuilding[] | null {
  if (!Array.isArray(value)) return null;
  const out: PrefabBuilding[] = [];
  for (const raw of value) {
    if (!isRecord(raw)) return null;
    const def = id(raw.def);
    const offset = parsePoint(raw.offset);
    if (def === undefined || !offset) return null;
    const building: PrefabBuilding = {
      def,
      offset,
      facing: parseFacing(raw.facing),
    };
    if (Array.isArray(raw.queue)) building.queue = stringArray(raw.queue);
    if (raw.repeat === true) building.repeat = true;
    out.push(building);
  }
  return out;
}

function parsePrefab(p: Record<string, unknown>): ScenarioPrefab | null {
  const pid = id(p.id);
  const team = id(p.team);
  const origin = parsePoint(p.origin);
  const buildings = parseBuildings(p.buildings);
  if (pid === undefined || team === undefined || !origin || !buildings) {
    return null;
  }
  return { id: pid, team, origin, buildings };
}

function parseObjective(o: Record<string, unknown>): ScenarioObjective | null {
  const oid = id(o.id);
  if (oid === undefined) return null;
  return {
    id: oid,
    kind: o.kind === "secondary" ? "secondary" : "primary",
    text: str(o.text) ?? "",
    hidden: o.hidden === true,
  };
}

function parseDialogue(d: Record<string, unknown>): ScenarioDialogue | null {
  const did = id(d.id);
  if (did === undefined) return null;
  return {
    id: did,
    speaker: str(d.speaker) ?? "",
    text: str(d.text) ?? "",
    portrait: id(d.portrait),
    audio: id(d.audio),
  };
}

/**
 * Keep any JSON-safe value, for a trigger type coilbox does not know. Nesting is
 * capped so a deliberately deep document cannot blow the stack on load.
 */
function jsonValue(value: unknown, depth = 0): ScenarioParam | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (depth >= 8) return undefined;
  if (Array.isArray(value)) {
    const out: ScenarioParam[] = [];
    for (const item of value) {
      const kept = jsonValue(item, depth + 1);
      if (kept !== undefined) out.push(kept);
    }
    return out;
  }
  if (isRecord(value)) {
    const out: Record<string, ScenarioParam> = {};
    for (const [key, item] of Object.entries(value)) {
      const kept = jsonValue(item, depth + 1);
      if (kept !== undefined) out[key] = kept;
    }
    return out;
  }
  return undefined;
}

/** Narrow one declared parameter, or undefined when it is missing or wrong. */
function parseParam(
  spec: ParamSpec,
  value: unknown,
): ScenarioParam | undefined {
  switch (spec.kind) {
    case "number":
      return num(value);
    case "boolean":
      return bool(value);
    case "strings":
      return Array.isArray(value) ? stringArray(value) : undefined;
    case "point":
      return parsePoint(value);
    case "orders":
      return parseOrders(value) ?? undefined;
    case "enum": {
      const s = str(value);
      return s !== undefined && spec.values?.includes(s) ? s : undefined;
    }
    default:
      // Every remaining kind is a plain or id-carrying string.
      return id(value);
  }
}

/**
 * Narrow a condition or action's parameters. A known type is checked against its
 * table entry and rejects the document if a required parameter is missing or
 * malformed, because that compiles to a broken trigger. An unknown type (a game
 * extension, or a newer runtime's) keeps its JSON untouched.
 */
function parseParams(
  spec: TypeSpec | undefined,
  value: unknown,
): Record<string, ScenarioParam> | null {
  const raw = isRecord(value) ? value : {};
  const out: Record<string, ScenarioParam> = {};
  if (!spec) {
    for (const [key, item] of Object.entries(raw)) {
      const kept = jsonValue(item);
      if (kept !== undefined) out[key] = kept;
    }
    return out;
  }
  for (const [name, param] of Object.entries(spec)) {
    const parsed = parseParam(param, raw[name]);
    if (parsed === undefined) {
      if (!param.optional) return null;
      continue;
    }
    out[name] = parsed;
  }
  return out;
}

function parseStep(
  value: unknown,
  table: Record<string, TypeSpec>,
): TriggerStep | null {
  if (!isRecord(value)) return null;
  const type = id(value.type);
  if (type === undefined) return null;
  const params = parseParams(table[type], value.params);
  return params === null ? null : { type, params };
}

function parseTrigger(t: Record<string, unknown>): ScenarioTrigger | null {
  const tid = id(t.id);
  if (tid === undefined) return null;

  const group = isRecord(t.conditions) ? t.conditions : {};
  const rawConditions = Array.isArray(group.conditions) ? group.conditions : [];
  const conditions: ScenarioCondition[] = [];
  for (const raw of rawConditions) {
    const condition = parseStep(raw, CONDITION_TYPES);
    if (!condition) return null;
    conditions.push(condition);
  }

  if (!Array.isArray(t.actions)) return null;
  const actions: ScenarioAction[] = [];
  for (const raw of t.actions) {
    const action = parseStep(raw, ACTION_TYPES);
    if (!action) return null;
    actions.push(action);
  }

  const trigger: ScenarioTrigger = {
    id: tid,
    // Absent means armed: a trigger nobody thought about should fire.
    enabled: t.enabled !== false,
    repeat: t.repeat === true,
    conditions: { op: group.op === "any" ? "any" : "all", conditions },
    actions,
  };
  // A wait of zero or less is what leaving it out means, so it is left out.
  const cooldown = num(t.cooldown);
  if (cooldown !== undefined && cooldown > 0) trigger.cooldown = cooldown;
  return trigger;
}

function parseAmounts(
  value: unknown,
): { metal?: number; energy?: number } | undefined {
  if (!isRecord(value)) return undefined;
  const out: { metal?: number; energy?: number } = {};
  const metal = num(value.metal);
  if (metal !== undefined) out.metal = metal;
  const energy = num(value.energy);
  if (energy !== undefined) out.energy = energy;
  return Object.keys(out).length ? out : undefined;
}

function parseTeams(value: unknown): Record<string, ScenarioTeam> | null {
  if (value === undefined || value === null) return {};
  if (!isRecord(value)) return null;
  const out: Record<string, ScenarioTeam> = {};
  for (const [teamId, raw] of Object.entries(value)) {
    if (!isRecord(raw)) return null;
    const team: ScenarioTeam = {};
    if (Array.isArray(raw.startUnits)) {
      team.startUnits = stringArray(raw.startUnits);
    }
    const resources = parseAmounts(raw.resources);
    if (resources) team.resources = resources;
    const income = parseAmounts(raw.income);
    if (income) team.income = income;
    if (raw.noCommander === true) team.noCommander = true;
    out[teamId] = team;
  }
  return out;
}

function parseRestrictions(value: unknown): ScenarioRestrictions {
  if (!isRecord(value)) return {};
  const out: ScenarioRestrictions = {};
  if (isRecord(value.buildable) && Array.isArray(value.buildable.units)) {
    out.buildable = {
      mode: value.buildable.mode === "allow" ? "allow" : "deny",
      units: stringArray(value.buildable.units),
    };
  }
  if (Array.isArray(value.commands)) out.commands = stringArray(value.commands);
  return out;
}

function parseVars(value: unknown): Record<string, number> {
  if (!isRecord(value)) return {};
  const out: Record<string, number> = {};
  for (const [name, raw] of Object.entries(value)) {
    const n = num(raw);
    if (name !== "" && n !== undefined) out[name] = n;
  }
  return out;
}

/**
 * Narrow an already-parsed value to a validated {@link Scenario}, or `null` when
 * the shape does not match. Takes an unknown rather than text so the container
 * reader can hand it a payload directly.
 */
export function parseScenario(value: unknown): Scenario | null {
  if (!isRecord(value)) return null;

  const sid = id(value.id);
  const name = str(value.name);
  if (sid === undefined || name === undefined) return null;
  // The setup is the launch payload, as a campaign mission's snapshot is.
  if (!isRecord(value.setup)) return null;

  const teams = parseTeams(value.teams);
  const zones = parseRegistry(value.zones, parseZone);
  const actors = parseRegistry(value.actors, parseActor);
  const groups = parseRegistry(value.groups, parseGroup);
  const prefabs = parseRegistry(value.prefabs, parsePrefab);
  const triggers = parseRegistry(value.triggers, parseTrigger);
  const objectives = parseRegistry(value.objectives, parseObjective);
  const dialogue = parseRegistry(value.dialogue, parseDialogue);
  if (
    !teams ||
    !zones ||
    !actors ||
    !groups ||
    !prefabs ||
    !triggers ||
    !objectives ||
    !dialogue
  ) {
    return null;
  }

  return {
    schemaVersion: SCENARIO_SCHEMA_VERSION,
    id: sid,
    name,
    description: str(value.description) ?? "",
    runtimeVersion: num(value.runtimeVersion) ?? SCENARIO_RUNTIME_VERSION,
    setup: value.setup as unknown as SkirmishDraft,
    teams,
    zones,
    actors,
    groups,
    prefabs,
    restrictions: parseRestrictions(value.restrictions),
    vars: parseVars(value.vars),
    triggers,
    objectives,
    dialogue,
    script: value.script === true ? true : undefined,
    createdAt: str(value.createdAt) ?? "",
    updatedAt: str(value.updatedAt) ?? "",
  };
}

/**
 * Parse the raw JSON of a stored or imported scenario, or `null` if it is not
 * valid JSON or the shape does not match. The single untrusted-input validator
 * for scenario documents, and the future schema-migration point.
 */
export function parseScenarioJson(json: string): Scenario | null {
  try {
    return parseScenario(JSON.parse(json));
  } catch {
    return null;
  }
}
