import type { BaseBlueprint, BlueprintBuilding } from "../blueprint/model";
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

/**
 * The document schema version this build writes. Version 2 split a prefab into a
 * reusable {@link BaseBlueprint} and a {@link ScenarioBase} placement referencing
 * it (issue #1310). {@link parseScenario} still reads a version 1 document.
 */
export const SCENARIO_SCHEMA_VERSION = 2;

/**
 * The schema version a compiled `mission.lua` declares, which the runtime a game
 * vendored refuses to run above.
 *
 * Deliberately not {@link SCENARIO_SCHEMA_VERSION}. It used to be the same
 * number because the compiled mission mirrored the document, but the two answer
 * different questions: this one is the shape the runtime reads, and the split
 * that moved the document to version 2 is resolved back into the old shape by
 * `compileScenario` rather than changing it. Raising this would make every
 * already-vendored runtime refuse every mission coilbox compiles, for a wire
 * format that has not moved.
 */
export const MISSION_SCHEMA_VERSION = 1;

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

/**
 * How hard the mission is being played.
 *
 * Chosen at launch and not stored in the document, the way the engine team
 * numbers are not: one scenario is played at every level, which is the whole
 * point of having them. `launch.ts` carries the choice to the runtime in the
 * `coilbox_difficulty` modoption.
 *
 * Three levels because that is what a player expects to be offered, and ordered
 * because the ranges below are "this and up" and "this and down" rather than a
 * set of levels to tick. Never reorder or remove one: a document names a level
 * by its own name, so the order here is the meaning of every range already
 * authored.
 */
export const DIFFICULTIES = ["easy", "normal", "hard"] as const;

export type Difficulty = (typeof DIFFICULTIES)[number];

/** What a mission plays at when nobody chose, which is the middle one. */
export const DEFAULT_DIFFICULTY: Difficulty = "normal";

/** Where one level sits on the ladder, counting from the easiest. */
export function difficultyRank(level: Difficulty): number {
  return DIFFICULTIES.indexOf(level) + 1;
}

/**
 * The difficulties one thing exists at (issue #2164). Both ends are optional
 * and inclusive, so `{ atLeast: "hard" }` is "only on hard", `{ atMost:
 * "normal" }` is "up to normal", and saying neither is what everything already
 * authored says: it is always there.
 *
 * Two bounds rather than a list of levels because that is the shape Splaunch
 * gives a Zero-K scenario's units, and because it stays right when a level is
 * added between two that exist.
 */
export type DifficultyRange = { atLeast?: Difficulty; atMost?: Difficulty };

/** Whether something with this range is part of a mission played at `level`. */
export function difficultyApplies(
  range: DifficultyRange | undefined,
  level: Difficulty,
): boolean {
  if (!range) return true;
  const at = difficultyRank(level);
  if (range.atLeast && at < difficultyRank(range.atLeast)) return false;
  if (range.atMost && at > difficultyRank(range.atMost)) return false;
  return true;
}

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
  /** The difficulties this actor is placed at. Absent is every one. */
  difficulty?: DifficultyRange;
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
  /**
   * The difficulties this group exists at. Absent is every one. A group left
   * out is not placed at the start and is not placed by `spawn_group` or
   * `wake_group` either, so "the second wave only comes on hard" is one range
   * rather than a difficulty test on every trigger that sends it.
   */
  difficulty?: DifficultyRange;
};

/**
 * What a mission adds to one building of a placed blueprint (issue #1310).
 *
 * Every field here is meaningless outside a mission, which is why none of them
 * are on the blueprint: a layout somebody built in a live game has no triggers
 * to answer to, and a layout posted for other people to use carries no queue
 * anybody else would want.
 */
export type BaseBuildingRole = {
  /**
   * The name triggers know this building by, in the same space as `actors`. A
   * building with one is addressable exactly as an actor is, so "when the keep's
   * factory dies" is a `unit_dead` on this id. Optional because a base placed
   * before ids existed has none, and because nothing needs one until a trigger
   * points at it.
   */
  id?: string;
  /** Factory build queue, as unit def names. */
  queue?: string[];
  /** Loop the queue rather than building it once. */
  repeat?: boolean;
};

/**
 * A blueprint put down on a mission's map: whose it is, where it stands, and
 * what each of its buildings is for.
 *
 * The layout itself is not here. It is the `blueprints` entry this names, so the
 * same layout placed twice is one description of the geometry and two
 * placements, and so a base built for a mission can be lifted straight back out
 * as something usable anywhere.
 */
export type ScenarioBase = {
  id: string;
  /** A `blueprints` id. */
  blueprint: string;
  /** A `setup.participants` id. */
  team: string;
  origin: Point;
  /**
   * The mission-only fields, one entry per blueprint building, in the same
   * order. A building the mission adds nothing to has an empty entry rather than
   * a hole, and the list may stop short of the blueprint's, which is what a
   * blueprint dropped in from outside looks like before anything is added to it.
   */
  buildings: BaseBuildingRole[];
  /**
   * The difficulties this base is placed at. Absent is every one. The whole
   * placement, not one building of it: an author who wants the extra turret and
   * not the rest of the base places the turret as its own base, which is what
   * Splaunch's own example does.
   */
  difficulty?: DifficultyRange;
};

/**
 * One building of a placed base, its blueprint geometry and its mission role
 * read together. What every reader of a base actually wants, and the shape the
 * compiled mission carries.
 */
export type PlacedBuilding = BlueprintBuilding & BaseBuildingRole;

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

/**
 * The var an `amount` parameter reads its number out of, or null when it holds
 * a plain number (issue #808).
 *
 * Takes an `unknown` because the same shape has to be read out of a compiled
 * mission by the validator, where nothing is typed yet, as well as out of a
 * document.
 */
export function amountVar(value: unknown): string | null {
  if (!isRecord(value)) return null;
  const name = value.var;
  return typeof name === "string" && name !== "" ? name : null;
}

/** One condition or action: a type name plus its parameters. */
export type TriggerStep = {
  type: string;
  params: Record<string, ScenarioParam>;
  /**
   * Hold when this condition does not. Only read on a condition, because an
   * action has no truth to turn over.
   *
   * A flag on the step rather than a `not_built` type per condition: "the
   * player has not built X" is the same question `unit_built` already asks,
   * read the other way round, and a second table of opposites would have to
   * grow every time the first one did.
   *
   * A negated condition is polled rather than event-driven, whatever the type
   * underneath it watches. `unit_built` is woken by a unit being finished, and
   * "has not built one" asked only on the frame somebody built something is a
   * question that can only ever answer no. `coilbox_triggers.lua` is where that
   * holds.
   *
   * Absent rather than `false` when it is off, so every document written before
   * this compiles to the bytes it always did.
   */
  negate?: boolean;
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
  /**
   * What everything else points at: `enable_trigger` and `disable_trigger`, the
   * compiled mission, the runtime, and the editor's own selection. Minted once
   * and never changed, so nothing holding a trigger has to guess after a rename
   * (issue #2205).
   */
  id: string;
  /**
   * What the author calls it. Editable, not unique, and never seen by the
   * runtime: it exists only so a trigger can be read in the list and in a
   * picker. A document written before triggers had one takes its id as its name,
   * which is the string it was displayed under anyway.
   */
  name: string;
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
  /**
   * The difficulties this trigger runs at. Absent is every one.
   *
   * A trigger outside its range is not armed and cannot be armed:
   * `enable_trigger` on it does nothing. So "on hard the reinforcements arrive
   * twice" is a second trigger with `atLeast: "hard"`, and a mission that turns
   * its own triggers on and off cannot switch a hard-only one back on by
   * accident.
   */
  difficulty?: DifficultyRange;
  conditions: { op: "all" | "any"; conditions: ScenarioCondition[] };
  actions: ScenarioAction[];
};

export interface Scenario {
  schemaVersion: 2;
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
  /** The layouts this document's bases are placed from. */
  blueprints: BaseBlueprint[];
  bases: ScenarioBase[];
  restrictions: ScenarioRestrictions;
  /** Mission variables, keyed by name. Numbers only, so `add_var` can do sums. */
  vars: Record<string, number>;
  triggers: ScenarioTrigger[];
  objectives: ScenarioObjective[];
  dialogue: ScenarioDialogue[];
  /**
   * The highest number this document has used for each kind of minted id, keyed
   * by the id's prefix: `trigger`, `objective` and `line`.
   *
   * Deleting one of those frees its id, and the steps pointing at it are left
   * alone on purpose, so without this the next one added takes the freed id and
   * a stale `enable_trigger` quietly arms the wrong trigger (issue #2250).
   * Deleting writes the mark, so a number is never handed out twice.
   *
   * Absent until something is deleted, so a document nothing has been removed
   * from is written exactly as it was. See `pages/components/ids.ts`.
   */
  idCounters?: Record<string, number>;
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

const difficulty = (v: unknown): Difficulty | undefined =>
  DIFFICULTIES.find((level) => level === v);

/**
 * A difficulty range, or undefined when it says nothing.
 *
 * An end that is not a level this build knows is dropped rather than rejecting
 * the document, so a document written against a later ladder loses the bound it
 * cannot read and keeps the one it can. An empty range is undefined, because
 * "no bounds either way" is what saying nothing already means, and leaving an
 * empty table in would change the compiled bytes of a document that asks for
 * nothing.
 */
function parseDifficultyRange(value: unknown): DifficultyRange | undefined {
  if (!isRecord(value)) return undefined;
  const out: DifficultyRange = {};
  const atLeast = difficulty(value.atLeast);
  if (atLeast !== undefined) out.atLeast = atLeast;
  const atMost = difficulty(value.atMost);
  if (atMost !== undefined) out.atMost = atMost;
  return Object.keys(out).length ? out : undefined;
}

/** `{ difficulty }` when there is a range, and nothing at all when there is
 *  not, so the key stays absent rather than present and undefined. */
function difficultyOf(value: unknown): { difficulty?: DifficultyRange } {
  const range = parseDifficultyRange(value);
  return range ? { difficulty: range } : {};
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
    ...difficultyOf(a.difficulty),
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
  return {
    id: gid,
    team,
    units,
    pos,
    orders,
    dormant: g.dormant === true,
    ...difficultyOf(g.difficulty),
  };
}

function parseLayout(value: unknown): BlueprintBuilding[] | null {
  if (!Array.isArray(value)) return null;
  const out: BlueprintBuilding[] = [];
  for (const raw of value) {
    if (!isRecord(raw)) return null;
    const def = id(raw.def);
    const offset = parsePoint(raw.offset);
    if (def === undefined || !offset) return null;
    // What the building was before it was swapped for another side's equivalent
    // (issue #1314), which is what makes the swap reversible.
    const originalName = str(raw.originalName)?.trim() || undefined;
    out.push({
      def,
      offset,
      facing: parseFacing(raw.facing),
      ...(originalName ? { originalName } : {}),
    });
  }
  return out;
}

function parseBlueprint(b: Record<string, unknown>): BaseBlueprint | null {
  const bid = id(b.id);
  const buildings = parseLayout(b.buildings);
  if (bid === undefined || !buildings) return null;
  return {
    id: bid,
    // Left as it is read, blank and all. What a nameless layout is called is
    // decided across the whole list, in {@link namedBlueprints}.
    name: str(b.name)?.trim() ?? "",
    // Only ever true or absent: a layout is a build order or it is a layout,
    // and "false" is the same thing as saying nothing (issue #1418).
    ordered: b.ordered === true ? true : undefined,
    // The map it was drawn on, when it was drawn on one (issue #1315). A blank
    // is the same thing as saying nothing, so it reads as no map rather than as
    // a map called nothing.
    designedFor: str(b.designedFor)?.trim() || undefined,
    buildings,
  };
}

/**
 * Layouts with a name a person could have chosen (issue #1414).
 *
 * A layout's `name` was the id the editor minted for it, because nothing in the
 * editor set or showed one, and every document written before this build carries
 * a UUID there. A UUID is not a name to put on a card in a library, so a layout
 * called nothing, or called its own id, is numbered by its place in the document
 * instead. Numbered around the names that are already taken, because two layouts
 * called the same thing in one picker is the problem this is fixing.
 *
 * A read migration rather than a version bump: an older build reading a document
 * this has been through finds a name where it expected one and loses nothing.
 */
function namedBlueprints(blueprints: BaseBlueprint[]): BaseBlueprint[] {
  const named = (b: BaseBlueprint) => b.name !== "" && b.name !== b.id;
  const taken = new Set(blueprints.filter(named).map((b) => b.name));
  return blueprints.map((blueprint, i) => {
    if (named(blueprint)) return blueprint;
    let n = i + 1;
    while (taken.has(`Blueprint ${n}`)) n++;
    taken.add(`Blueprint ${n}`);
    return { ...blueprint, name: `Blueprint ${n}` };
  });
}

/**
 * The mission-only half of a base's buildings.
 *
 * Never rejects: an entry that is not a record is a building the mission says
 * nothing about, which is exactly what an empty role means. Trailing empties are
 * dropped, because the list is read by position and a run of them on the end
 * says nothing that its absence does not.
 */
function parseRoles(value: unknown): BaseBuildingRole[] {
  if (!Array.isArray(value)) return [];
  const roles = value.map((raw) => {
    const role: BaseBuildingRole = {};
    if (!isRecord(raw)) return role;
    const rid = id(raw.id);
    if (rid !== undefined) role.id = rid;
    if (Array.isArray(raw.queue)) role.queue = stringArray(raw.queue);
    if (raw.repeat === true) role.repeat = true;
    return role;
  });
  let end = roles.length;
  while (end > 0 && Object.keys(roles[end - 1]).length === 0) end--;
  return roles.slice(0, end);
}

function parseBase(p: Record<string, unknown>): ScenarioBase | null {
  const pid = id(p.id);
  const blueprint = id(p.blueprint);
  const team = id(p.team);
  const origin = parsePoint(p.origin);
  if (
    pid === undefined ||
    blueprint === undefined ||
    team === undefined ||
    !origin
  ) {
    return null;
  }
  return {
    id: pid,
    blueprint,
    team,
    origin,
    buildings: parseRoles(p.buildings),
    ...difficultyOf(p.difficulty),
  };
}

/**
 * A schema version 1 document's `prefabs` read as blueprints and placements.
 *
 * Each prefab becomes one blueprint holding its geometry and one base placing
 * it, sharing the prefab's id: a base and a blueprint are separate registries,
 * so nothing collides, and a document read and written again keeps the id every
 * trigger and every saved selection already names.
 *
 * Every prefab gets a blueprint of its own even where two were laid out
 * identically. Recognising that they match is the author's call to make in the
 * editor, not something a migration should decide on their behalf by silently
 * joining two bases together.
 */
function migratePrefabs(
  value: unknown,
): { blueprints: BaseBlueprint[]; bases: ScenarioBase[] } | null {
  const prefabs = parseRegistry(value, (p) => {
    const pid = id(p.id);
    const team = id(p.team);
    const origin = parsePoint(p.origin);
    const buildings = parseLayout(p.buildings);
    const roles = parseRoles(p.buildings);
    if (pid === undefined || team === undefined || !origin || !buildings) {
      return null;
    }
    return { id: pid, team, origin, buildings, roles };
  });
  if (!prefabs) return null;
  return {
    blueprints: prefabs.map((p) => ({
      id: p.id,
      // A prefab had no name of its own, so this is one {@link namedBlueprints}
      // fills in.
      name: "",
      buildings: p.buildings,
    })),
    bases: prefabs.map((p) => ({
      id: p.id,
      blueprint: p.id,
      team: p.team,
      origin: p.origin,
      buildings: p.roles,
    })),
  };
}

/**
 * The document's layouts and the bases placed from them, migrating a version 1
 * document's `prefabs` when it has no `bases` of its own.
 *
 * A base naming a blueprint the document does not hold rejects the whole thing,
 * unlike a trigger naming a zone that is gone, which the editor is happy to let
 * an author fix. The two halves are one thing split in two rather than two
 * things referring to each other, so a placement with no layout is not a
 * half-authored base, it is a base whose buildings have been lost.
 */
function parseBases(
  value: Record<string, unknown>,
): { blueprints: BaseBlueprint[]; bases: ScenarioBase[] } | null {
  const old = value.bases === undefined && value.blueprints === undefined;
  const blueprints = old
    ? null
    : parseRegistry(value.blueprints, parseBlueprint);
  const bases = old ? null : parseRegistry(value.bases, parseBase);
  const split = old
    ? migratePrefabs(value.prefabs)
    : blueprints && bases
      ? { blueprints, bases }
      : null;
  if (!split) return null;

  const known = new Set(split.blueprints.map((b) => b.id));
  if (!split.bases.every((base) => known.has(base.blueprint))) return null;
  return { blueprints: namedBlueprints(split.blueprints), bases: split.bases };
}

/** One placed base's buildings, blueprint geometry and mission role together, or
 *  an empty list when the blueprint is gone. */
export function baseBuildings(
  blueprints: BaseBlueprint[],
  base: ScenarioBase,
): PlacedBuilding[] {
  const layout = blueprints.find((b) => b.id === base.blueprint);
  if (!layout) return [];
  return layout.buildings.map((building, i) => ({
    ...building,
    ...base.buildings[i],
  }));
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
    case "amount": {
      // A number, or the var to read one out of. Neither shape is guessed at:
      // anything else is a parameter the document does not have.
      const plain = num(value);
      if (plain !== undefined) return plain;
      const named = amountVar(value);
      return named === null ? undefined : { var: named };
    }
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
  if (params === null) return null;
  // Only `true` is a negation. Absent and `false` are the same step, and the
  // key is left off so a document round trips to the bytes it came in as.
  return value.negate === true
    ? { type, params, negate: true }
    : { type, params };
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
    // The whole migration for issue #2205. A trigger written before names
    // existed was displayed under its id, so that is the name it had.
    name: str(t.name) || tid,
    // Absent means armed: a trigger nobody thought about should fire.
    enabled: t.enabled !== false,
    repeat: t.repeat === true,
    ...difficultyOf(t.difficulty),
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
 * The high water marks a document carries, or undefined when it carries none.
 *
 * A mark is a whole count, so anything else is dropped rather than refused: a
 * lost mark costs one reused id, which is what the document had before the mark
 * existed, and refusing the document over it would lose the mission instead.
 * Keys are not narrowed to the prefixes known here, so a mark written by a later
 * coilbox survives a round trip through this one.
 */
function parseIdCounters(value: unknown): Record<string, number> | undefined {
  if (!isRecord(value)) return undefined;
  const out: Record<string, number> = {};
  for (const [prefix, raw] of Object.entries(value)) {
    const n = num(raw);
    if (prefix !== "" && n !== undefined && n >= 0 && Number.isInteger(n)) {
      out[prefix] = n;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
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
  const split = parseBases(value);
  const triggers = parseRegistry(value.triggers, parseTrigger);
  const objectives = parseRegistry(value.objectives, parseObjective);
  const dialogue = parseRegistry(value.dialogue, parseDialogue);
  if (
    !teams ||
    !zones ||
    !actors ||
    !groups ||
    !split ||
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
    blueprints: split.blueprints,
    bases: split.bases,
    restrictions: parseRestrictions(value.restrictions),
    vars: parseVars(value.vars),
    triggers,
    objectives,
    dialogue,
    idCounters: parseIdCounters(value.idCounters),
    script: value.script === true ? true : undefined,
    createdAt: str(value.createdAt) ?? "",
    updatedAt: str(value.updatedAt) ?? "",
  };
}

/**
 * Whether anything in the document depends on the difficulty it is played at.
 *
 * The one question two things ask. `requiredRuntimeVersion` raises the runtime a
 * scenario needs only for a document this is true of, so nothing already
 * authored asks for a runtime it does not need. And the launch offers a
 * difficulty only for one, because a picker that changes nothing is a picker
 * worth leaving out.
 */
export function usesDifficulty(scenario: Scenario): boolean {
  const ranged = (item: { difficulty?: DifficultyRange }) =>
    item.difficulty !== undefined;
  return (
    scenario.actors.some(ranged) ||
    scenario.groups.some(ranged) ||
    scenario.bases.some(ranged) ||
    scenario.triggers.some(ranged)
  );
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
