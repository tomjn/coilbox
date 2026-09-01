import { describe, expect, it, vi } from "vitest";

const readMissionMock = vi.fn();
const evalMissionMock = vi.fn();

// validate.ts reaches the plugin through bindings.ts, whose plugin-sdk import
// Vitest's node resolver cannot load from the published dist. Stubbed the way
// storage.test.ts stubs it.
vi.mock("./bindings", () => ({
  scenarioReadMission: (...args: unknown[]) => readMissionMock(...args),
  scenarioEvalMission: (...args: unknown[]) => evalMissionMock(...args),
}));

import { newScenario, starterScenario } from "./create";
import type { Scenario } from "./model";
import {
  defsMissingFrom,
  describeIssue,
  isBlocking,
  issueLocation,
  missionIssueLabels,
  unitDefsIn,
  validateCompiledMission,
  validateCompiledMissionText,
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
    objectives: [{ id: "kill-boss", kind: "primary", text: "Kill the boss." }],
    dialogue: [{ id: "intro", speaker: "HQ", text: "Move out." }],
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

  /**
   * Issue #808. An amount is a number or the var to read one out of, and a var
   * it names resolves against the same registry a `varName` parameter does.
   */
  describe("an amount", () => {
    const withAmount = (value: unknown) =>
      withStep({ type: "add_var", params: { name: "Alarm", value } });

    it("passes a written number and a var the mission declares", () => {
      expect(validateMission(withAmount(5))).toEqual([]);
      expect(validateMission(withAmount({ var: "Alarm" }))).toEqual([]);
    });

    it("reports a var the mission never declared, at the name", () => {
      expect(validateMission(withAmount({ var: "Alrm" }))).toEqual([
        {
          path: 'triggers["open"].actions[0].params.value.var',
          message: 'no variable called "Alrm"',
        },
      ]);
    });

    it("reports a value that is neither a number nor a var", () => {
      expect(validateMission(withAmount("5"))).toEqual([
        {
          path: 'triggers["open"].actions[0].params.value',
          message: "no number or variable given",
        },
      ]);
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

  /**
   * Issue #908. A def the game does not have spawns nothing and says nothing,
   * which is the silence this whole step exists to break, so it is an error
   * rather than a warning. The game's unit list is a unitsync read, so it is
   * passed in, and a caller with no engine to ask still gets every other check.
   */
  /** Issue #2164. */
  describe("a difficulty range", () => {
    const ranged = (difficulty: unknown) =>
      validateMission(
        mission({
          actors: [
            { id: "boss", unitDef: "armcom", team: "Enemy-1", difficulty },
          ],
        }),
      );

    it("passes when it can be satisfied, at either end or both", () => {
      for (const range of [
        { atLeast: "hard" },
        { atMost: "easy" },
        { atLeast: "easy", atMost: "hard" },
        { atLeast: "normal", atMost: "normal" },
        undefined,
      ]) {
        expect(ranged(range), JSON.stringify(range)).toEqual([]);
      }
    });

    it("warns about one that crosses itself and can never apply", () => {
      const issues = ranged({ atLeast: "hard", atMost: "easy" });

      expect(issues).toHaveLength(1);
      expect(issues[0].severity).toBe("warning");
      expect(issues[0].path).toBe('actors["boss"].difficulty');
      expect(issues[0].message).toContain("never appears");
    });

    it("says the same about a group, a base and a trigger", () => {
      const crossed = { atLeast: "hard", atMost: "easy" };
      const issues = validateMission(
        mission({
          groups: [{ id: "wave1", team: "Enemy-1", difficulty: crossed }],
          prefabs: [{ id: "base", team: "player", difficulty: crossed }],
          triggers: [
            {
              id: "open",
              conditions: { op: "all", conditions: [] },
              actions: [],
              difficulty: crossed,
            },
          ],
        }),
      );

      expect(issues.map((i) => i.path)).toEqual([
        'groups["wave1"].difficulty',
        'prefabs["base"].difficulty',
        'triggers["open"].difficulty',
      ]);
    });
  });

  describe("a unit type the game does not have", () => {
    const units = [{ name: "armcom" }, { name: "armpw" }, { name: "ARMSOLAR" }];

    /** A def in every place the compiled file can hold one, half of them typos. */
    const everywhere = () =>
      mission({
        game: "Balanced Annihilation",
        teams: {
          player: { team: 0, startUnits: ["armpw", "armcomm"] },
          "Enemy-1": { team: 1 },
        },
        groups: [
          {
            id: "wave1",
            team: "Enemy-1",
            units: [
              { def: "armpw", count: 2 },
              { def: "armflashh", count: 1 },
            ],
            orders: [],
          },
        ],
        prefabs: [
          {
            id: "base",
            team: "player",
            buildings: [{ def: "armsolar", queue: ["armpw", "armzeuss"] }],
          },
        ],
        triggers: [
          {
            id: "open",
            enabled: true,
            repeat: false,
            conditions: {
              op: "all",
              conditions: [
                {
                  type: "units_in_zone",
                  params: { zone: "gate", unitDefs: ["armpw", "armbad"] },
                },
              ],
            },
            actions: [{ type: "unlock_unit", params: { unitDef: "armlabb" } }],
          },
        ],
      });

    it("validates clean without a unit list, and is refused with one", () => {
      expect(validateMission(everywhere())).toEqual([]);

      const issues = validateMission(everywhere(), undefined, units);

      expect(issues.map((i) => i.path)).toEqual([
        'teams["player"].startUnits[1]',
        'groups["wave1"].units[1].def',
        'prefabs["base"].buildings[0].queue[1]',
        'triggers["open"].conditions[0].params.unitDefs[1]',
        'triggers["open"].actions[0].params.unitDef',
      ]);
      expect(issues.every(isBlocking)).toBe(true);
    });

    it("names the def and the game it is not in", () => {
      const issues = validateMission(
        mission({
          game: "Balanced Annihilation",
          actors: [{ id: "boss", unitDef: "armcomm", team: "Enemy-1" }],
          groups: [],
        }),
        undefined,
        units,
      );

      expect(issues).toEqual([
        {
          path: 'actors["boss"].unitDef',
          message: 'no unit type called "armcomm" in Balanced Annihilation',
        },
      ]);
      expect(describeIssue(issues[0])).toBe(
        'Actor "boss", unitDef: no unit type called "armcomm" in Balanced Annihilation',
      );
    });

    it("resolves a def however the author cased it", () => {
      expect(
        validateMission(
          mission({
            actors: [{ id: "boss", unitDef: "ArmSolar", team: "player" }],
          }),
          undefined,
          units,
        ),
      ).toEqual([]);
    });

    it("leaves a game extension's defs to the game", () => {
      expect(
        validateMission(
          withStep({ type: "sf_drop", params: { unitDef: "sf_nothing" } }),
          undefined,
          units,
        ),
      ).toEqual([]);
    });

    /**
     * A read that came back with nothing is a real state: a game whose unitsync
     * read failed answers with an empty list, and every def in the mission would
     * otherwise be reported as missing. It is said rather than passed over.
     */
    it("says it could not check rather than checking against nothing", () => {
      const issues = validateMission(
        mission({
          game: "Balanced Annihilation",
          actors: [{ id: "boss", unitDef: "armcom", team: "player" }],
          groups: [],
        }),
        undefined,
        [],
      );

      expect(issues).toEqual([
        {
          path: "mission",
          message:
            "coilbox could not read Balanced Annihilation's units, so the 1 unit type this mission names was not checked against it.",
          severity: "warning",
        },
      ]);
    });

    it("has nothing to say about a mission that names no unit type", () => {
      expect(
        validateMission(
          mission({ actors: [], groups: [], prefabs: [], teams: {} }),
          undefined,
          [],
        ),
      ).toEqual([]);
    });
  });

  describe("defsMissingFrom", () => {
    it("names the defs a game does not have, case insensitively", () => {
      expect(
        defsMissingFrom(
          ["armcom", "CORCOM", "corak"],
          [{ name: "ARMCOM" }, { name: "corcom" }],
        ),
      ).toEqual(["corak"]);
    });
  });

  /**
   * Issue #940. The setup panel's "changing the game" notice runs this same
   * walk over the document the author is editing, so the two cannot disagree
   * about whether the new game has everything the mission needs. A factory's
   * build queue and a trigger parameter naming a def are the two places the
   * notice used to miss.
   */
  describe("the document the setup panel reads", () => {
    it("finds a def wherever the document holds one", () => {
      const document: Scenario = {
        ...newScenario("Demo"),
        teams: { player: { startUnits: ["armpw"] } },
        actors: [
          {
            id: "boss",
            unitDef: "armcom",
            team: "player",
            pos: { x: 1, z: 1 },
            facing: 0,
          },
        ],
        blueprints: [
          {
            id: "keep",
            name: "The keep",
            buildings: [{ def: "armlab", offset: { x: 0, z: 0 }, facing: 0 }],
          },
        ],
        bases: [
          {
            id: "base",
            blueprint: "keep",
            team: "player",
            origin: { x: 2, z: 2 },
            buildings: [{ queue: ["armflash"] }],
          },
        ],
        triggers: [
          {
            id: "open",
            name: "open",
            enabled: true,
            repeat: false,
            conditions: { op: "all", conditions: [] },
            actions: [{ type: "unlock_unit", params: { unitDef: "armzeus" } }],
          },
        ],
      };

      expect(unitDefsIn(document)).toEqual([
        { path: 'teams["player"].startUnits[0]', def: "armpw" },
        { path: 'actors["boss"].unitDef', def: "armcom" },
        { path: 'blueprints["keep"].buildings[0].def', def: "armlab" },
        { path: 'bases["base"].buildings[0].queue[0]', def: "armflash" },
        { path: 'triggers["open"].actions[0].params.unitDef', def: "armzeus" },
      ]);
    });
  });

  /**
   * Issue #853. A blank objective reaches the player's panel as an empty line
   * and a blank dialogue line opens the radio panel on an empty message, so both
   * are said. Neither stops the mission working, so neither refuses a launch.
   */
  describe("text nobody wrote", () => {
    it("warns about an objective with no text", () => {
      const issues = validateMission(
        mission({
          objectives: [{ id: "kill-boss", kind: "primary", text: "" }],
        }),
      );

      expect(issues).toEqual([
        {
          path: 'objectives["kill-boss"].text',
          message: "no text, so the objectives panel shows a blank line",
          severity: "warning",
        },
      ]);
      expect(issues.filter(isBlocking)).toEqual([]);
    });

    it("warns about a dialogue line with no text", () => {
      const issues = validateMission(
        mission({ dialogue: [{ id: "intro", speaker: "HQ", text: "   " }] }),
      );

      expect(issues).toEqual([
        {
          path: 'dialogue["intro"].text',
          message: "no text, so the radio panel opens on an empty message",
          severity: "warning",
        },
      ]);
    });

    it("leaves text that was written alone", () => {
      expect(
        validateMission(
          mission({
            objectives: [
              { id: "kill-boss", kind: "primary", text: "Kill it." },
            ],
            dialogue: [{ id: "intro", speaker: "HQ", text: "Move out." }],
          }),
        ),
      ).toEqual([]);
    });

    it("says where it is in the author's words", () => {
      expect(
        describeIssue({
          path: 'objectives["kill-boss"].text',
          message: "no text, so the objectives panel shows a blank line",
          severity: "warning",
        }),
      ).toBe(
        'Objective "kill-boss", text: no text, so the objectives panel shows a blank line',
      );
    });
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

describe("validateCompiledMissionText", () => {
  it("validates a mission it was handed as text", async () => {
    evalMissionMock.mockResolvedValue({ mission: mission() });

    expect(await validateCompiledMissionText("return { actors = {} }")).toEqual(
      [],
    );
    expect(evalMissionMock).toHaveBeenCalledWith({
      source: "return { actors = {} }",
    });
  });

  it("turns text that will not evaluate into an issue like any other", async () => {
    evalMissionMock.mockRejectedValue(new Error("unexpected symbol near '}'"));

    expect(await validateCompiledMissionText("return {")).toEqual([
      { path: "mission.lua", message: "unexpected symbol near '}'" },
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

  it("puts the author's own name in front of the id (issue #2249)", () => {
    expect(
      describeIssue(
        {
          path: 'triggers["trigger-3"].actions[0].params.zone',
          message: 'no zone called "zone-a"',
        },
        { triggers: { "trigger-3": "The gates open" } },
      ),
    ).toBe(
      'Trigger "The gates open" (trigger-3), action 1, zone: no zone called "zone-a"',
    );
  });
});

/**
 * Issue #2249. A problem is located by the path out of the compiled mission, so
 * it names a zone or a trigger by the id in the file. Since #2205 minted a
 * trigger an id of its own, that id can be a string the author has never seen:
 * a trigger they called "The gates open" was reported as `Trigger "trigger-3"`.
 * A zone was always worse, because a zone id is a UUID.
 *
 * So a message names both. The label is what the author reads in the panel, and
 * the id is what `mission.lua` carries and what the panel keeps beside the row
 * (issue #2248), so the sentence can be matched to either. It is also the only
 * thing that tells two zones called "north" apart, because a label is not
 * unique and is not meant to be.
 */
describe("naming what an author called a thing", () => {
  const labels = {
    zones: { "3f2a8c1e": "The pass" },
    triggers: { "trigger-3": "The gates open" },
    groups: {},
  };

  it("leads with the label and keeps the id in brackets", () => {
    expect(issueLocation('zones["3f2a8c1e"].name', labels)).toBe(
      'Zone "The pass" (3f2a8c1e), name',
    );
  });

  it("names a renamed trigger the way its row in the list does", () => {
    expect(
      issueLocation('triggers["trigger-3"].conditions[1].params.zone', labels),
    ).toBe('Trigger "The gates open" (trigger-3), condition 2, zone');
  });

  it("tells two things called the same thing apart by their ids", () => {
    const two = { zones: { "zone-a": "north", "zone-b": "north" } };
    expect(issueLocation('zones["zone-a"]', two)).toBe('Zone "north" (zone-a)');
    expect(issueLocation('zones["zone-b"]', two)).toBe('Zone "north" (zone-b)');
  });

  it("says the id alone for a kind that has no label of its own", () => {
    expect(issueLocation('groups["wave"].orders[0].target', labels)).toBe(
      'Group "wave", order 1, target',
    );
  });

  it("says the id alone when the author has not named it yet", () => {
    expect(
      issueLocation('objectives["objective-2"].text', { objectives: {} }),
    ).toBe('Objective "objective-2", text');
  });

  it("does not say the id twice when the name is the id", () => {
    expect(
      issueLocation('triggers["open"]', { triggers: { open: "open" } }),
    ).toBe('Trigger "open"');
  });

  it("says exactly what it always said when nothing was looked up", () => {
    expect(issueLocation('zones["3f2a8c1e"].name')).toBe(
      'Zone "3f2a8c1e", name',
    );
  });
});

describe("missionIssueLabels", () => {
  /** A document with one of everything an id can be labelled from. */
  function labelled(): Scenario {
    const scenario = newScenario("Demo");
    return {
      ...scenario,
      zones: [
        {
          id: "3f2a8c1e",
          name: "  The pass  ",
          shape: "circle",
          center: { x: 0, z: 0 },
          radius: 100,
        },
      ],
      actors: [
        {
          id: "a1",
          unitDef: "armcom",
          team: "p0",
          pos: { x: 0, z: 0 },
          facing: 0,
          state: { name: "Kane" },
        },
        {
          id: "a2",
          unitDef: "armcom",
          team: "p0",
          pos: { x: 0, z: 0 },
          facing: 0,
        },
      ],
      blueprints: [
        {
          id: "bp1",
          name: "The keep",
          buildings: [],
        },
      ],
      bases: [
        {
          id: "base-uuid",
          blueprint: "bp1",
          team: "p0",
          origin: { x: 0, z: 0 },
          buildings: [],
        },
      ],
      triggers: [
        {
          id: "trigger-3",
          name: "The gates open",
          enabled: true,
          repeat: false,
          conditions: { op: "all", conditions: [] },
          actions: [],
        },
      ],
      objectives: [
        {
          id: "objective-1",
          kind: "primary",
          text: "Hold out.",
          hidden: false,
        },
        { id: "objective-2", kind: "primary", text: "   ", hidden: false },
      ],
      dialogue: [{ id: "line-1", speaker: "Control", text: "Contact." }],
    };
  }

  it("reads a label out of every registry that carries one", () => {
    const labels = missionIssueLabels(labelled());

    expect(labels.zones["3f2a8c1e"]).toBe("The pass");
    expect(labels.triggers["trigger-3"]).toBe("The gates open");
    expect(labels.objectives["objective-1"]).toBe("Hold out.");
    expect(labels.dialogue["line-1"]).toBe("Control");
    expect(labels.actors.a1).toBe("Kane");
    // A base is labelled by the layout it places, the way the contents list
    // reads one, because its own id is a minted UUID.
    expect(labels.prefabs["base-uuid"]).toBe("The keep");
  });

  it("names a team by the participant's name rather than the slot id", () => {
    const scenario = newScenario("Demo");
    const [you] = scenario.setup.participants;

    expect(missionIssueLabels(scenario).teams[you.id]).toBe(you.name);
    expect(you.name).not.toBe(you.id);
  });

  it("leaves out a label that is blank, so the id answers instead", () => {
    const labels = missionIssueLabels(labelled());

    expect("objective-2" in labels.objectives).toBe(false);
    expect("a2" in labels.actors).toBe(false);
  });

  it("puts a real document's names in front of a real problem", () => {
    const scenario = starterScenario("Demo");
    const issue = {
      path: 'triggers["briefing"].actions[0].params.line',
      message: 'no dialogue line called "gone"',
    };

    expect(describeIssue(issue, missionIssueLabels(scenario))).toBe(
      'Trigger "Command calls in" (briefing), action 1, line: no dialogue line called "gone"',
    );
  });
});
