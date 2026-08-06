import { describe, expect, it } from "vitest";
import type { RuntimeMarker } from "./bindings";
import { newScenario } from "./create";
import {
  gatedCount,
  gateTarget,
  paletteGate,
  requiredRuntimeVersion,
} from "./gating";
import type { Scenario, TriggerStep } from "./model";
import { ACTION_TYPES, CONDITION_TYPES } from "./triggerTypes";

const marker = (
  version: number,
  conditions: string[],
  actions: string[],
): RuntimeMarker => ({ version, schemaVersion: 1, conditions, actions });

/** Coilbox's own runtime, as `missions/runtime.lua` declares it. */
const coilbox = (version = 1): RuntimeMarker =>
  marker(version, Object.keys(CONDITION_TYPES), Object.keys(ACTION_TYPES));

const step = (type: string): TriggerStep => ({ type, params: {} });

function withTrigger(conditions: string[], actions: string[]): Scenario {
  const scenario = newScenario("test");
  return {
    ...scenario,
    triggers: [
      {
        id: "trigger-1",
        enabled: true,
        repeat: false,
        conditions: { op: "all", conditions: conditions.map(step) },
        actions: actions.map(step),
      },
    ],
  };
}

describe("requiredRuntimeVersion", () => {
  it("is the first runtime for a scenario with no triggers", () => {
    expect(requiredRuntimeVersion(newScenario("empty"))).toBe(1);
  });

  it("is the first runtime for every type coilbox ships today", () => {
    const scenario = withTrigger(
      Object.keys(CONDITION_TYPES),
      Object.keys(ACTION_TYPES),
    );
    expect(requiredRuntimeVersion(scenario)).toBe(1);
  });

  it("takes the highest version any type used needs", () => {
    const since = (type: string) =>
      ({ zone_held_for: 2, map_marker: 3 })[type] ?? 1;
    expect(
      requiredRuntimeVersion(
        withTrigger(["zone_held_for"], ["victory"]),
        since,
      ),
    ).toBe(2);
    expect(
      requiredRuntimeVersion(
        withTrigger(["zone_held_for"], ["map_marker"]),
        since,
      ),
    ).toBe(3);
  });

  it("reads every trigger, not just the first", () => {
    const since = (type: string) => (type === "map_marker" ? 4 : 1);
    const one = withTrigger(["var"], ["victory"]);
    const scenario: Scenario = {
      ...one,
      triggers: [
        one.triggers[0],
        { ...one.triggers[0], id: "trigger-2", actions: [step("map_marker")] },
      ],
    };
    expect(requiredRuntimeVersion(scenario, since)).toBe(4);
  });

  it("is not raised by a type a game extension declares", () => {
    expect(requiredRuntimeVersion(withTrigger(["sf_weather"], []))).toBe(1);
  });

  /**
   * Issue #878. Runtime 1 ignores a prefab building's id, and `unit_dead` on a
   * name it has never heard of holds from the first frame, so a scenario naming
   * a building has to be refused by an older game rather than half played.
   */
  describe("a scenario that names a prefab building", () => {
    const withBase = (target: string): Scenario => {
      const scenario = withTrigger([], []);
      return {
        ...scenario,
        prefabs: [
          {
            id: "keep",
            team: "player",
            origin: { x: 500, z: 500 },
            buildings: [
              {
                id: "keep-lab",
                def: "corlab",
                offset: { x: 0, z: 0 },
                facing: 0,
              },
            ],
          },
        ],
        triggers: [
          {
            ...scenario.triggers[0],
            conditions: {
              op: "all",
              conditions: [{ type: "unit_dead", params: { actor: target } }],
            },
          },
        ],
      };
    };

    it("needs the runtime that records which unit it became", () => {
      expect(requiredRuntimeVersion(withBase("keep-lab"))).toBe(2);
    });

    it("is left on the first runtime when nothing names one", () => {
      expect(requiredRuntimeVersion(withBase("some-actor"))).toBe(1);
    });

    it("counts a group ordered to guard one", () => {
      const scenario = withBase("some-actor");
      expect(
        requiredRuntimeVersion({
          ...scenario,
          groups: [
            {
              id: "keepers",
              team: "player",
              units: [{ def: "armpw", count: 1 }],
              pos: { x: 600, z: 600 },
              orders: [{ kind: "guard", target: "keep-lab" }],
              dormant: false,
            },
          ],
        }),
      ).toBe(2);
    });
  });
});

describe("gateTarget", () => {
  const installed = marker(1, ["var"], []);
  const available = marker(2, ["var", "zone_held_for"], []);

  it("measures an adopted game against its own runtime", () => {
    expect(gateTarget("adopted", installed, available)).toEqual({
      installed,
      available,
    });
  });

  it("measures the mutator route against the runtime coilbox ships", () => {
    expect(gateTarget("mutator", installed, available)).toEqual({
      installed: available,
      available,
    });
  });

  it("measures nothing when the route is not known yet", () => {
    expect(gateTarget(null, installed, available)).toEqual({
      installed: null,
      available,
    });
  });
});

describe("paletteGate", () => {
  it("stops nothing when the target runs everything coilbox ships", () => {
    const gate = paletteGate({ installed: coilbox(), available: coilbox() });
    expect(gatedCount(gate)).toBe(0);
  });

  it("names the version that adds a type the game is behind on", () => {
    const installed = marker(
      1,
      Object.keys(CONDITION_TYPES).filter((c) => c !== "zone_held_for"),
      Object.keys(ACTION_TYPES).filter((a) => a !== "map_marker"),
    );
    const gate = paletteGate({ installed, available: coilbox(2) });
    expect(gate.conditions).toEqual({ zone_held_for: "Needs runtime 2" });
    expect(gate.actions).toEqual({ map_marker: "Needs runtime 2" });
  });

  it("does not name a version a game running ahead would go back to", () => {
    const installed = marker(
      3,
      Object.keys(CONDITION_TYPES).filter((c) => c !== "var"),
      Object.keys(ACTION_TYPES),
    );
    const gate = paletteGate({ installed, available: coilbox(2) });
    expect(gate.conditions).toEqual({ var: "Not in this game's runtime" });
    expect(gate.actions).toEqual({});
  });

  it("leaves types the game has and coilbox does not out of the gate", () => {
    const installed = marker(
      2,
      [...Object.keys(CONDITION_TYPES), "sf_weather"],
      Object.keys(ACTION_TYPES),
    );
    const gate = paletteGate({ installed, available: coilbox(1) });
    expect(gatedCount(gate)).toBe(0);
    expect(gate.conditions.sf_weather).toBeUndefined();
  });

  it("passes a type the game declares and coilbox's marker does not", () => {
    const installed = coilbox(1);
    const available = marker(1, ["var"], ["victory"]);
    const gate = paletteGate({ installed, available });
    expect(gatedCount(gate)).toBe(0);
  });

  it("stops nothing when there is no target runtime to measure", () => {
    expect(paletteGate({ installed: null, available: coilbox() })).toEqual({
      conditions: {},
      actions: {},
    });
  });

  it("greys every type when the target declares none of them", () => {
    const gate = paletteGate({
      installed: marker(1, [], []),
      available: coilbox(2),
    });
    expect(gatedCount(gate)).toBe(
      Object.keys(CONDITION_TYPES).length + Object.keys(ACTION_TYPES).length,
    );
    expect(gate.conditions.var).toBe("Needs runtime 2");
  });
});
