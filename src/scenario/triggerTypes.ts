/**
 * The launch capability table: the condition and action types the coilbox
 * mission runtime implements at runtime version 1, and the parameters each one
 * takes.
 *
 * This is a *table*, not a set of hand-written interfaces, because trigger types
 * are open-ended by design. A game may ship `missions/extensions.lua` declaring
 * its own condition and action types, which coilbox has never heard of and must
 * still store faithfully (see the design spec's "Game extensions"). So the
 * parser validates a known type against its entry here and passes an unknown
 * type through untouched, and the editor builds its palette from this table
 * intersected with what the installed runtime declares.
 *
 * The `kind` of each parameter also says which parameters are cross-references.
 * Every `*Id` kind (and `varName`) holds a string id that the compile-time
 * validator resolves against the matching scenario registry. This file is the
 * single place that knowledge lives.
 */

/**
 * What a trigger parameter holds. The id kinds are string cross-references:
 * `zoneId` → `Scenario.zones`, `actorId` → `actors`, `groupId` → `groups`,
 * `triggerId` → `triggers`, `objectiveId` → `objectives`, `dialogueId` →
 * `dialogue`, `teamId` → a `setup.participants` id (and `Scenario.teams` key),
 * `varName` → a `Scenario.vars` key.
 *
 * `amount` is a number the author may name a var for instead: it holds either
 * the number or `{ var: name }`, and the runtime reads the var out of the same
 * table `varName` names one in (issue #808).
 *
 * A list rather than a bare union, because a game's `missions/extensions.lua`
 * names a kind as a string and `extensions.ts` has to check that it is one.
 */
export const PARAM_KINDS = [
  "string",
  "number",
  "amount",
  "boolean",
  "strings",
  "point",
  "orders",
  "enum",
  "zoneId",
  "actorId",
  "groupId",
  "triggerId",
  "objectiveId",
  "dialogueId",
  "teamId",
  "varName",
] as const;

export type ParamKind = (typeof PARAM_KINDS)[number];

export interface ParamSpec {
  kind: ParamKind;
  /** Absent from the stored params is fine, and the runtime applies its default. */
  optional?: boolean;
  /** The allowed strings, for `kind: "enum"`. */
  values?: readonly string[];
  /**
   * What the editor calls this parameter, in place of its schema key. Absent
   * falls back to the key itself, which is today's behaviour and what a game's
   * own `missions/extensions.lua` gets until it declares one (issue #2274).
   */
  label?: string;
  /**
   * The number the runtime substitutes when this optional number is left out,
   * shown in the placeholder as "default 1" rather than the bare word
   * "default". Only set where the runtime actually puts a fixed number back
   * in: `min` and `max` mean unbounded when left out, which is not this.
   */
  default?: number;
}

/** The parameters one condition or action type takes, keyed by parameter name. */
export type TypeSpec = Record<string, ParamSpec>;

/**
 * A parameter that holds a unit type, which is picked from the game's units
 * rather than typed. The table calls these plain strings because the runtime
 * does, so the name is what says a unit belongs in them.
 *
 * Here rather than beside the picker that reads it, because the validator asks
 * the same question of the compiled file (issue #908) and two answers to it
 * would drift.
 */
export function isUnitDefParam(name: string): boolean {
  return name === "unitDef" || name === "unitDefs";
}

/** Comparisons a `var` condition can make. */
export const VAR_OPS = ["eq", "ne", "lt", "lte", "gt", "gte"] as const;

/** Conditions the runtime implements at runtime version 1. */
export const CONDITION_TYPES: Record<string, TypeSpec> = {
  units_in_zone: {
    zone: { kind: "zoneId" },
    team: { kind: "teamId", optional: true },
    unitDefs: { kind: "strings", optional: true, label: "unit types" },
    min: { kind: "number", optional: true, label: "at least" },
    max: { kind: "number", optional: true, label: "at most" },
  },
  unit_count: {
    team: { kind: "teamId" },
    unitDefs: { kind: "strings", optional: true, label: "unit types" },
    min: { kind: "number", optional: true, label: "at least" },
    max: { kind: "number", optional: true, label: "at most" },
  },
  unit_dead: {
    actor: { kind: "actorId" },
  },
  unit_health_below: {
    actor: { kind: "actorId" },
    /** Fraction of maximum health, 0 to 1. */
    fraction: { kind: "number", label: "health fraction" },
  },
  unit_built: {
    team: { kind: "teamId" },
    unitDef: { kind: "string", label: "unit type" },
    // Matches the runtime's own fallback in coilbox_unit_conditions.lua.
    count: { kind: "number", optional: true, default: 1 },
  },
  unit_captured: {
    actor: { kind: "actorId" },
    /** The capturing team. Absent means any. */
    team: { kind: "teamId", optional: true, label: "capturing team" },
  },
  time_elapsed: {
    seconds: { kind: "number" },
  },
  var: {
    name: { kind: "varName", label: "variable" },
    op: { kind: "enum", values: VAR_OPS, label: "comparison" },
    /** A number, or another var to compare against: "kills reached the quota"
     *  when the quota is itself a var (issue #808). */
    value: { kind: "amount" },
  },
  zone_held_for: {
    zone: { kind: "zoneId" },
    team: { kind: "teamId" },
    seconds: { kind: "number" },
    /**
     * Break the hold while anyone the team is not allied with is standing in
     * the zone, so "hold the keep" is not satisfied by a scout parked in a
     * keep an enemy army is also sitting in (issue #802). Gaia is not anyone.
     */
    uncontested: { kind: "boolean", optional: true, label: "uncontested only" },
  },
};

/** Actions the runtime implements at runtime version 1. */
export const ACTION_TYPES: Record<string, TypeSpec> = {
  spawn_group: { group: { kind: "groupId" } },
  wake_group: { group: { kind: "groupId" } },
  give_orders: {
    group: { kind: "groupId" },
    orders: { kind: "orders" },
  },
  gift_units: {
    group: { kind: "groupId" },
    team: { kind: "teamId" },
  },
  /** Stop ordering a group. The units stay on the map and stay whoever's they
   *  are: this is the mission letting go, not a transfer (issue #812). */
  release_group: { group: { kind: "groupId" } },
  set_var: {
    name: { kind: "varName", label: "variable" },
    value: { kind: "amount" },
  },
  /** Move a var by a number, or by what another var holds: "add the bonus to
   *  the score" (issue #808). */
  add_var: {
    name: { kind: "varName", label: "variable" },
    value: { kind: "amount", label: "amount" },
  },
  enable_trigger: { trigger: { kind: "triggerId" } },
  disable_trigger: { trigger: { kind: "triggerId" } },
  complete_objective: { objective: { kind: "objectiveId" } },
  fail_objective: { objective: { kind: "objectiveId" } },
  dialogue: { line: { kind: "dialogueId" } },
  /** A sound file beside the compiled mission, by name. */
  play_sound: { sound: { kind: "string" } },
  reveal_area: {
    zone: { kind: "zoneId" },
    team: { kind: "teamId", optional: true },
    seconds: { kind: "number", optional: true },
  },
  unlock_unit: {
    unitDef: { kind: "string", label: "unit type" },
    team: { kind: "teamId", optional: true },
  },
  /** Whose camera moves, and whose map gets the label. Absent means everyone,
   *  which is what a single player scenario wants (issue #827). */
  camera_pan: {
    pos: { kind: "point", label: "position" },
    // Matches M.DEFAULT_PAN_SECONDS in coilbox_view.lua.
    seconds: { kind: "number", optional: true, default: 1 },
    team: { kind: "teamId", optional: true },
  },
  map_marker: {
    pos: { kind: "point", label: "position" },
    text: { kind: "string", optional: true },
    team: { kind: "teamId", optional: true },
  },
  /** Ends the mission. Absent team means the human player's team. */
  victory: { team: { kind: "teamId", optional: true } },
  defeat: { team: { kind: "teamId", optional: true } },
  /**
   * Call a function the game already has, by name (issue #2422).
   *
   * A name and not a body. A mission is data the runtime reads out of an
   * archive, so a function written into a scenario would be source code
   * arriving from wherever the scenario came from and running in synced Lua.
   * Naming one the game shipped keeps what runs the game's, which is the same
   * line `missions/extensions.lua` draws.
   *
   * Dotted, because what a game has to offer lives on `GG` rather than loose in
   * a global: `GG.MyGame.StartTheStorm`.
   */
  call_lua: {
    func: { kind: "string", label: "function name" },
  },
  /**
   * Tell one of the mission's units to build something.
   *
   * `pos` is where it goes, for a construction unit. A factory has nowhere to
   * put a building, so leaving the position out queues the unit in the factory
   * instead, which is the same order with the same shape.
   */
  build_unit: {
    builder: { kind: "actorId", label: "builder" },
    unitDef: { kind: "string", label: "unit type" },
    pos: { kind: "point", optional: true, label: "where to build it" },
    facing: { kind: "number", optional: true, default: 0 },
    // Matches M.DEFAULT_BUILD_COUNT in coilbox_groups.lua.
    count: { kind: "number", optional: true, default: 1, label: "how many" },
  },
  /**
   * Move a team's bank once: a gift when the number is positive, a drain when
   * it is negative.
   *
   * Both halves are optional, so "take 1000 energy" is one field rather than a
   * zero the author has to write beside it.
   */
  give_resources: {
    team: { kind: "teamId" },
    metal: { kind: "amount", optional: true },
    energy: { kind: "amount", optional: true },
  },
  /**
   * What a team is paid from now on, per second, replacing whatever it was
   * being paid. Negative is a continuous drain, which is how a mission bleeds a
   * team rather than emptying it in one go.
   */
  set_income: {
    team: { kind: "teamId" },
    metal: { kind: "amount", optional: true, label: "metal per second" },
    energy: { kind: "amount", optional: true, label: "energy per second" },
  },
  /** Move how much a team can hold, which is the ceiling a gift is clamped to. */
  give_storage: {
    team: { kind: "teamId" },
    metal: { kind: "amount", optional: true, label: "metal storage" },
    energy: { kind: "amount", optional: true, label: "energy storage" },
  },
};

/**
 * One line under each condition or action's label in the add-step dropdown, in
 * the editor's own voice (issue #2286). Before this, a type with nothing here
 * fell back to its parameter names joined with commas, which read as the
 * explanation of what the type does when it was only ever the schema.
 *
 * A game's own type carries its author's description instead
 * (`ExtensionType.description`), and one that ships none says so rather than
 * reaching for this table: a game's type is not coilbox's to describe.
 *
 * One map for both tables, same as `TYPE_RUNTIME_VERSION`, because a condition
 * and an action never share a name.
 */
export const TYPE_DESCRIPTIONS: Record<string, string> = {
  units_in_zone:
    "Watches how many units are standing in a zone against the count you set.",
  unit_count:
    "Counts a team's units anywhere on the map, not just inside a zone.",
  unit_dead: "Becomes true the moment a named actor is destroyed.",
  unit_health_below:
    "Trips once an actor's health drops below the fraction you set.",
  unit_built: "Holds once a team has finished building enough of a unit type.",
  unit_captured:
    "True once an actor changes hands, whether captured or gifted away.",
  time_elapsed:
    "True once a set number of seconds has passed since the mission began.",
  var: "Compares a variable to a number, or to another variable.",
  zone_held_for:
    "Holds once a team has kept a zone for the time you set, optionally only while uncontested.",
  spawn_group:
    "Places a group's units on the map, holding position until wake group or give orders sets them moving.",
  wake_group:
    "Places a group on the map if it isn't there yet, and sends it off on its orders.",
  give_orders:
    "Replaces a group's orders and puts it in motion on the new ones.",
  gift_units:
    "Hands a group's units to another team, though the mission keeps ordering them.",
  release_group:
    "Lets go of a group: its units stay put and keep their owner, and the mission stops ordering them.",
  set_var: "Sets a variable to a number, or to what another variable holds.",
  add_var: "Adds a number, or another variable's value, to a variable.",
  enable_trigger: "Arms a trigger so its conditions are checked again.",
  disable_trigger: "Disarms a trigger until something enables it again.",
  complete_objective: "Marks an objective as done.",
  fail_objective: "Marks an objective as failed.",
  dialogue: "Plays one of the mission's dialogue lines.",
  play_sound: "Plays a named sound file.",
  reveal_area:
    "Lifts the fog over a zone for a team, for a set time or the rest of the mission.",
  unlock_unit: "Frees a team to build a unit type the mission had restricted.",
  camera_pan: "Moves a team's camera to a point on the map.",
  map_marker: "Drops a point on a team's map, labelled if you give it text.",
  victory: "Ends the mission with a team's side winning.",
  defeat:
    "Ends the mission with a team's side losing, and everyone else winning.",
  call_lua: "Calls a function the game already has, by name.",
  build_unit:
    "Tells one of the mission's units to build something, at a point or into a factory queue.",
  give_resources:
    "Moves a team's metal or energy once, up for a gift and down for a drain.",
  set_income:
    "Sets what a team is paid per second from now on. A negative number bleeds it instead.",
  give_storage: "Moves how much metal or energy a team can hold.",
};

/**
 * The band a condition or action sits under in the add-step dropdown (issue
 * #2273). Before this, both lists were one flat run of options, so choosing
 * what a trigger does meant reading every entry rather than the handful in the
 * band an author already knows they want.
 *
 * A condition and an action never share a name (`TYPE_DESCRIPTIONS`'s own
 * rule), so one map serves both tables. `ACTION_GROUP_ORDER` and
 * `CONDITION_GROUP_ORDER` say what order the bands are offered in. A game's own
 * type is never in this table, so `AddStep` falls back to `GAME_TYPE_GROUP`
 * rather than dropping it.
 */
/** The band a game's own condition or action types fall under, since a
 *  declaration says nothing about which of coilbox's bands it belongs in.
 *  Always offered last, after every built-in band. */
export const GAME_TYPE_GROUP = "Game types";

export const TYPE_GROUPS: Record<string, string> = {
  // Conditions.
  units_in_zone: "Units",
  unit_count: "Units",
  unit_dead: "Units",
  unit_health_below: "Units",
  unit_built: "Units",
  unit_captured: "Units",
  var: "Variables",
  time_elapsed: "Time",
  zone_held_for: "Time",
  // Actions.
  spawn_group: "Units",
  wake_group: "Units",
  give_orders: "Units",
  gift_units: "Units",
  release_group: "Units",
  unlock_unit: "Units",
  build_unit: "Units",
  give_resources: "Economy",
  set_income: "Economy",
  give_storage: "Economy",
  call_lua: "Game code",
  set_var: "Variables",
  add_var: "Variables",
  enable_trigger: "Trigger flow",
  disable_trigger: "Trigger flow",
  complete_objective: "Objectives",
  fail_objective: "Objectives",
  dialogue: "Presentation",
  play_sound: "Presentation",
  reveal_area: "Presentation",
  camera_pan: "Presentation",
  map_marker: "Presentation",
  victory: "Ending",
  defeat: "Ending",
};

/** The bands `AddStep` offers for the conditions list, in the order shown. */
export const CONDITION_GROUP_ORDER = ["Units", "Variables", "Time"] as const;

/** The bands `AddStep` offers for the actions list, in the order shown. */
export const ACTION_GROUP_ORDER = [
  "Units",
  "Economy",
  "Variables",
  "Trigger flow",
  "Objectives",
  "Presentation",
  "Ending",
  // Last of coilbox's own bands, and read as the pair to `GAME_TYPE_GROUP`
  // right after it: this reaches the game's Lua, and that is the game's own
  // types. Both are about what the game brought rather than what coilbox has.
  "Game code",
] as const;

/**
 * The runtime version that added a condition or action, for the types that did
 * not ship in version 1.
 *
 * A type a later runtime adds goes here in the same change that adds it to its
 * table and bumps `missions/runtime.lua`, and that is what raises the
 * `runtimeVersion` of every scenario using it. Nothing is ever removed: a type
 * that has shipped keeps the version it shipped in.
 *
 * One map for both tables, because a condition and an action never share a name.
 */
export const TYPE_RUNTIME_VERSION: Record<string, number> = {
  /** Issue #812. A runtime behind 3 ignores it and goes on ordering a squad the
   *  mission handed the player. */
  release_group: 3,
  /** Issue #2422. Five actions and one format feature, all landing in 7. A
   *  runtime behind it has no implementation for any of them, so each is a
   *  trigger that reports itself once and does nothing. */
  call_lua: 7,
  build_unit: 7,
  give_resources: 7,
  set_income: 7,
  give_storage: 7,
};

/**
 * The lowest runtime version that implements a condition or action.
 *
 * Version 1 for anything this build has not been told otherwise about, which
 * covers every type version 1 shipped and every type a game's own
 * `missions/extensions.lua` declares. An extension type is the game's to
 * implement, so it says nothing about which coilbox runtime a scenario needs.
 */
export function typeRuntimeVersion(type: string): number {
  return TYPE_RUNTIME_VERSION[type] ?? 1;
}
