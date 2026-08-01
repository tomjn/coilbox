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
import { SCENARIO_RUNTIME_VERSION, type Scenario } from "./model";
import {
  ACTION_TYPES,
  CONDITION_TYPES,
  type TypeSpec,
  typeRuntimeVersion,
} from "./triggerTypes";

/**
 * The lowest mission runtime version that can play a scenario.
 *
 * The floor is {@link SCENARIO_RUNTIME_VERSION}, the version every launch-set
 * feature needs, raised by any trigger type that arrived later. Trigger types
 * are the only part of the format that has grown so far. A later format feature
 * needing a newer runtime raises the floor from here too.
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
