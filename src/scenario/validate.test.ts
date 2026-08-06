import { describe, expect, it, vi } from "vitest";

const readMissionMock = vi.fn();

// validate.ts reaches the plugin through bindings.ts, whose plugin-sdk import
// Vitest's node resolver cannot load from the published dist. Stubbed the way
// storage.test.ts stubs it.
vi.mock("./bindings", () => ({
  scenarioReadMission: (...args: unknown[]) => readMissionMock(...args),
}));

import {
  describeIssue,
  issueLocation,
  validateCompiledMission,
  validateMission,
} from "./validate";

/**
 * These fixtures are *evaluated* missions, in the shape
 * `scenario_read_mission` hands back: registries as arrays, `teams` and `vars`
 * as maps keyed by author data. That shape is pinned against real emitter
 * output by `crates/coilbox-springlua/tests/eval.rs`, which evaluates a
 * `compileScenario` result and asserts these same names.
 */
function mission(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    runtimeVersion: 1,
    id: "demo",
    name: "Demo",
    teams: { player: { team: 0 }, "Enemy-1": { team: 1 } },
    zones: [{ id: "gate", name: "Gate", shape: "box" }],
    actors: [{ id: "boss", unitDef: "armcom", team: "Enemy-1" }],
    groups: [
      {
        id: "wave1",
        team: "Enemy-1",
        orders: [{ kind: "guard", target: "boss" }],
      },
    ],
    prefabs: [{ id: "base", team: "player" }],
    vars: { Alarm: 0 },
    objectives: [{ id: "kill-boss", kind: "primary" }],
    dialogue: [{ id: "intro", speaker: "HQ" }],
    triggers: [],
    ...overrides,
  };
}

/** A mission with one trigger, `open`. */
function withTrigger(conditions: unknown[], actions: unknown[]) {
  return mission({
    triggers: [
      {
        id: "open",
        enabled: true,
        repeat: false,
        conditions: { op: "all", conditions },
        actions,
      },
    ],
  });
}

/** That trigger carrying one step, as a condition or as an action. */
const withStep = (step: unknown, kind: "conditions" | "actions" = "actions") =>
  kind === "conditions" ? withTrigger([step], []) : withTrigger([], [step]);

describe("validateMission", () => {
  it("passes a mission whose references all resolve", () => {
    const full = withTrigger(
      [
        { type: "units_in_zone", params: { zone: "gate", team: "player" } },
        { type: "var", params: { name: "Alarm", op: "eq", value: 0 } },
      ],
      [
        { type: "spawn_group", params: { group: "wave1" } },
        { type: "dialogue", params: { line: "intro" } },
        { type: "complete_objective", params: { objective: "kill-boss" } },
        { type: "disable_trigger", params: { trigger: "open" } },
        { type: "set_var", params: { name: "Alarm", value: 1 } },
        {
          type: "give_orders",
          params: {
            group: "wave1",
            orders: [{ kind: "attack", target: "boss" }],
          },
        },
        { type: "victory", params: {} },
      ],
    );

    expect(validateMission(full)).toEqual([]);
  });

  it("reports a typo in every kind of reference", () => {
    const cases: [string, unknown][] = [
      ["zone", { type: "reveal_area", params: { zone: "gatee" } }],
      ["actor or building", { type: "unit_dead", params: { actor: "bosss" } }],
      ["group", { type: "spawn_group", params: { group: "wave2" } }],
      ["trigger", { type: "enable_trigger", params: { trigger: "shut" } }],
      [
        "objective",
        { type: "fail_objective", params: { objective: "kill-bos" } },
      ],
      ["dialogue line", { type: "dialogue", params: { line: "outro" } }],
      ["team", { type: "gift_units", params: { group: "wave1", team: "p9" } }],
      ["variable", { type: "add_var", params: { name: "alarm", value: 1 } }],
    ];

    for (const [noun, step] of cases) {
      const kind = noun === "actor or building" ? "conditions" : "actions";
      const issues = validateMission(withStep(step, kind));
      expect(issues, noun).toHaveLength(1);
      expect(issues[0].message).toMatch(new RegExp(`^no ${noun} called `));
      expect(issues[0].path).toContain('triggers["open"]');
    }
  });

  /**
   * Issue #878. A named prefab building answers to the runtime's `units` table
   * the way an actor does, so it resolves against the same kind.
   */
  describe("a prefab building the scenario named", () => {
    const base = (buildings: unknown[]) => ({
      ...withStep(
        { type: "unit_dead", params: { actor: "keep-lab" } },
        "conditions",
      ),
      prefabs: [{ id: "keep", team: "player", buildings }],
    });

    it("resolves a trigger that names it", () => {
      expect(
        validateMission(base([{ id: "keep-lab", def: "corlab" }])),
      ).toEqual([]);
    });

    it("is not resolved when the building carries no id", () => {
      expect(validateMission(base([{ def: "corlab" }]))).toEqual([
        {
          path: 'triggers["open"].conditions[0].params.actor',
          message: 'no actor or building called "keep-lab"',
        },
      ]);
    });

    it("reports an id an actor or another building already answers to", () => {
      const issues = validateMission(
        base([
          { id: "keep-lab", def: "corlab" },
          { id: "keep-lab", def: "cormex" },
          { id: "boss", def: "corllt" },
        ]),
      );

      expect(issues.map((i) => i.path)).toEqual([
        'prefabs["keep"].buildings[1].id',
        'prefabs["keep"].buildings[2].id',
      ]);
      expect(issues[0].message).toContain("already names an actor");
    });
  });

  it("names the parameter that holds the unresolved id", () => {
    const issues = validateMission(
      withStep({ type: "spawn_group", params: { group: "wave2" } }),
    );

    expect(issues[0].path).toBe('triggers["open"].actions[0].params.group');
    expect(issues[0].message).toBe('no group called "wave2"');
  });

  it("reports every unresolved reference, not just the first", () => {
    const issues = validateMission(
      mission({
        actors: [{ id: "boss", team: "nobody" }],
        triggers: [
          {
            id: "open",
            conditions: {
              op: "all",
              conditions: [{ type: "unit_dead", params: { actor: "ghost" } }],
            },
            actions: [
              { type: "spawn_group", params: { group: "wave2" } },
              { type: "dialogue", params: { line: "outro" } },
            ],
          },
        ],
      }),
    );

    expect(issues.map((i) => i.message)).toEqual([
      'no team called "nobody"',
      'no actor or building called "ghost"',
      'no group called "wave2"',
      'no dialogue line called "outro"',
    ]);
  });

  it("flags a team the launcher gave no engine team number", () => {
    const issues = validateMission(
      mission({
        teams: { player: { team: 0 }, "Enemy-1": { team: 1 }, ghost: {} },
      }),
    );

    expect(issues).toHaveLength(1);
    expect(issues[0].path).toBe('teams["ghost"]');
    expect(issues[0].message).toContain("has no engine team");
  });

  it("flags a required reference the compiled file does not carry", () => {
    const issues = validateMission(
      withStep({ type: "complete_objective", params: {} }),
    );

    expect(issues).toEqual([
      {
        path: 'triggers["open"].actions[0].params.objective',
        message: "no objective given",
      },
    ]);
  });

  it("leaves an absent optional reference alone", () => {
    const issues = validateMission(
      withStep({ type: "reveal_area", params: { zone: "gate" } }),
    );

    expect(issues).toEqual([]);
  });

  it("resolves an order target against actors and groups alike", () => {
    const issues = validateMission(
      mission({
        groups: [
          {
            id: "wave1",
            team: "player",
            orders: [
              { kind: "guard", target: "wave1" },
              { kind: "attack", target: "nobody" },
              { kind: "move", waypoints: [] },
            ],
          },
        ],
      }),
    );

    expect(issues).toEqual([
      {
        path: 'groups["wave1"].orders[1].target',
        message: 'nothing called "nobody" for an order to aim at',
      },
    ]);
  });

  it("leaves a game extension's parameters to the game", () => {
    const issues = validateMission(
      withStep({
        type: "sf_weather",
        params: { zone: "gatee", kind: "storm" },
      }),
    );

    expect(issues).toEqual([]);
  });

  it("says so when the file returned no table", () => {
    expect(validateMission(undefined)).toEqual([
      { path: "mission", message: "the compiled mission returned no table" },
    ]);
  });
});

/**
 * Issue #879. `CUnit::PreInit` clamps an off-map creation into bounds rather
 * than refusing it, so a mission authored around a centre origin plays as a heap
 * on the corner with nothing said. The near edge is checkable without knowing
 * anything about the map. The far edge needs its size, which the caller supplies
 * when it has an engine to read one with.
 */
describe("a coordinate that is not on the map", () => {
  const at = (x: number, z: number) =>
    mission({
      actors: [
        { id: "boss", unitDef: "armcom", team: "player", pos: { x, z } },
      ],
    });

  it("reports a negative coordinate without needing the map's size", () => {
    expect(validateMission(at(-512, 300))).toEqual([
      {
        path: 'actors["boss"].pos',
        message:
          "-512,300 is off the map. Spring measures a map from its north-west corner, so x and z start at 0.",
      },
    ]);
  });

  it("leaves the map edge alone", () => {
    // The editor's own clampToMap puts an overshooting drag on exactly zero, so
    // refusing it here would refuse an ordinary edit.
    expect(validateMission(at(0, 0), { width: 8192, height: 8192 })).toEqual(
      [],
    );
    expect(
      validateMission(at(8192, 8192), { width: 8192, height: 8192 }),
    ).toEqual([]);
  });

  it("reports a coordinate past the far edge only when the map's size is known", () => {
    expect(validateMission(at(9000, 300))).toEqual([]);
    expect(
      validateMission(at(9000, 300), { width: 8192, height: 8192 }),
    ).toEqual([
      {
        path: 'actors["boss"].pos',
        message: "9000,300 is off the map, which is 8192 by 8192 elmos.",
      },
    ]);
  });

  it("finds a position wherever it sits in the file", () => {
    const doc = mission({
      groups: [
        {
          id: "wave1",
          team: "player",
          pos: { x: 100, z: 100 },
          orders: [{ kind: "move", waypoints: [{ x: 100, z: -1 }] }],
        },
      ],
      zones: [{ id: "gate", name: "Gate", shape: "box", min: { x: -8, z: 0 } }],
      triggers: [
        {
          id: "open",
          enabled: true,
          repeat: false,
          conditions: { op: "all", conditions: [] },
          actions: [
            {
              type: "spawn_unit",
              params: {
                unitDef: "armpw",
                team: "player",
                pos: { x: 5, z: -5 },
              },
            },
          ],
        },
      ],
    });

    // The zone is left out on purpose: it is an area rather than a placement,
    // and the editor's own atLeastMinimum puts a small one drawn against the
    // edge a few elmos past it.
    expect(validateMission(doc).map((i) => i.path)).toEqual([
      'groups["wave1"].orders[0].waypoints[0]',
      'triggers["open"].actions[0].params.pos',
    ]);
  });

  it("measures a prefab building from its prefab's origin", () => {
    // An offset is free to point north or west of the origin. Only where it
    // lands is on or off the map.
    const doc = (originX: number) =>
      mission({
        prefabs: [
          {
            id: "base",
            team: "player",
            origin: { x: originX, z: 500 },
            buildings: [{ def: "armsolar", offset: { x: -200, z: 0 } }],
          },
        ],
      });

    expect(validateMission(doc(500))).toEqual([]);
    expect(validateMission(doc(100))).toEqual([
      {
        path: 'prefabs["base"].buildings[0].offset',
        message:
          "-100,500 is off the map. Spring measures a map from its north-west corner, so x and z start at 0.",
      },
    ]);
  });

  it("says where an off-map position is in the author's words", () => {
    expect(
      describeIssue({
        path: 'groups["wave1"].orders[0].waypoints[2]',
        message: "-1,-1 is off the map.",
      }),
    ).toBe('Group "wave1", order 1, waypoint 3: -1,-1 is off the map.');
  });
});

describe("validateCompiledMission", () => {
  it("reads the mission back from the archive it was written into", async () => {
    readMissionMock.mockResolvedValue({ mission: mission() });

    expect(await validateCompiledMission("/games/test.sdd", "demo")).toEqual(
      [],
    );
    expect(readMissionMock).toHaveBeenCalledWith({
      root: "/games/test.sdd",
      path: "missions/demo/mission.lua",
    });
  });

  it("turns a file that will not load into an issue like any other", async () => {
    readMissionMock.mockRejectedValue(new Error("unexpected symbol near '}'"));

    expect(await validateCompiledMission("/games/test.sdd", "demo")).toEqual([
      {
        path: "missions/demo/mission.lua",
        message: "unexpected symbol near '}'",
      },
    ]);
  });
});

describe("issueLocation", () => {
  it("names a registry entry by the id the author gave it", () => {
    expect(issueLocation('actors["boss"].team')).toBe('Actor "boss", team');
  });

  it("counts a step from one, the way the trigger panel lists them", () => {
    expect(issueLocation('triggers["open"].actions[0].params.group')).toBe(
      'Trigger "open", action 1, group',
    );
    expect(issueLocation('triggers["open"].conditions[2].params.zone')).toBe(
      'Trigger "open", condition 3, zone',
    );
  });

  it("counts an entry that has no id by position too", () => {
    expect(issueLocation("actors[0].team")).toBe("Actor 1, team");
  });

  it("keeps an order's target under the step it was given on", () => {
    expect(
      issueLocation('triggers["t"].actions[1].params.orders[0].target'),
    ).toBe('Trigger "t", action 2, order 1, target');
    expect(issueLocation('groups["wave"].orders[0].target')).toBe(
      'Group "wave", order 1, target',
    );
  });

  it("says a team by its id, which is the participant's", () => {
    expect(issueLocation('teams["you"]')).toBe('Team "you"');
  });

  it("reads an escaped id back out as the author typed it", () => {
    expect(issueLocation('actors["a \\"b\\""].team')).toBe(
      'Actor "a "b"", team',
    );
  });

  it("has nothing to say about a file name", () => {
    expect(issueLocation("missions/demo/mission.lua")).toBeNull();
  });
});

describe("describeIssue", () => {
  it("leads with where the problem is, then what is wrong", () => {
    expect(
      describeIssue({
        path: 'triggers["open"].actions[0].params.group',
        message: 'no group called "wave"',
      }),
    ).toBe('Trigger "open", action 1, group: no group called "wave"');
  });

  it("falls back to the path when it does not point into the mission", () => {
    expect(
      describeIssue({
        path: "missions/demo/mission.lua",
        message: "unexpected symbol near '}'",
      }),
    ).toBe("missions/demo/mission.lua: unexpected symbol near '}'");
  });
});
