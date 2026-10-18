/**
 * Which scenarios a preset unit has something to do for.
 *
 * Read from the generated script rather than from a table of presets, so the
 * answer stays right as presets change. A scenario has something to do when at
 * least one call-in it fires has a body that does real work.
 */

import { PRESETS } from "./animPresets";
import type { Scenario } from "./scriptPlayback";

/**
 * Lines the generator writes for every unit, which say nothing about what a
 * preset does: the build stance lines (`BUILD_STANCE`), `AimWeapon1`'s
 * fallback, and what `Killed` always does. `QueryNanoPiece` is not a call-in
 * any scenario fires, so its root fallback does not need a rule here.
 */
const BOILERPLATE = [
  /^SetUnitValue\(COB\.INBUILDSTANCE, [01]\)$/,
  /^return true$/,
  /^Explode\(\w+, SFX\.SHATTER\)$/,
  /^return 1$/,
  /^--/,
];

function doesWork(line: string): boolean {
  const text = line.trim();
  return text !== "" && !BOILERPLATE.some((rule) => rule.test(text));
}

/**
 * The call-ins the generated script defines, each mapped to whether its body
 * does anything. A call-in that is not a key is not defined at all.
 */
export function answeredCallins(script: string): Map<string, boolean> {
  const answered = new Map<string, boolean>();
  let current: string | null = null;
  for (const line of script.split("\n")) {
    const start = /^function script\.(\w+)\(/.exec(line);
    if (start) {
      current = start[1];
      answered.set(current, false);
    } else if (line === "end") {
      current = null;
    } else if (current !== null && doesWork(line)) {
      answered.set(current, true);
    }
  }
  return answered;
}

/**
 * What an engine event asks of the script without a call-in of its own.
 * `factory-build` and `factory-finish` are what start and stop a factory's
 * `StartBuilding` and `StopBuilding`, and `fire` is `Shot1`.
 */
const ENGINE_CALLINS: Record<string, string> = {
  "factory-build": "StartBuilding",
  "factory-finish": "StopBuilding",
  fire: "Shot1",
};

/** The call-ins a scenario puts the unit through, apart from the ones every
 *  scenario starts with. */
export function scenarioCallins(scenario: Scenario): string[] {
  const names = new Set<string>();
  for (const event of scenario.events) {
    if (event.ambient || event.callin === "Create") continue;
    const name = event.callin ?? ENGINE_CALLINS[event.engine ?? ""];
    if (name) names.add(name);
  }
  return [...names];
}

/** The labels of the presets that would fill any of `callins`. Each preset is
 *  asked what it writes, with a stand-in piece for every role. */
function presetsFilling(callins: string[]): string[] {
  return PRESETS.filter((preset) => {
    try {
      const params = Object.fromEntries(
        preset.params.map((param) => [param.id, param.fallback]),
      );
      const result = preset.emit({
        params,
        signal: "SIG",
        pieces: () => ["piece"],
        wheels: () => [{ piece: "piece", radius: 1, front: true }],
        motion: { accRate: 0.5, decRate: 0.5 },
        weapons: () => [{ number: 1, piece: () => "piece", signal: "SIG" }],
        instances: () => [
          {
            id: "",
            params,
            number: 1,
            pieces: () => ["piece"],
            signal: "SIG",
            name: (n) => n,
          },
        ],
      });
      return callins.some((name) =>
        (result?.hooks[name as keyof typeof result.hooks] ?? []).some(doesWork),
      );
    } catch {
      return false;
    }
  }).map((preset) => preset.label);
}

/**
 * Why a scenario will do nothing for this script, or null when the script
 * answers it. Never blocks a scenario: seeing the unit stand still is a
 * result.
 */
export function scenarioMark(
  scenario: Scenario,
  script: string,
): string | null {
  const callins = scenarioCallins(scenario);
  if (callins.length === 0) return null;
  const answered = answeredCallins(script);
  if (callins.some((name) => answered.get(name))) return null;

  const undefinedCallins = callins.filter((name) => !answered.has(name));
  if (undefinedCallins.length === callins.length) {
    return `Presets do not cover this. Take the script over and write ${undefinedCallins.join(", ")}.`;
  }
  const empty = callins.filter((name) => answered.has(name));
  const fillers = presetsFilling(empty);
  return fillers.length > 0
    ? `Nothing to do. Add ${fillers.join(", ")} to react.`
    : "Nothing to do. No preset reacts to this.";
}
