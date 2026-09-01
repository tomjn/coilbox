import { describe, expect, it } from "vitest";
import {
  baseBuildings,
  DIFFICULTIES,
  type DifficultyRange,
  difficultyApplies,
  parseScenario,
  parseScenarioJson,
  usesDifficulty,
} from "./model";

/** A minimal valid scenario document, with extra top-level fields spread in. */
function doc(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "s1",
    name: "Test scenario",
    setup: { gameName: "BAR", mapName: "Comet Catcher" },
    ...extra,
  };
}

const zone = {
  id: "z1",
  name: "Landing site",
  shape: "box",
  min: { x: 0, z: 0 },
  max: { x: 100, z: 100 },
};

describe("parseScenarioJson", () => {
  it("rejects text that is not JSON", () => {
    expect(parseScenarioJson("{ not json")).toBeNull();
  });

  it("rejects JSON that is not an object", () => {
    expect(parseScenarioJson("[]")).toBeNull();
    expect(parseScenarioJson("null")).toBeNull();
    expect(parseScenarioJson('"a scenario"')).toBeNull();
  });

  it("parses a minimal document and defaults every registry", () => {
    const s = parseScenarioJson(JSON.stringify(doc()));
    expect(s).not.toBeNull();
    expect(s?.schemaVersion).toBe(2);
    expect(s?.runtimeVersion).toBe(1);
    expect(s?.description).toBe("");
    expect(s?.zones).toEqual([]);
    expect(s?.actors).toEqual([]);
    expect(s?.groups).toEqual([]);
    expect(s?.blueprints).toEqual([]);
    expect(s?.bases).toEqual([]);
    expect(s?.triggers).toEqual([]);
    expect(s?.objectives).toEqual([]);
    expect(s?.dialogue).toEqual([]);
    expect(s?.teams).toEqual({});
    expect(s?.vars).toEqual({});
    expect(s?.restrictions).toEqual({});
    expect(s?.script).toBeUndefined();
  });
});

describe("parseScenario — document identity", () => {
  it("rejects a missing or empty id", () => {
    expect(parseScenario({ name: "n", setup: {} })).toBeNull();
    expect(parseScenario(doc({ id: "" }))).toBeNull();
    expect(parseScenario(doc({ id: 7 }))).toBeNull();
  });

  it("rejects a missing name", () => {
    expect(parseScenario({ id: "s1", setup: {} })).toBeNull();
  });

  it("rejects a missing setup, which is the launch payload", () => {
    expect(parseScenario({ id: "s1", name: "n" })).toBeNull();
    expect(parseScenario(doc({ setup: "BAR" }))).toBeNull();
    expect(parseScenario(doc({ setup: [] }))).toBeNull();
  });

  it("keeps script only when it is exactly true", () => {
    expect(parseScenario(doc({ script: true }))?.script).toBe(true);
    expect(parseScenario(doc({ script: "yes" }))?.script).toBeUndefined();
  });
});

describe("parseScenario — zones", () => {
  it("parses box and circle zones", () => {
    const s = parseScenario(
      doc({
        zones: [
          zone,
          { id: "z2", shape: "circle", center: { x: 5, z: 6 }, radius: 20 },
        ],
      }),
    );
    expect(s?.zones[0]).toEqual({
      id: "z1",
      name: "Landing site",
      shape: "box",
      min: { x: 0, z: 0 },
      max: { x: 100, z: 100 },
    });
    // A nameless zone falls back to its id so the editor has something to show.
    expect(s?.zones[1]).toEqual({
      id: "z2",
      name: "z2",
      shape: "circle",
      center: { x: 5, z: 6 },
      radius: 20,
    });
  });

  it("rejects an unknown shape", () => {
    expect(parseScenario(doc({ zones: [{ id: "z1", shape: "blob" }] }))).toBe(
      null,
    );
  });

  it("rejects a box missing a corner, or a corner missing an axis", () => {
    expect(
      parseScenario(doc({ zones: [{ ...zone, max: undefined }] })),
    ).toBeNull();
    expect(
      parseScenario(doc({ zones: [{ ...zone, max: { x: 1 } }] })),
    ).toBeNull();
  });

  it("rejects a non-finite coordinate", () => {
    // JSON has no NaN, but a value can still arrive through parseScenario.
    expect(
      parseScenario(doc({ zones: [{ ...zone, min: { x: NaN, z: 0 } }] })),
    ).toBeNull();
  });

  it("rejects duplicate ids", () => {
    expect(parseScenario(doc({ zones: [zone, zone] }))).toBeNull();
  });

  it("rejects a registry that is not an array", () => {
    expect(parseScenario(doc({ zones: { z1: zone } }))).toBeNull();
  });
});

describe("parseScenario — actors", () => {
  const actor = {
    id: "a1",
    unitDef: "armcom",
    team: "p0",
    pos: { x: 10, z: 20 },
  };

  it("parses an actor and defaults its facing", () => {
    const s = parseScenario(doc({ actors: [actor] }));
    expect(s?.actors[0]).toEqual({
      id: "a1",
      unitDef: "armcom",
      team: "p0",
      pos: { x: 10, z: 20 },
      facing: 0,
      state: undefined,
    });
  });

  it("normalises facing to the engine's four values", () => {
    const facings = [0, 3, 4, 7, -1, 2.7, "north"].map(
      (facing) =>
        parseScenario(doc({ actors: [{ ...actor, facing }] }))?.actors[0]
          .facing,
    );
    expect(facings).toEqual([0, 3, 0, 3, 3, 2, 0]);
  });

  it("keeps only known state keys and drops an empty state", () => {
    const s = parseScenario(
      doc({
        actors: [
          {
            ...actor,
            state: { hp: 0.5, invulnerable: true, junk: 1, name: "Kane" },
          },
          { ...actor, id: "a2", state: { hp: "half" } },
          { ...actor, id: "a3", state: "invulnerable" },
        ],
      }),
    );
    expect(s?.actors[0].state).toEqual({
      hp: 0.5,
      invulnerable: true,
      name: "Kane",
    });
    expect(s?.actors[1].state).toBeUndefined();
    expect(s?.actors[2].state).toBeUndefined();
  });

  it("rejects an actor with no unitDef, team or position", () => {
    expect(
      parseScenario(doc({ actors: [{ ...actor, unitDef: "" }] })),
    ).toBeNull();
    expect(
      parseScenario(doc({ actors: [{ ...actor, team: undefined }] })),
    ).toBeNull();
    expect(
      parseScenario(doc({ actors: [{ ...actor, pos: undefined }] })),
    ).toBeNull();
  });
});

describe("parseScenario — groups", () => {
  const group = {
    id: "g1",
    team: "p1",
    pos: { x: 0, z: 0 },
    units: [{ def: "armpw", count: 4 }],
  };

  it("parses a group with orders and defaults dormant to false", () => {
    const s = parseScenario(
      doc({
        groups: [
          {
            ...group,
            orders: [
              {
                kind: "patrol",
                waypoints: [
                  { x: 1, z: 2 },
                  { x: 3, z: 4 },
                ],
              },
              { kind: "guard", target: "a1" },
            ],
          },
        ],
      }),
    );
    expect(s?.groups[0].dormant).toBe(false);
    expect(s?.groups[0].orders).toEqual([
      {
        kind: "patrol",
        waypoints: [
          { x: 1, z: 2 },
          { x: 3, z: 4 },
        ],
      },
      { kind: "guard", target: "a1" },
    ]);
  });

  it("truncates a fractional unit count and rejects a count below one", () => {
    const s = parseScenario(
      doc({ groups: [{ ...group, units: [{ def: "armpw", count: 4.9 }] }] }),
    );
    expect(s?.groups[0].units).toEqual([{ def: "armpw", count: 4 }]);
    expect(
      parseScenario(
        doc({ groups: [{ ...group, units: [{ def: "armpw", count: 0 }] }] }),
      ),
    ).toBeNull();
  });

  it("rejects a group with no unit list", () => {
    expect(
      parseScenario(doc({ groups: [{ ...group, units: undefined }] })),
    ).toBeNull();
  });

  it("rejects an unknown order kind or a waypointless move", () => {
    expect(
      parseScenario(
        doc({ groups: [{ ...group, orders: [{ kind: "dance" }] }] }),
      ),
    ).toBeNull();
    expect(
      parseScenario(
        doc({ groups: [{ ...group, orders: [{ kind: "move" }] }] }),
      ),
    ).toBeNull();
    expect(
      parseScenario(
        doc({
          groups: [{ ...group, orders: [{ kind: "guard", target: "" }] }],
        }),
      ),
    ).toBeNull();
  });
});

describe("parseScenario — bases", () => {
  const blueprint = {
    id: "bp1",
    name: "The keep",
    buildings: [{ def: "armlab", offset: { x: 0, z: 0 }, facing: 2 }],
  };
  const base = {
    id: "b1",
    blueprint: "bp1",
    team: "p1",
    origin: { x: 500, z: 500 },
    buildings: [{ queue: ["armpw"] }],
  };
  const withBase = (extra: Record<string, unknown> = {}) =>
    doc({ blueprints: [blueprint], bases: [base], ...extra });

  it("reads a layout and the base placed from it", () => {
    const s = parseScenario(withBase());
    expect(s?.blueprints[0]).toEqual(blueprint);
    expect(s?.bases[0]).toEqual(base);
  });

  it("puts the two halves of a building back together", () => {
    const s = parseScenario(withBase());
    if (!s) throw new Error("did not parse");
    expect(baseBuildings(s.blueprints, s.bases[0])).toEqual([
      { def: "armlab", offset: { x: 0, z: 0 }, facing: 2, queue: ["armpw"] },
    ]);
  });

  it("numbers a layout that has no name of its own", () => {
    const s = parseScenario(
      withBase({ blueprints: [{ ...blueprint, name: undefined }] }),
    );
    expect(s?.blueprints[0].name).toBe("Layout 1");
  });

  /** Issue #1414. Every layout written before this build was named after the id
   *  the editor minted for it, and a UUID is not a name to put on a card. */
  it("numbers a layout named after its own id", () => {
    const s = parseScenario(
      withBase({ blueprints: [{ ...blueprint, name: "bp1" }] }),
    );
    expect(s?.blueprints[0].name).toBe("Layout 1");
  });

  it("does not number one onto a name somebody chose", () => {
    const s = parseScenario(
      withBase({
        blueprints: [
          { ...blueprint, id: "bp0", name: "Layout 2" },
          { ...blueprint, name: "  " },
        ],
        bases: [base, { ...base, id: "b0", blueprint: "bp0" }],
      }),
    );
    expect(s?.blueprints.map((b) => b.name)).toEqual(["Layout 2", "Layout 3"]);
  });

  /** Issue #1418. The array is the build order and this says whether that order
   *  was meant, so it has to survive a round trip like any other field. */
  it("keeps a layout whose order is the build order", () => {
    const s = parseScenario(
      withBase({ blueprints: [{ ...blueprint, ordered: true }] }),
    );
    expect(s?.blueprints[0].ordered).toBe(true);
  });

  it("leaves a layout that does not say so unordered", () => {
    expect(parseScenario(withBase())?.blueprints[0].ordered).toBeUndefined();
    const s = parseScenario(
      withBase({ blueprints: [{ ...blueprint, ordered: "yes" }] }),
    );
    expect(s?.blueprints[0].ordered).toBeUndefined();
  });

  /** Issue #1315. A layout is only correct on the terrain it was drawn for, so
   *  which map that was is worth keeping. */
  it("keeps the map a layout was designed for", () => {
    const s = parseScenario(
      withBase({
        blueprints: [{ ...blueprint, designedFor: "Comet Catcher Remake 1.8" }],
      }),
    );
    expect(s?.blueprints[0].designedFor).toBe("Comet Catcher Remake 1.8");
  });

  it("leaves a layout drawn for no map without one", () => {
    expect(
      parseScenario(withBase())?.blueprints[0].designedFor,
    ).toBeUndefined();
    for (const designedFor of [42, "", "   "]) {
      const s = parseScenario(
        withBase({ blueprints: [{ ...blueprint, designedFor }] }),
      );
      expect(s?.blueprints[0].designedFor).toBeUndefined();
    }
  });

  it("drops non-string queue entries", () => {
    const s = parseScenario(
      withBase({
        bases: [
          { ...base, buildings: [{ queue: ["armpw", 3, null], repeat: true }] },
        ],
      }),
    );
    expect(s?.bases[0].buildings[0].queue).toEqual(["armpw"]);
    expect(s?.bases[0].buildings[0].repeat).toBe(true);
  });

  // Issue #878. A building the author named is addressable as an actor is, so
  // the id has to survive the round trip like every other cross-reference.
  it("keeps the id a building is named by", () => {
    const s = parseScenario(
      withBase({ bases: [{ ...base, buildings: [{ id: "keep-lab" }] }] }),
    );
    expect(s?.bases[0].buildings[0].id).toBe("keep-lab");
  });

  it("leaves a building nothing was said about unnamed", () => {
    const s = parseScenario(withBase({ bases: [{ ...base, buildings: [] }] }));
    expect(s?.bases[0].buildings).toEqual([]);
    expect(baseBuildings(s?.blueprints ?? [], base).at(0)?.id).toBeUndefined();
  });

  /** Read by position, so a run of empties on the end says nothing an absent
   *  list does not, and a document that keeps re-saving stays small. */
  it("drops the empty entries on the end of a base's own list", () => {
    const s = parseScenario(
      withBase({
        bases: [{ ...base, buildings: [{ id: "keep-lab" }, {}, {}] }],
      }),
    );
    expect(s?.bases[0].buildings).toEqual([{ id: "keep-lab" }]);
  });

  it("rejects a building with no offset", () => {
    expect(
      parseScenario(
        withBase({ blueprints: [{ ...blueprint, buildings: [{ def: "a" }] }] }),
      ),
    ).toBeNull();
  });

  /**
   * The two halves are one thing split in two, so a placement whose layout is
   * gone is not a half-authored base, it is a base whose buildings have been
   * lost. Loading it would show an author an empty map and save the emptiness
   * back over what they had.
   */
  it("rejects a base naming a layout the document does not hold", () => {
    expect(
      parseScenario(withBase({ bases: [{ ...base, blueprint: "gone" }] })),
    ).toBeNull();
  });
});

/**
 * Issue #1310. A schema 1 document holds one `prefabs` list carrying the layout
 * and the mission's own fields together. Every scenario saved before this build,
 * and every export already shared, is one of those, so reading it has to go on
 * working and has to land in the same place the editor would put it.
 */
describe("parseScenario — reading a schema 1 document", () => {
  const prefab = {
    id: "pf1",
    team: "p1",
    origin: { x: 500, z: 500 },
    buildings: [
      {
        id: "keep-lab",
        def: "armlab",
        offset: { x: 0, z: 0 },
        facing: 2,
        queue: ["armpw"],
        repeat: true,
      },
      { def: "armsolar", offset: { x: 96, z: 0 }, facing: 0 },
    ],
  };

  it("splits a prefab into a layout and a placement", () => {
    const s = parseScenario(doc({ prefabs: [prefab] }));
    expect(s?.blueprints).toEqual([
      {
        id: "pf1",
        name: "Layout 1",
        buildings: [
          { def: "armlab", offset: { x: 0, z: 0 }, facing: 2 },
          { def: "armsolar", offset: { x: 96, z: 0 }, facing: 0 },
        ],
      },
    ]);
    expect(s?.bases).toEqual([
      {
        id: "pf1",
        blueprint: "pf1",
        team: "p1",
        origin: { x: 500, z: 500 },
        buildings: [{ id: "keep-lab", queue: ["armpw"], repeat: true }],
      },
    ]);
  });

  /** What the compile step and the map both read, so the split has to put every
   *  building back exactly as the old document held it. */
  it("puts every building back as it was", () => {
    const s = parseScenario(doc({ prefabs: [prefab] }));
    if (!s) throw new Error("did not parse");
    expect(baseBuildings(s.blueprints, s.bases[0])).toEqual([
      {
        id: "keep-lab",
        def: "armlab",
        offset: { x: 0, z: 0 },
        facing: 2,
        queue: ["armpw"],
        repeat: true,
      },
      { def: "armsolar", offset: { x: 96, z: 0 }, facing: 0 },
    ]);
  });

  it("gives two identical prefabs a layout each", () => {
    const s = parseScenario(
      doc({ prefabs: [prefab, { ...prefab, id: "pf2" }] }),
    );
    expect(s?.blueprints.map((b) => b.id)).toEqual(["pf1", "pf2"]);
    expect(s?.bases.map((b) => b.blueprint)).toEqual(["pf1", "pf2"]);
  });

  it("ignores `prefabs` once a document has bases of its own", () => {
    const s = parseScenario(
      doc({ prefabs: [prefab], blueprints: [], bases: [] }),
    );
    expect(s?.blueprints).toEqual([]);
    expect(s?.bases).toEqual([]);
  });

  it("rejects a malformed prefab rather than dropping it", () => {
    expect(
      parseScenario(doc({ prefabs: [{ ...prefab, origin: undefined }] })),
    ).toBeNull();
  });
});

/**
 * Issue #2205. A trigger used to be identified by the one string it had, so its
 * name was also what `enable_trigger` pointed at and what the compiled mission
 * addressed it by. Every scenario written before this build is one of those, and
 * every one of them has to go on playing exactly as it did.
 *
 * The id is the thing that did not move: a document with no `name` keeps its ids
 * and its references untouched, and gains the name it always displayed. So there
 * is nothing to rewrite on disk and nothing to recompile. The corpus fixtures in
 * `corpus.test.ts` are the standing proof, because none of them carries a `name`
 * and each is checked against its committed `mission.lua` byte for byte.
 */
describe("parseScenario — a trigger written before names existed", () => {
  const nameless = {
    id: "gates-open",
    conditions: { op: "all", conditions: [] },
    actions: [
      { type: "enable_trigger", params: { trigger: "gates-open" } },
      { type: "victory", params: {} },
    ],
  };

  it("keeps the id it was written with", () => {
    const s = parseScenario(doc({ triggers: [nameless] }));
    expect(s?.triggers[0].id).toBe("gates-open");
  });

  it("takes the id as the name it was displayed under", () => {
    const s = parseScenario(doc({ triggers: [nameless] }));
    expect(s?.triggers[0].name).toBe("gates-open");
  });

  it("leaves every reference to it pointing where it pointed", () => {
    const s = parseScenario(doc({ triggers: [nameless] }));
    expect(s?.triggers[0].actions[0].params.trigger).toBe("gates-open");
  });

  it("keeps a name that has been written down since", () => {
    const s = parseScenario(
      doc({ triggers: [{ ...nameless, name: "The gates open" }] }),
    );
    expect(s?.triggers[0].id).toBe("gates-open");
    expect(s?.triggers[0].name).toBe("The gates open");
  });

  /** A name is a label, so an unreadable one falls back rather than taking the
   *  whole document down with it. An id does not: it is what references resolve
   *  against, and guessing one is how a mission comes apart quietly. */
  it("falls back to the id when the name is not a string", () => {
    for (const name of [42, null, "", {}]) {
      const s = parseScenario(doc({ triggers: [{ ...nameless, name }] }));
      expect(s?.triggers[0].name).toBe("gates-open");
    }
  });
});

describe("parseScenario — triggers", () => {
  const trigger = (extra: Record<string, unknown> = {}) => ({
    id: "t1",
    conditions: {
      op: "all",
      conditions: [{ type: "time_elapsed", params: { seconds: 60 } }],
    },
    actions: [{ type: "victory", params: {} }],
    ...extra,
  });

  it("parses a trigger, defaulting enabled to true and repeat to false", () => {
    const s = parseScenario(doc({ triggers: [trigger()] }));
    expect(s?.triggers[0]).toEqual({
      id: "t1",
      name: "t1",
      enabled: true,
      repeat: false,
      conditions: {
        op: "all",
        conditions: [{ type: "time_elapsed", params: { seconds: 60 } }],
      },
      actions: [{ type: "victory", params: {} }],
    });
  });

  it("honours an explicit enabled false and repeat true", () => {
    const s = parseScenario(
      doc({ triggers: [trigger({ enabled: false, repeat: true })] }),
    );
    expect(s?.triggers[0].enabled).toBe(false);
    expect(s?.triggers[0].repeat).toBe(true);
  });

  it("keeps a cooldown and drops one that is not a wait", () => {
    const kept = parseScenario(doc({ triggers: [trigger({ cooldown: 30 })] }));
    expect(kept?.triggers[0].cooldown).toBe(30);

    for (const cooldown of [0, -5, "30", null]) {
      const s = parseScenario(doc({ triggers: [trigger({ cooldown })] }));
      expect(s?.triggers[0].cooldown).toBeUndefined();
    }
  });

  it("falls back to an all-of condition group", () => {
    const s = parseScenario(
      doc({ triggers: [trigger({ conditions: { op: "some" } })] }),
    );
    expect(s?.triggers[0].conditions).toEqual({ op: "all", conditions: [] });
  });

  it("rejects a trigger with no action list", () => {
    expect(
      parseScenario(doc({ triggers: [trigger({ actions: undefined })] })),
    ).toBeNull();
  });

  it("rejects a condition or action with no type", () => {
    expect(
      parseScenario(
        doc({
          triggers: [
            trigger({
              conditions: { op: "all", conditions: [{ params: {} }] },
            }),
          ],
        }),
      ),
    ).toBeNull();
    expect(
      parseScenario(
        doc({ triggers: [trigger({ actions: [{ params: {} }] })] }),
      ),
    ).toBeNull();
  });

  it("rejects a known type missing a required parameter", () => {
    expect(
      parseScenario(
        doc({
          triggers: [
            trigger({
              conditions: {
                op: "all",
                conditions: [{ type: "units_in_zone", params: {} }],
              },
            }),
          ],
        }),
      ),
    ).toBeNull();
    expect(
      parseScenario(
        doc({
          triggers: [
            trigger({ actions: [{ type: "spawn_group", params: {} }] }),
          ],
        }),
      ),
    ).toBeNull();
  });

  it("rejects a required parameter of the wrong type", () => {
    expect(
      parseScenario(
        doc({
          triggers: [
            trigger({
              conditions: {
                op: "all",
                conditions: [
                  { type: "time_elapsed", params: { seconds: "a minute" } },
                ],
              },
            }),
          ],
        }),
      ),
    ).toBeNull();
  });

  it("rejects a comparison operator outside the allowed set", () => {
    const varCondition = (op: unknown) =>
      doc({
        triggers: [
          trigger({
            conditions: {
              op: "all",
              conditions: [
                { type: "var", params: { name: "kills", op, value: 3 } },
              ],
            },
          }),
        ],
      });
    expect(parseScenario(varCondition("approximately"))).toBeNull();
    expect(parseScenario(varCondition("gte"))).not.toBeNull();
  });

  it("drops an optional parameter of the wrong type and keeps the rest", () => {
    const s = parseScenario(
      doc({
        triggers: [
          trigger({
            conditions: {
              op: "any",
              conditions: [
                {
                  type: "units_in_zone",
                  params: { zone: "z1", team: 7, min: 2, junk: "ignored" },
                },
              ],
            },
          }),
        ],
      }),
    );
    expect(s?.triggers[0].conditions).toEqual({
      op: "any",
      conditions: [{ type: "units_in_zone", params: { zone: "z1", min: 2 } }],
    });
  });

  it("keeps an unknown extension type's parameters untouched", () => {
    const s = parseScenario(
      doc({
        triggers: [
          trigger({
            actions: [
              {
                type: "sf_set_weather",
                params: {
                  mode: "storm",
                  intensity: 3,
                  layers: ["rain", "wind"],
                  nested: { seed: 12 },
                },
              },
            ],
          }),
        ],
      }),
    );
    expect(s?.triggers[0].actions[0]).toEqual({
      type: "sf_set_weather",
      params: {
        mode: "storm",
        intensity: 3,
        layers: ["rain", "wind"],
        nested: { seed: 12 },
      },
    });
  });

  /**
   * Issue #808. An `amount` parameter holds a number or the var to read one
   * out of, so both shapes have to survive the round trip and anything else
   * has to be refused the way a malformed number is.
   */
  describe("an amount", () => {
    const withValue = (value: unknown) =>
      doc({
        triggers: [
          trigger({
            actions: [{ type: "add_var", params: { name: "score", value } }],
          }),
        ],
      });

    it("keeps a plain number", () => {
      const s = parseScenario(withValue(5));
      expect(s?.triggers[0].actions[0].params.value).toBe(5);
    });

    it("keeps the var it names", () => {
      const s = parseScenario(withValue({ var: "bonus" }));
      expect(s?.triggers[0].actions[0].params.value).toEqual({ var: "bonus" });
    });

    it("drops anything else the table carries", () => {
      const s = parseScenario(withValue({ var: "bonus", junk: 1 }));
      expect(s?.triggers[0].actions[0].params.value).toEqual({ var: "bonus" });
    });

    it("rejects a table that names no var, and a value that is neither", () => {
      expect(parseScenario(withValue({}))).toBeNull();
      expect(parseScenario(withValue({ var: "" }))).toBeNull();
      expect(parseScenario(withValue("5"))).toBeNull();
      expect(parseScenario(withValue(undefined))).toBeNull();
    });
  });

  it("parses orders carried as an action parameter", () => {
    const s = parseScenario(
      doc({
        triggers: [
          trigger({
            actions: [
              {
                type: "give_orders",
                params: {
                  group: "g1",
                  orders: [{ kind: "attack", target: "a1" }],
                },
              },
            ],
          }),
        ],
      }),
    );
    expect(s?.triggers[0].actions[0].params.orders).toEqual([
      { kind: "attack", target: "a1" },
    ]);
  });

  it("rejects malformed orders in an action parameter", () => {
    expect(
      parseScenario(
        doc({
          triggers: [
            trigger({
              actions: [
                {
                  type: "give_orders",
                  params: { group: "g1", orders: [{ kind: "attack" }] },
                },
              ],
            }),
          ],
        }),
      ),
    ).toBeNull();
  });
});

describe("parseScenario — objectives and dialogue", () => {
  it("defaults an objective to a visible primary", () => {
    const s = parseScenario(doc({ objectives: [{ id: "o1", text: "Win" }] }));
    expect(s?.objectives[0]).toEqual({
      id: "o1",
      kind: "primary",
      text: "Win",
      hidden: false,
    });
  });

  it("parses a secondary hidden objective", () => {
    const s = parseScenario(
      doc({
        objectives: [
          { id: "o1", kind: "secondary", text: "Rescue", hidden: true },
        ],
      }),
    );
    expect(s?.objectives[0].kind).toBe("secondary");
    expect(s?.objectives[0].hidden).toBe(true);
  });

  it("parses a dialogue line with its media file names", () => {
    const s = parseScenario(
      doc({
        dialogue: [
          {
            id: "d1",
            speaker: "Commander",
            text: "Move out.",
            portrait: "cmdr.png",
            audio: "cmdr01.wav",
          },
        ],
      }),
    );
    expect(s?.dialogue[0]).toEqual({
      id: "d1",
      speaker: "Commander",
      text: "Move out.",
      portrait: "cmdr.png",
      audio: "cmdr01.wav",
    });
  });

  it("rejects an objective or dialogue line with no id", () => {
    expect(parseScenario(doc({ objectives: [{ text: "Win" }] }))).toBeNull();
    expect(parseScenario(doc({ dialogue: [{ text: "Hi" }] }))).toBeNull();
  });
});

describe("parseScenario — teams, vars and restrictions", () => {
  it("parses per-team starting conditions", () => {
    const s = parseScenario(
      doc({
        teams: {
          p0: {
            startUnits: ["armcom", 3],
            resources: { metal: 1000, energy: "lots" },
            income: { energy: 20 },
            noCommander: true,
          },
        },
      }),
    );
    expect(s?.teams.p0).toEqual({
      startUnits: ["armcom"],
      resources: { metal: 1000 },
      income: { energy: 20 },
      noCommander: true,
    });
  });

  it("rejects a malformed team entry rather than losing its setup", () => {
    expect(parseScenario(doc({ teams: { p0: "rich" } }))).toBeNull();
    expect(parseScenario(doc({ teams: [] }))).toBeNull();
  });

  it("keeps only numeric vars", () => {
    const s = parseScenario(
      doc({ vars: { kills: 0, phase: 2, flag: true, note: "x" } }),
    );
    expect(s?.vars).toEqual({ kills: 0, phase: 2 });
  });

  it("parses buildable restrictions, defaulting the mode to deny", () => {
    const s = parseScenario(
      doc({
        restrictions: {
          buildable: { units: ["armbrtha", 9] },
          commands: ["selfd", 3],
        },
      }),
    );
    expect(s?.restrictions).toEqual({
      buildable: { mode: "deny", units: ["armbrtha"] },
      commands: ["selfd"],
    });
  });

  it("drops a buildable block with no unit list", () => {
    const s = parseScenario(
      doc({ restrictions: { buildable: { mode: "allow" } } }),
    );
    expect(s?.restrictions.buildable).toBeUndefined();
  });
});

/**
 * Issue #2250. The mark says which numbered ids the document has already handed
 * out, so a deleted trigger's id is never given to a new one.
 */
describe("parseScenario — id counters", () => {
  it("reads the marks a document carries", () => {
    const s = parseScenario(doc({ idCounters: { trigger: 4, line: 2 } }));
    expect(s?.idCounters).toEqual({ trigger: 4, line: 2 });
  });

  it("carries a prefix it does not know, so a later coilbox keeps its mark", () => {
    const s = parseScenario(doc({ idCounters: { waypoint: 3 } }));
    expect(s?.idCounters).toEqual({ waypoint: 3 });
  });

  it("drops a mark that is not a whole count rather than refusing the mission", () => {
    const s = parseScenario(
      doc({ idCounters: { trigger: 2, a: -1, b: 1.5, c: "9", d: null } }),
    );
    expect(s?.idCounters).toEqual({ trigger: 2 });
  });

  /** Absent rather than empty, so a document that has never had anything
   *  deleted from it is written back with no new key. */
  it("leaves the field off a document that carries no mark", () => {
    expect(parseScenario(doc({}))?.idCounters).toBeUndefined();
    expect(parseScenario(doc({ idCounters: {} }))?.idCounters).toBeUndefined();
    expect(
      parseScenario(doc({ idCounters: "none" }))?.idCounters,
    ).toBeUndefined();
  });
});

describe("parseScenario — round trip", () => {
  it("re-parses its own output unchanged", () => {
    const first = parseScenario(
      doc({
        description: "A test",
        runtimeVersion: 2,
        createdAt: "2026-07-31T00:00:00Z",
        updatedAt: "2026-07-31T01:00:00Z",
        zones: [zone],
        actors: [
          {
            id: "a1",
            unitDef: "armcom",
            team: "p0",
            pos: { x: 1, z: 2 },
            facing: 1,
            state: { hp: 0.25 },
          },
        ],
        groups: [
          {
            id: "g1",
            team: "p1",
            pos: { x: 9, z: 9 },
            units: [{ def: "armpw", count: 2 }],
            orders: [{ kind: "move", waypoints: [{ x: 1, z: 1 }] }],
            dormant: true,
          },
        ],
        blueprints: [
          {
            id: "bp1",
            name: "The keep",
            buildings: [{ def: "armlab", offset: { x: 0, z: 0 }, facing: 3 }],
          },
        ],
        bases: [
          {
            id: "b1",
            blueprint: "bp1",
            team: "p1",
            origin: { x: 5, z: 5 },
            buildings: [{ id: "keep-lab" }],
          },
        ],
        restrictions: { buildable: { mode: "allow", units: ["armpw"] } },
        vars: { kills: 0 },
        triggers: [
          {
            id: "t1",
            enabled: false,
            repeat: true,
            conditions: {
              op: "any",
              conditions: [
                { type: "unit_dead", params: { actor: "a1" } },
                { type: "sf_rp_spent", params: { amount: 5 } },
              ],
            },
            actions: [
              { type: "dialogue", params: { line: "d1" } },
              { type: "defeat", params: {} },
            ],
          },
        ],
        objectives: [
          { id: "o1", kind: "secondary", text: "Hold", hidden: true },
        ],
        dialogue: [{ id: "d1", speaker: "Base", text: "Lost." }],
        script: true,
      }),
    );
    expect(first).not.toBeNull();
    expect(parseScenarioJson(JSON.stringify(first))).toEqual(first);
  });
});

/** Issue #2164. */
describe("parseScenario — difficulty ranges", () => {
  const actor = {
    id: "a1",
    unitDef: "corllt",
    team: "p0",
    pos: { x: 10, z: 20 },
  };

  const rangeOf = (difficulty: unknown) =>
    parseScenario(doc({ actors: [{ ...actor, difficulty }] }))?.actors[0]
      .difficulty;

  it("keeps either bound, or both", () => {
    expect(rangeOf({ atLeast: "hard" })).toEqual({ atLeast: "hard" });
    expect(rangeOf({ atMost: "normal" })).toEqual({ atMost: "normal" });
    expect(rangeOf({ atLeast: "easy", atMost: "normal" })).toEqual({
      atLeast: "easy",
      atMost: "normal",
    });
  });

  // A bound this build cannot rank would otherwise reach the runtime, which
  // cannot rank it either and would read the thing as always present.
  it("drops a bound that is not one of the difficulties", () => {
    expect(rangeOf({ atLeast: "nightmare", atMost: "hard" })).toEqual({
      atMost: "hard",
    });
  });

  // The field has to stay absent rather than present and empty: an empty table
  // in the document is an empty table in the compiled mission, and a document
  // that asks for nothing has to compile to the bytes it always did.
  it("leaves the field off when the range says nothing", () => {
    for (const said of [{}, { atLeast: "nightmare" }, "hard", 3, null]) {
      expect(rangeOf(said)).toBeUndefined();
    }
    expect(parseScenario(doc({ actors: [actor] }))?.actors[0].difficulty).toBe(
      undefined,
    );
  });

  it("reads one on a group, a base and a trigger too", () => {
    const s = parseScenario(
      doc({
        groups: [
          {
            id: "g1",
            team: "p0",
            units: [{ def: "armpw", count: 1 }],
            pos: { x: 1, z: 1 },
            difficulty: { atLeast: "hard" },
          },
        ],
        blueprints: [
          {
            id: "bp1",
            name: "Outpost",
            buildings: [{ def: "corllt", offset: { x: 0, z: 0 } }],
          },
        ],
        bases: [
          {
            id: "b1",
            blueprint: "bp1",
            team: "p0",
            origin: { x: 5, z: 5 },
            difficulty: { atMost: "easy" },
          },
        ],
        triggers: [
          {
            id: "t1",
            conditions: { op: "all", conditions: [] },
            actions: [],
            difficulty: { atLeast: "normal" },
          },
        ],
      }),
    );

    expect(s?.groups[0].difficulty).toEqual({ atLeast: "hard" });
    expect(s?.bases[0].difficulty).toEqual({ atMost: "easy" });
    expect(s?.triggers[0].difficulty).toEqual({ atLeast: "normal" });
  });
});

describe("difficultyApplies", () => {
  it("says yes to everything with no range", () => {
    for (const level of DIFFICULTIES) {
      expect(difficultyApplies(undefined, level)).toBe(true);
      expect(difficultyApplies({}, level)).toBe(true);
    }
  });

  it("reads both bounds inclusively", () => {
    const at = (range: DifficultyRange) =>
      DIFFICULTIES.filter((level) => difficultyApplies(range, level));

    expect(at({ atLeast: "normal" })).toEqual(["normal", "hard"]);
    expect(at({ atMost: "normal" })).toEqual(["easy", "normal"]);
    expect(at({ atLeast: "normal", atMost: "normal" })).toEqual(["normal"]);
  });

  // An author can write a range that excludes every level. It is theirs to fix,
  // and the mission validator says so, but it must not read as "always".
  it("says no everywhere for a range that crosses itself", () => {
    expect(
      DIFFICULTIES.filter((level) =>
        difficultyApplies({ atLeast: "hard", atMost: "easy" }, level),
      ),
    ).toEqual([]);
  });
});

describe("usesDifficulty", () => {
  const parsed = (extra: Record<string, unknown>) => {
    const scenario = parseScenario(doc(extra));
    if (!scenario) throw new Error("fixture does not parse");
    return scenario;
  };

  it("is false for a document that never mentions it", () => {
    expect(usesDifficulty(parsed({ actors: [] }))).toBe(false);
  });

  it("is true as soon as one thing has a range", () => {
    expect(
      usesDifficulty(
        parsed({
          actors: [
            {
              id: "a1",
              unitDef: "corllt",
              team: "p0",
              pos: { x: 1, z: 1 },
              difficulty: { atLeast: "hard" },
            },
          ],
        }),
      ),
    ).toBe(true);
  });
});
