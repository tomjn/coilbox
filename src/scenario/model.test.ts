import { describe, expect, it } from "vitest";
import { parseScenario, parseScenarioJson } from "./model";

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
    expect(s?.schemaVersion).toBe(1);
    expect(s?.runtimeVersion).toBe(1);
    expect(s?.description).toBe("");
    expect(s?.zones).toEqual([]);
    expect(s?.actors).toEqual([]);
    expect(s?.groups).toEqual([]);
    expect(s?.prefabs).toEqual([]);
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

describe("parseScenario — prefabs", () => {
  const prefab = {
    id: "pf1",
    team: "p1",
    origin: { x: 500, z: 500 },
    buildings: [
      { def: "armlab", offset: { x: 0, z: 0 }, facing: 2, queue: ["armpw"] },
    ],
  };

  it("parses a prefab with a factory queue", () => {
    const s = parseScenario(doc({ prefabs: [prefab] }));
    expect(s?.prefabs[0].buildings[0]).toEqual({
      def: "armlab",
      offset: { x: 0, z: 0 },
      facing: 2,
      queue: ["armpw"],
    });
    expect(s?.prefabs[0].buildings[0].repeat).toBeUndefined();
  });

  it("drops non-string queue entries", () => {
    const s = parseScenario(
      doc({
        prefabs: [
          {
            ...prefab,
            buildings: [
              {
                def: "armlab",
                offset: { x: 0, z: 0 },
                queue: ["armpw", 3, null],
                repeat: true,
              },
            ],
          },
        ],
      }),
    );
    expect(s?.prefabs[0].buildings[0].queue).toEqual(["armpw"]);
    expect(s?.prefabs[0].buildings[0].repeat).toBe(true);
  });

  it("rejects a building with no offset", () => {
    expect(
      parseScenario(
        doc({ prefabs: [{ ...prefab, buildings: [{ def: "armlab" }] }] }),
      ),
    ).toBeNull();
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
        prefabs: [
          {
            id: "pf1",
            team: "p1",
            origin: { x: 5, z: 5 },
            buildings: [{ def: "armlab", offset: { x: 0, z: 0 }, facing: 3 }],
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
