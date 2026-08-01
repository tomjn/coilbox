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
 * A list rather than a bare union, because a game's `missions/extensions.lua`
 * names a kind as a string and `extensions.ts` has to check that it is one.
 */
export const PARAM_KINDS = [
  "string",
  "number",
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
}

/** The parameters one condition or action type takes, keyed by parameter name. */
export type TypeSpec = Record<string, ParamSpec>;

/** Comparisons a `var` condition can make. */
export const VAR_OPS = ["eq", "ne", "lt", "lte", "gt", "gte"] as const;

/** Conditions the runtime implements at runtime version 1. */
export const CONDITION_TYPES: Record<string, TypeSpec> = {
  units_in_zone: {
    zone: { kind: "zoneId" },
    team: { kind: "teamId", optional: true },
    unitDefs: { kind: "strings", optional: true },
    min: { kind: "number", optional: true },
    max: { kind: "number", optional: true },
  },
  unit_count: {
    team: { kind: "teamId" },
    unitDefs: { kind: "strings", optional: true },
    min: { kind: "number", optional: true },
    max: { kind: "number", optional: true },
  },
  unit_dead: {
    actor: { kind: "actorId" },
  },
  unit_health_below: {
    actor: { kind: "actorId" },
    /** Fraction of maximum health, 0 to 1. */
    fraction: { kind: "number" },
  },
  unit_built: {
    team: { kind: "teamId" },
    unitDef: { kind: "string" },
    count: { kind: "number", optional: true },
  },
  unit_captured: {
    actor: { kind: "actorId" },
    /** The capturing team. Absent means any. */
    team: { kind: "teamId", optional: true },
  },
  time_elapsed: {
    seconds: { kind: "number" },
  },
  var: {
    name: { kind: "varName" },
    op: { kind: "enum", values: VAR_OPS },
    value: { kind: "number" },
  },
  zone_held_for: {
    zone: { kind: "zoneId" },
    team: { kind: "teamId" },
    seconds: { kind: "number" },
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
  set_var: {
    name: { kind: "varName" },
    value: { kind: "number" },
  },
  add_var: {
    name: { kind: "varName" },
    value: { kind: "number" },
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
    unitDef: { kind: "string" },
    team: { kind: "teamId", optional: true },
  },
  camera_pan: {
    pos: { kind: "point" },
    seconds: { kind: "number", optional: true },
  },
  map_marker: {
    pos: { kind: "point" },
    text: { kind: "string", optional: true },
  },
  /** Ends the mission. Absent team means the human player's team. */
  victory: { team: { kind: "teamId", optional: true } },
  defeat: { team: { kind: "teamId", optional: true } },
};

/**
 * The runtime version that added a condition or action, for the types that did
 * not ship in version 1.
 *
 * Everything in the two tables above shipped in version 1, so this is empty
 * today. A type a later runtime adds goes here in the same change that adds it
 * to its table and bumps `missions/runtime.lua`, and that is what raises the
 * `runtimeVersion` of every scenario using it. Nothing is ever removed: a type
 * that has shipped keeps the version it shipped in.
 *
 * One map for both tables, because a condition and an action never share a name.
 */
export const TYPE_RUNTIME_VERSION: Record<string, number> = {};

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
