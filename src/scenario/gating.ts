/**
 * Capability gating: which of coilbox's condition and action types the runtime
 * that will actually play a scenario implements, and the lowest runtime version
 * the scenario needs.
 *
 * Both halves exist for one failure: a runtime that does not know a trigger type
 * ignores it and plays a quietly broken mission. So the editor never offers a
 * type the target runtime cannot run, and the document records the version it
 * needs so `scenarioRoute` can refuse to launch it against an older one.
 *
 * Which runtime is the target depends on the route the scenario would take. A
 * game that has adopted the runtime plays the scenario itself, so its own
 * vendored runtime is what the palette is measured against. Anything else goes
 * through the test mutator, which carries the runtime this build of coilbox
 * ships, so that one is. See `launch.ts`.
 *
 * Arithmetic on plain values, so it is tested without a browser. The panel that
 * shows it is `TriggerPanel.tsx`.
 */

import type { RuntimeMarker } from "./bindings";
import {
  type Capability,
  capabilityNote,
  runtimeCapabilities,
} from "./capabilities";
import type { ScenarioRoute } from "./launch";
import {
  amountVar,
  SCENARIO_RUNTIME_VERSION,
  type Scenario,
  usesDifficulty,
} from "./model";
import {
  ACTION_TYPES,
  CONDITION_TYPES,
  type TypeSpec,
  typeRuntimeVersion,
} from "./triggerTypes";

/**
 * The runtime that first recorded which unit each named base building became
 * (issue #878). A runtime behind this ignores a building's id, so `unit_dead` on
 * one holds from the first frame and the mission plays itself out. That is the
 * silent half-play the version gate exists to refuse.
 */
const BASE_BUILDING_VERSION = 2;

/**
 * The runtime that first read a var where a trigger wants a number (issue
 * #808). A runtime behind this reads `{ var = "quota" }` as no number at all
 * and falls back to zero, so "kills reached the quota" holds from the first
 * frame and "add the bonus" adds nothing.
 */
const VAR_AMOUNT_VERSION = 3;

/**
 * Whether any trigger parameter names a var where a number goes.
 *
 * By the shape a stored value has rather than by the parameters the type table
 * calls amounts, so a parameter a game's own extension declared as one counts
 * too. The var it reads comes out of the runtime's own table, which is what
 * version 3 added, so an extension's amount needs the same runtime.
 */
function readsVarAsAmount(scenario: Scenario): boolean {
  const named = (value: unknown): boolean => {
    if (amountVar(value) !== null) return true;
    if (Array.isArray(value)) return value.some(named);
    if (typeof value === "object" && value !== null)
      return Object.values(value).some(named);
    return false;
  };
  return scenario.triggers.some((trigger) =>
    [...trigger.conditions.conditions, ...trigger.actions].some((step) =>
      named(step.params),
    ),
  );
}

/**
 * The runtime that first sent a camera move and a map marker to one team
 * (issue #827). A runtime behind this reads past the team and does both for
 * everyone, so a co-op mission yanks the other player's camera to the ambush
 * that was meant for one of them.
 */
const VIEW_TEAM_VERSION = 3;

/** The actions that reach one player's screen rather than the game. */
const VIEW_ACTIONS = new Set(["camera_pan", "map_marker"]);

/** Whether any camera move or map marker names a team. */
function pointsAtOneTeam(scenario: Scenario): boolean {
  return scenario.triggers.some((trigger) =>
    trigger.actions.some(
      (step) => VIEW_ACTIONS.has(step.type) && step.params.team !== undefined,
    ),
  );
}

/**
 * The runtime that first held `zone_held_for` to an uncontested zone (issue
 * #802). A runtime behind this reads past the flag and answers the presence
 * question, so "hold the keep for a minute" is settled by a scout parked in a
 * keep an enemy army is also sitting in.
 */
const UNCONTESTED_HOLD_VERSION = 3;

/** Whether any hold asks to be uncontested. A flag written `false` is the
 *  presence question every runtime has always answered, so it asks for
 *  nothing. */
function asksForAnUncontestedHold(scenario: Scenario): boolean {
  return scenario.triggers.some((trigger) =>
    trigger.conditions.conditions.some(
      (step) =>
        step.type === "zone_held_for" && step.params.uncontested === true,
    ),
  );
}

/**
 * The runtime that first read a difficulty range (issue #2164). A runtime behind
 * this ignores every range and plays the hard version of the mission at every
 * setting, which is worse than refusing: the player asked for easy and got the
 * extra turrets anyway.
 */
const DIFFICULTY_VERSION = 6;

/**
 * The runtime that first read a negated condition. A runtime
 * behind this reads past the flag and answers the question the right way up, so
 * "the player has not built a factory" holds the moment they build one, which is
 * the exact opposite of the mission that was written.
 */
const NEGATED_CONDITION_VERSION = 7;

/** Whether any condition asks to be read the other way round. A flag written
 *  `false` is the question every runtime has always answered, so it asks for
 *  nothing. */
function negatesACondition(scenario: Scenario): boolean {
  return scenario.triggers.some((trigger) =>
    trigger.conditions.conditions.some((step) => step.negate === true),
  );
}

/** Every string a value carries, however deeply nested. */
function stringsIn(value: unknown, out: Set<string>): void {
  if (typeof value === "string") out.add(value);
  else if (Array.isArray(value)) for (const item of value) stringsIn(item, out);
  else if (typeof value === "object" && value !== null)
    for (const item of Object.values(value)) stringsIn(item, out);
}

/**
 * Whether any trigger or order names a base building.
 *
 * Every string in the triggers and in the groups' opening orders, against the
 * building ids, rather than the parameters the type table calls references. A
 * building id is minted rather than typed, so a string equal to one is a
 * reference to it, and reading them all covers an order target and a parameter a
 * game's own extension declared as readily as a `unit_dead`. Reading too much
 * only ever raises the version a scenario asks for, which is the safe way to be
 * wrong.
 */
function namesBaseBuilding(scenario: Scenario): boolean {
  const ids = new Set(
    scenario.bases.flatMap((base) =>
      base.buildings.map((b) => b.id).filter((id): id is string => !!id),
    ),
  );
  if (ids.size === 0) return false;

  const named = new Set<string>();
  stringsIn(scenario.triggers, named);
  stringsIn(
    scenario.groups.map((g) => g.orders),
    named,
  );
  return [...ids].some((id) => named.has(id));
}

/**
 * The lowest mission runtime version that can play a scenario.
 *
 * The floor is {@link SCENARIO_RUNTIME_VERSION}, the version every launch-set
 * feature needs, raised by any trigger type that arrived later and by any format
 * feature an older runtime would ignore.
 *
 * `since` is the version table, taken as an argument so the maximum can be
 * exercised while every shipped type is still version 1.
 */
export function requiredRuntimeVersion(
  scenario: Scenario,
  since: (type: string) => number = typeRuntimeVersion,
): number {
  let version = SCENARIO_RUNTIME_VERSION;
  for (const trigger of scenario.triggers) {
    for (const step of trigger.conditions.conditions) {
      version = Math.max(version, since(step.type));
    }
    for (const step of trigger.actions) {
      version = Math.max(version, since(step.type));
    }
  }
  if (namesBaseBuilding(scenario)) {
    version = Math.max(version, BASE_BUILDING_VERSION);
  }
  if (readsVarAsAmount(scenario)) {
    version = Math.max(version, VAR_AMOUNT_VERSION);
  }
  if (pointsAtOneTeam(scenario)) {
    version = Math.max(version, VIEW_TEAM_VERSION);
  }
  if (asksForAnUncontestedHold(scenario)) {
    version = Math.max(version, UNCONTESTED_HOLD_VERSION);
  }
  if (usesDifficulty(scenario)) {
    version = Math.max(version, DIFFICULTY_VERSION);
  }
  if (negatesACondition(scenario)) {
    version = Math.max(version, NEGATED_CONDITION_VERSION);
  }
  return version;
}

/** The runtime pair a palette is measured against: the one that will run the
 *  scenario, and coilbox's own to compare it with. */
export interface RuntimeTarget {
  installed: RuntimeMarker | null;
  available: RuntimeMarker | null;
}

/**
 * Which runtime a scenario's palette is gated on, for the route it would take.
 *
 * The adopted route is the game's own runtime. The mutator route is coilbox's,
 * because the generated game carries it, so a type coilbox ships is one the
 * scenario can use however far behind the base game is. A route that is not
 * known yet, because the scenario names no game or the scan has not answered,
 * gates on nothing rather than guessing.
 */
export function gateTarget(
  route: ScenarioRoute | null,
  installed: RuntimeMarker | null,
  available: RuntimeMarker | null,
): RuntimeTarget {
  if (route === "adopted") return { installed, available };
  if (route === "mutator") return { installed: available, available };
  return { installed: null, available };
}

/**
 * Why each type cannot be used, keyed by type name. A type the target runtime
 * implements is absent, so an empty gate stops nothing.
 */
export interface PaletteGate {
  conditions: Record<string, string>;
  actions: Record<string, string>;
}

/** A gate that stops nothing, for an editor with no runtime to measure. */
export const NO_GATE: PaletteGate = { conditions: {}, actions: {} };

/** How many types a gate stops, which is what decides whether it is worth
 *  explaining which runtime the palette is measured against. */
export function gatedCount(gate: PaletteGate): number {
  return Object.keys(gate.conditions).length + Object.keys(gate.actions).length;
}

function gated(
  types: Record<string, TypeSpec>,
  items: Capability[],
  target: RuntimeTarget,
): Record<string, string> {
  const { installed, available } = target;
  if (!installed) return {};
  const status = new Map(items.map((c) => [c.name, c.status]));
  const out: Record<string, string> = {};
  for (const type of Object.keys(types)) {
    // Supported and extra both mean the target runtime declares the type, so
    // both pass. Anything else is a type it would ignore, including one missing
    // from the capability list because neither runtime declares it.
    const known = status.get(type);
    if (known === "supported" || known === "extra") continue;
    const note = capabilityNote("added", installed, available);
    if (note) out[type] = note;
  }
  return out;
}

/**
 * The types the target runtime cannot run, with what to say about each.
 *
 * Only coilbox's own types are gated, because they are the only ones the palette
 * offers. A type the target declares and coilbox does not is the game running
 * ahead of this build. Coilbox has no form to offer for it, which is what
 * `missions/extensions.lua` (#776) is for, and it is not something to grey.
 */
export function paletteGate(target: RuntimeTarget): PaletteGate {
  const caps = runtimeCapabilities(target.installed, target.available);
  return {
    conditions: gated(CONDITION_TYPES, caps.conditions, target),
    actions: gated(ACTION_TYPES, caps.actions, target),
  };
}
