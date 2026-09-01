import { describe, expect, it } from "vitest";
import { newScenario } from "../../create";
import { parseExtensions } from "../../extensions";
import {
  parseScenario,
  type Scenario,
  type ScenarioTrigger,
} from "../../model";
import { ACTION_TYPES, CONDITION_TYPES } from "../../triggerTypes";
import {
  addStep,
  addTrigger,
  applyPoint,
  editTrigger,
  moveStep,
  moveTrigger,
  nextTriggerId,
  paramOrders,
  registryOptions,
  removeStep,
  removeTrigger,
  renameTrigger,
  setStepParam,
  stepAt,
  stepDefaults,
  stepLabel,
  stepTypes,
  triggerSummary,
} from "./triggers";

const trigger = (
  id: string,
  extra: Partial<ScenarioTrigger> = {},
): ScenarioTrigger => ({
  id,
  name: id,
  enabled: true,
  repeat: false,
  conditions: { op: "all", conditions: [] },
  actions: [],
  ...extra,
});

function document(): Scenario {
  return {
    ...newScenario("test"),
    zones: [
      {
        id: "z1",
        name: "Pass",
        shape: "circle",
        center: { x: 0, z: 0 },
        radius: 100,
      },
      {
        id: "z2",
        name: "Pass",
        shape: "box",
        min: { x: 0, z: 0 },
        max: { x: 1, z: 1 },
      },
    ],
    actors: [
      {
        id: "a1",
        unitDef: "armcom",
        team: "p0",
        pos: { x: 0, z: 0 },
        facing: 0,
      },
    ],
    groups: [
      {
        id: "g1",
        team: "p0",
        units: [{ def: "armpw", count: 3 }],
        pos: { x: 0, z: 0 },
        orders: [],
        dormant: false,
      },
    ],
    vars: { alertLevel: 0 },
    triggers: [trigger("open"), trigger("close")],
  };
}

/** A document holding exactly these triggers and nothing else. */
const withTriggers = (...triggers: ScenarioTrigger[]): Scenario => ({
  ...newScenario("t"),
  triggers,
});

describe("nextTriggerId", () => {
  it("numbers past what the list already holds", () => {
    expect(nextTriggerId(withTriggers())).toBe("trigger-1");
    expect(nextTriggerId(withTriggers(trigger("trigger-1")))).toBe("trigger-2");
  });

  it("steps over a number an author has already used", () => {
    expect(
      nextTriggerId(withTriggers(trigger("trigger-2"), trigger("open"))),
    ).toBe("trigger-3");
    expect(
      nextTriggerId(
        withTriggers(
          trigger("trigger-3"),
          trigger("trigger-4"),
          trigger("open"),
        ),
      ),
    ).toBe("trigger-5");
  });

  /**
   * Issue #2250. Deleting a trigger leaves the actions pointing at it alone on
   * purpose, so the validator can report the dangling reference. That only
   * works while the id stays gone: hand it to a new trigger and the stale
   * `enable_trigger` resolves, quietly, to a trigger it was never written for.
   */
  it("never hands a deleted trigger's id to a new trigger", () => {
    const armer = trigger("trigger-1", {
      actions: [{ type: "enable_trigger", params: { trigger: "trigger-2" } }],
    });
    const armed = trigger("trigger-2");

    const after = removeTrigger(withTriggers(armer, armed), "trigger-2");
    const minted = nextTriggerId(after);

    expect(minted).not.toBe("trigger-2");

    const rebuilt = addTrigger(after, minted);
    const pointed = rebuilt.triggers[0].actions[0].params.trigger;
    expect(rebuilt.triggers.some((t) => t.id === pointed)).toBe(false);
  });

  /** The mark survives being written to disk and read back, which is where a
   *  counter held only in memory would lose it. */
  it("keeps a deleted id out of reach across a save", () => {
    const before = withTriggers(trigger("trigger-1"), trigger("trigger-2"));
    const saved = JSON.stringify(removeTrigger(before, "trigger-2"));
    const reloaded = parseScenario(JSON.parse(saved));

    expect(reloaded).not.toBeNull();
    expect(nextTriggerId(reloaded as Scenario)).not.toBe("trigger-2");
  });

  /** Deleting the last one frees nothing either. This is the case the old
   *  minting got wrong most easily, because it started counting at the length
   *  of the list. */
  it("never reuses the id of the trigger most recently deleted", () => {
    const three = withTriggers(
      trigger("trigger-1"),
      trigger("trigger-2"),
      trigger("trigger-3"),
    );
    expect(nextTriggerId(removeTrigger(three, "trigger-3"))).toBe("trigger-4");
  });
});

describe("the trigger list", () => {
  it("adds an armed trigger with nothing in it", () => {
    const s = addTrigger(document(), "new-one");
    expect(s.triggers[2]).toEqual(trigger("new-one"));
  });

  it("removes a trigger and leaves the rest alone", () => {
    const s = removeTrigger(document(), "open");
    expect(s.triggers.map((t) => t.id)).toEqual(["close"]);
  });

  it("hands the same document back for a trigger that is not there", () => {
    const before = document();
    expect(removeTrigger(before, "nope")).toBe(before);
    expect(editTrigger(before, "nope", { repeat: true })).toBe(before);
    expect(moveTrigger(before, "nope", 1)).toBe(before);
  });

  it("keeps a cooldown that is a wait and drops one that is not", () => {
    const set = editTrigger(document(), "open", { repeat: true, cooldown: 30 });
    expect(set.triggers[0].cooldown).toBe(30);

    for (const cooldown of [0, -1, Number.NaN, undefined]) {
      const cleared = editTrigger(set, "open", { cooldown });
      expect("cooldown" in cleared.triggers[0]).toBe(false);
    }
  });

  it("moves a trigger up and down, and not off either end", () => {
    const before = document();
    expect(moveTrigger(before, "close", -1).triggers.map((t) => t.id)).toEqual([
      "close",
      "open",
    ]);
    expect(moveTrigger(before, "open", -1)).toBe(before);
    expect(moveTrigger(before, "close", 1)).toBe(before);
  });
});

describe("renameTrigger", () => {
  const withRefs = () => ({
    ...document(),
    triggers: [
      trigger("open", {
        actions: [
          { type: "enable_trigger", params: { trigger: "close" } },
          { type: "victory", params: {} },
        ],
      }),
      trigger("close", {
        actions: [{ type: "disable_trigger", params: { trigger: "close" } }],
      }),
    ],
  });

  it("changes the name and leaves the id where it was", () => {
    const s = renameTrigger(withRefs(), "close", "The gates shut");

    expect(s.triggers.map((t) => t.id)).toEqual(["open", "close"]);
    expect(s.triggers.map((t) => t.name)).toEqual(["open", "The gates shut"]);
  });

  /** The whole point of issue #2205. Every reference is an id, and the id has
   *  not moved, so there is nothing to carry over and nothing to get wrong. */
  it("leaves every reference to the trigger alone", () => {
    const s = renameTrigger(withRefs(), "close", "The gates shut");

    expect(s.triggers[0].actions[0].params.trigger).toBe("close");
    expect(s.triggers[1].actions[0].params.trigger).toBe("close");
    expect(s.triggers[0].actions[1].params).toEqual({});
  });

  it("refuses a name that is empty or unchanged", () => {
    const before = withRefs();
    expect(renameTrigger(before, "close", "  ")).toBe(before);
    expect(renameTrigger(before, "close", "close")).toBe(before);
    expect(renameTrigger(before, "gone", "shut")).toBe(before);
  });

  /** Nothing resolves a trigger by name, so two of them may read the same. */
  it("allows a name another trigger already has", () => {
    const s = renameTrigger(withRefs(), "close", "open");
    expect(s.triggers.map((t) => t.name)).toEqual(["open", "open"]);
    expect(s.triggers.map((t) => t.id)).toEqual(["open", "close"]);
  });

  it("keeps the document loadable", () => {
    const s = renameTrigger(withRefs(), "close", "The gates shut");
    expect(parseScenario(JSON.parse(JSON.stringify(s)))).not.toBeNull();
  });
});

describe("conditions and actions", () => {
  const ref = { triggerId: "open", list: "actions" as const, index: 0 };

  const withAction = () =>
    addStep(document(), "open", "actions", {
      type: "spawn_group",
      params: { group: "g1" },
    });

  it("adds a step to the list it names", () => {
    const s = addStep(document(), "open", "conditions", {
      type: "time_elapsed",
      params: { seconds: 60 },
    });
    expect(s.triggers[0].conditions.conditions).toHaveLength(1);
    expect(s.triggers[0].actions).toHaveLength(0);
  });

  it("reads and removes the step a ref names", () => {
    const s = withAction();
    expect(stepAt(s, ref)?.type).toBe("spawn_group");
    expect(stepAt(s, { ...ref, index: 4 })).toBeNull();
    expect(removeStep(s, ref).triggers[0].actions).toHaveLength(0);
  });

  it("moves an action within its list", () => {
    const two = addStep(withAction(), "open", "actions", {
      type: "victory",
      params: {},
    });
    const moved = moveStep(two, { ...ref, index: 1 }, -1);
    expect(moved.triggers[0].actions.map((a) => a.type)).toEqual([
      "victory",
      "spawn_group",
    ]);
    expect(moveStep(two, ref, -1)).toBe(two);
  });

  it("sets a parameter and clears an optional one", () => {
    const s = setStepParam(withAction(), ref, "team", "p1");
    expect(stepAt(s, ref)?.params.team).toBe("p1");

    const cleared = setStepParam(s, ref, "team", undefined);
    expect(stepAt(cleared, ref)?.params).toEqual({ group: "g1" });
  });
});

describe("applyPoint", () => {
  const ref = { triggerId: "open", list: "actions" as const, index: 0 };

  const withPan = () =>
    addStep(document(), "open", "actions", {
      type: "camera_pan",
      params: { pos: { x: 0, z: 0 } },
    });

  it("writes a whole-number point into the parameter", () => {
    const s = applyPoint(
      withPan(),
      { ref, param: "pos" },
      { x: 10.4, z: -2.6 },
    );
    expect(stepAt(s, ref)?.params.pos).toEqual({ x: 10, z: -3 });
  });

  it("adds a waypoint to one order of an orders parameter", () => {
    const before = addStep(document(), "open", "actions", {
      type: "give_orders",
      params: {
        group: "g1",
        orders: [
          { kind: "guard", target: "a1" },
          { kind: "patrol", waypoints: [] },
        ],
      },
    });

    const s = applyPoint(
      before,
      { ref, param: "orders", order: 1 },
      { x: 5, z: 5 },
    );
    const orders = paramOrders(stepAt(s, ref)?.params.orders);
    expect(orders[1]).toEqual({ kind: "patrol", waypoints: [{ x: 5, z: 5 }] });

    // An order with no path takes no points, and a target order has none.
    expect(
      applyPoint(before, { ref, param: "orders", order: 0 }, { x: 5, z: 5 }),
    ).toBe(before);
    expect(
      applyPoint(before, { ref, param: "orders", order: 9 }, { x: 5, z: 5 }),
    ).toBe(before);
  });

  it("does nothing once the step it was asked for is gone", () => {
    const before = document();
    expect(applyPoint(before, { ref, param: "pos" }, { x: 1, z: 1 })).toBe(
      before,
    );
  });
});

describe("registryOptions", () => {
  it("numbers zones that share a name, so a picker can tell them apart", () => {
    expect(registryOptions(document(), "zoneId")).toEqual([
      { value: "z1", label: "Pass 1", description: "circle" },
      { value: "z2", label: "Pass 2", description: "box" },
    ]);
  });

  /** Issue #2205. A trigger is offered by the name its author gave it and
   *  stored by the id that never moves, which is what a zone has always done.
   *  Two triggers may share a name, so the same numbering applies. */
  it("offers triggers by name and stores them by id", () => {
    const scenario = {
      ...document(),
      triggers: [
        trigger("open", { name: "The gates" }),
        trigger("close", { name: "The gates" }),
      ],
    };
    expect(registryOptions(scenario, "triggerId")).toMatchObject([
      { value: "open", label: "The gates 1" },
      { value: "close", label: "The gates 2" },
    ]);
  });

  it("names groups by their place and vars by their key", () => {
    expect(registryOptions(document(), "groupId")?.[0]).toMatchObject({
      value: "g1",
      label: "Group 1",
    });
    expect(registryOptions(document(), "varName")?.[0].value).toBe(
      "alertLevel",
    );
  });

  it("has nothing to offer for a kind that is not a reference", () => {
    expect(registryOptions(document(), "number")).toBeNull();
    expect(registryOptions(document(), "point")).toBeNull();
    // An amount is a number or a var, so it is drawn by its own control rather
    // than by the registry dropdown (issue #808).
    expect(registryOptions(document(), "amount")).toBeNull();
  });

  // Issue #878. A trigger that reads an actor reads a named base building the
  // same way, so the picker offers both out of one list.
  it("offers a named base building beside the actors", () => {
    const scenario: Scenario = {
      ...document(),
      blueprints: [
        {
          id: "bp1",
          name: "The keep",
          buildings: [
            { def: "corlab", offset: { x: 0, z: 0 }, facing: 0 },
            { def: "cormex", offset: { x: 64, z: 0 }, facing: 0 },
          ],
        },
      ],
      bases: [
        {
          id: "pf1",
          blueprint: "bp1",
          team: "p0",
          origin: { x: 500, z: 500 },
          buildings: [{ id: "b1" }],
        },
      ],
    };

    expect(registryOptions(scenario, "actorId")).toEqual([
      { value: "a1", label: "armcom", description: "armcom" },
      { value: "b1", label: "The keep's corlab", description: "corlab" },
    ]);
  });
});

describe("stepDefaults", () => {
  const ctx = (scenario: Scenario, unitDefs: string[] = ["armcom"]) => ({
    scenario,
    unitDefs,
  });

  it("fills every required parameter and leaves the optional ones out", () => {
    const got = stepDefaults(CONDITION_TYPES.units_in_zone, ctx(document()));
    expect(got.params).toEqual({ zone: "z1" });
  });

  it("takes the first of each registry, so nothing is typed", () => {
    const got = stepDefaults(ACTION_TYPES.set_var, ctx(document()));
    expect(got.params).toEqual({ name: "alertLevel", value: 0 });
  });

  it("says what a type needs when its registry is empty", () => {
    const bare = { ...document(), zones: [] };
    expect(stepDefaults(CONDITION_TYPES.units_in_zone, ctx(bare)).needs).toBe(
      "Needs a zone",
    );

    const noVars = { ...document(), vars: {} };
    expect(stepDefaults(ACTION_TYPES.set_var, ctx(noVars)).needs).toBe(
      "Needs a variable",
    );
  });

  it("takes a unit type from the game rather than from the document", () => {
    expect(
      stepDefaults(ACTION_TYPES.unlock_unit, ctx(document())).params,
    ).toEqual({ unitDef: "armcom" });
    expect(
      stepDefaults(ACTION_TYPES.unlock_unit, ctx(document(), [])).needs,
    ).toBe("Needs the game's units");
  });

  // Issue #808. An amount takes a number or a var, and opening it on the
  // document's first var would be a comparison the author never asked for.
  it("opens an amount as a plain number", () => {
    expect(stepDefaults(ACTION_TYPES.add_var, ctx(document())).params).toEqual({
      name: "alertLevel",
      value: 0,
    });
  });

  it("starts an enum on its first value", () => {
    expect(stepDefaults(CONDITION_TYPES.var, ctx(document())).params).toEqual({
      name: "alertLevel",
      op: "eq",
      value: 0,
    });
  });

  /**
   * The reason defaults exist at all: `parseScenario` refuses a whole document
   * over one missing required parameter, so every type the picker offers has to
   * produce a step that loads again.
   */
  it("produces a step every type can be saved and read back with", () => {
    const base = document();
    const context = ctx(base);
    for (const [list, table] of [
      ["conditions", CONDITION_TYPES],
      ["actions", ACTION_TYPES],
    ] as const) {
      for (const [type, spec] of Object.entries(table)) {
        const defaults = stepDefaults(spec, context);
        if (!defaults.params) continue;
        const s = addStep(base, "open", list, {
          type,
          params: defaults.params,
        });
        const read = parseScenario(JSON.parse(JSON.stringify(s)));
        expect(read, `${type} does not load again`).not.toBeNull();
      }
    }
  });
});

/**
 * The palette a game's own types join. What is proved here is that they arrive
 * with the same shape a built-in type has, so every other function in this file
 * treats them the same way.
 */
describe("stepTypes with a game's own types", () => {
  const extensions = parseExtensions({
    handler: "luarules/mission_extensions/demo.lua",
    conditions: [
      {
        type: "sf_research_above",
        label: "Research above",
        params: [
          { name: "team", kind: "teamId" },
          { name: "amount", kind: "number" },
        ],
      },
    ],
    actions: [{ type: "sf_grant_research", params: [] }],
  });

  it("offers coilbox's types and the game's in one table", () => {
    const conditions = stepTypes("conditions", extensions);
    expect(conditions.time_elapsed).toBe(CONDITION_TYPES.time_elapsed);
    expect(conditions.sf_research_above).toEqual({
      team: { kind: "teamId" },
      amount: { kind: "number" },
    });
    expect(stepTypes("actions", extensions).sf_grant_research).toEqual({});
  });

  it("keeps the two lists apart", () => {
    expect(stepTypes("actions", extensions).sf_research_above).toBeUndefined();
  });

  it("is coilbox's table untouched for a game that declares nothing", () => {
    expect(stepTypes("conditions")).toBe(CONDITION_TYPES);
    expect(stepTypes("actions")).toBe(ACTION_TYPES);
  });

  it("fills a declared type's parameters in like any other", () => {
    const scenario = document();
    const spec = stepTypes("conditions", extensions).sf_research_above;
    expect(stepDefaults(spec, { scenario, unitDefs: [] })).toEqual({
      params: { team: scenario.setup.participants[0].id, amount: 0 },
    });
  });

  it("calls a declared type what its declaration calls it", () => {
    expect(stepLabel("sf_research_above", extensions)).toBe("Research above");
    expect(stepLabel("time_elapsed", extensions)).toBe("Time elapsed");
  });

  /**
   * A game's own trigger reference used to need carrying over on every rename,
   * and only the extension table said it was a reference at all, so a rename
   * made with the table missing quietly broke it. Since issue #2205 it points at
   * an id nothing moves, so it survives a rename without anyone having to know
   * it is there.
   */
  it("leaves a reference a declared type holds alone when a trigger is renamed", () => {
    const declared = parseExtensions({
      handler: "h.lua",
      actions: [
        {
          type: "sf_arm",
          params: [{ name: "which", kind: "triggerId" }],
        },
      ],
    });
    expect(declared.actions.sf_arm.spec.which.kind).toBe("triggerId");

    const base = addStep(document(), "open", "actions", {
      type: "sf_arm",
      params: { which: "open" },
    });

    const renamed = renameTrigger(base, "open", "The gates open");

    expect(renamed.triggers[0].actions[0].params.which).toBe("open");
  });
});

describe("labels", () => {
  it("reads a type name as a sentence", () => {
    expect(stepLabel("units_in_zone")).toBe("Units in zone");
    expect(stepLabel("sf_weather")).toBe("Sf weather");
  });

  it("says what a trigger holds", () => {
    expect(triggerSummary(trigger("t"))).toBe("always · 0 actions");
    expect(
      triggerSummary(
        trigger("t", {
          conditions: {
            op: "any",
            conditions: [
              { type: "time_elapsed", params: { seconds: 1 } },
              { type: "time_elapsed", params: { seconds: 2 } },
            ],
          },
          actions: [{ type: "victory", params: {} }],
        }),
      ),
    ).toBe("any of 2 conditions · 1 action");
  });
});
