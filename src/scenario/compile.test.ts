import { describe, expect, it } from "vitest";
import { compileScenario, luaString, missionPath } from "./compile";
import { parseScenario, type Scenario } from "./model";

/** A valid scenario carrying only the fields a test cares about. */
function build(overrides: Record<string, unknown> = {}): Scenario {
  const scenario = parseScenario({
    id: "s1",
    name: "Scenario",
    setup: {},
    ...overrides,
  });
  if (!scenario) throw new Error("fixture is not a valid scenario");
  return scenario;
}

describe("luaString", () => {
  it("escapes the two characters that would end the literal", () => {
    expect(luaString('a "quote" and a \\ backslash')).toBe(
      '"a \\"quote\\" and a \\\\ backslash"',
    );
  });

  it("escapes the whitespace that cannot appear raw in a short string", () => {
    expect(luaString("one\ntwo\r\nthree\tfour")).toBe(
      '"one\\ntwo\\r\\nthree\\tfour"',
    );
  });

  it("pads a control-character escape to three digits", () => {
    // "\05" would read back as byte 5, losing the digit that followed.
    expect(luaString("\x005")).toBe('"\\0005"');
    expect(luaString("\x07\x1b\x7f")).toBe('"\\007\\027\\127"');
  });

  it("leaves non-ASCII alone, so the UTF-8 bytes survive", () => {
    expect(luaString("café ← 战地")).toBe('"café ← 战地"');
  });

  it("does not let a hostile name break out of the literal", () => {
    const hostile = '", os.execute("rm -rf /"), "';
    const emitted = compileScenario(build({ name: hostile }));

    expect(emitted).toContain(`name = "\\", os.execute(\\"rm -rf /\\"), \\""`);
    expect(emitted).not.toContain('os.execute("rm');
  });

  it("keeps a newline in dialogue text out of the source lines", () => {
    const emitted = compileScenario(
      build({
        dialogue: [{ id: "d1", speaker: "S", text: "up\nreturn 1 --" }],
      }),
    );

    expect(emitted).toContain('text = "up\\nreturn 1 --"');
    // The text stays inside its literal, so no source line starts with it.
    const escaped = emitted
      .split("\n")
      .some((l) => l.trim().startsWith("return 1"));
    expect(escaped).toBe(false);
  });
});

describe("table keys", () => {
  it("brackets a Lua keyword used as a field name", () => {
    const emitted = compileScenario(
      build({
        triggers: [{ id: "t1", repeat: true, actions: [] }],
        prefabs: [
          {
            id: "pf1",
            team: "p0",
            origin: { x: 0, z: 0 },
            buildings: [
              { def: "armlab", offset: { x: 0, z: 0 }, repeat: true },
            ],
          },
        ],
      }),
    );

    expect(emitted).toContain('["repeat"] = true,');
    expect(emitted).not.toContain("repeat = true");
  });

  it("emits the id a prefab building is named by", () => {
    const emitted = compileScenario(
      build({
        prefabs: [
          {
            id: "pf1",
            team: "p0",
            origin: { x: 100, z: 100 },
            buildings: [
              { id: "keep-lab", def: "armlab", offset: { x: 0, z: 0 } },
              { def: "armsolar", offset: { x: 64, z: 0 } },
            ],
          },
        ],
      }),
    );

    expect(emitted).toContain('id = "keep-lab"');
    expect(emitted).toContain('def = "armsolar"');
  });

  // Issue #808. An amount is a number or the var to read one out of, and the
  // second reaches the runtime as a table where the first is a bare number.
  it("emits an amount as a number or as the var it names", () => {
    const emitted = compileScenario(
      build({
        vars: { score: 0, bonus: 5 },
        triggers: [
          {
            id: "t1",
            conditions: { op: "all", conditions: [] },
            actions: [
              { type: "add_var", params: { name: "score", value: 2 } },
              {
                type: "set_var",
                params: { name: "score", value: { var: "bonus" } },
              },
            ],
          },
        ],
      }),
    );

    expect(emitted).toContain('params = { name = "score", value = 2 }');
    expect(emitted).toContain('value = { var = "bonus" }');
  });

  it("brackets author-chosen keys that are not bare identifiers", () => {
    const emitted = compileScenario(
      build({ vars: { alarm: 1, end: 2, "wave count": 3, "7": 4 } }),
    );

    expect(emitted).toContain("alarm = 1");
    expect(emitted).toContain('["end"] = 2');
    expect(emitted).toContain('["wave count"] = 3');
    expect(emitted).toContain('["7"] = 4');
  });
});

describe("compileScenario", () => {
  it("emits a single return statement and a trailing newline", () => {
    const emitted = compileScenario(build());

    expect(emitted.startsWith("-- Compiled by coilbox")).toBe(true);
    expect(emitted).toContain("\nreturn {\n");
    expect(emitted.endsWith("}\n")).toBe(true);
  });

  it("carries no author text in the header, which a newline could escape", () => {
    const emitted = compileScenario(build({ name: "Ambush\n-- x" }));

    expect(emitted.split("\n").slice(0, 2).join("\n")).toBe(
      [
        "-- Compiled by coilbox from a scenario document.",
        "-- Do not edit: change the scenario and compile again.",
      ].join("\n"),
    );
  });

  it("emits a trigger's cooldown, and nothing when it has none", () => {
    const withWait = compileScenario(
      build({
        triggers: [{ id: "t1", repeat: true, cooldown: 30, actions: [] }],
      }),
    );
    expect(withWait).toContain("cooldown = 30,");

    const without = compileScenario(
      build({ triggers: [{ id: "t1", repeat: true, actions: [] }] }),
    );
    expect(without).not.toContain("cooldown");
  });

  it("is byte-identical whatever order the author-keyed tables came in", () => {
    const first = compileScenario(
      build({
        vars: { zulu: 1, alpha: 2, mike: 3 },
        triggers: [
          {
            id: "t1",
            actions: [
              { type: "sf_weather", params: { wind: 2, kind: "storm" } },
            ],
          },
        ],
      }),
    );
    const second = compileScenario(
      build({
        vars: { mike: 3, zulu: 1, alpha: 2 },
        triggers: [
          {
            id: "t1",
            actions: [
              { type: "sf_weather", params: { kind: "storm", wind: 2 } },
            ],
          },
        ],
      }),
    );

    expect(first).toBe(second);
    expect(first.indexOf("alpha")).toBeLessThan(first.indexOf("mike"));
  });

  it("keeps registry order, which is the order the author sees", () => {
    const emitted = compileScenario(
      build({
        objectives: [
          { id: "second", text: "b" },
          { id: "first", text: "a" },
        ],
      }),
    );

    expect(emitted.indexOf('"second"')).toBeLessThan(
      emitted.indexOf('"first"'),
    );
  });

  it("gives every participant the engine team number the launcher will", () => {
    const emitted = compileScenario(
      build({
        setup: {
          participants: [
            { id: "p0", kind: "you", name: "You", team: 0 },
            { id: "p1", kind: "ai", name: "Ally", team: 0 },
            { id: "p2", kind: "ai", name: "Enemy", team: 1 },
          ],
        },
        teams: { p2: { noCommander: true } },
      }),
    );

    expect(emitted).toContain("p0 = { team = 0 }");
    expect(emitted).toContain("p1 = { team = 0 }");
    expect(emitted).toContain("p2 = { team = 1, noCommander = true }");
  });

  it("leaves a team the launcher gives no slot for the validator to catch", () => {
    const emitted = compileScenario(
      build({
        setup: {
          participants: [
            { id: "p0", kind: "you", name: "You", spectator: true },
            { id: "p1", kind: "ai", name: "Enemy" },
          ],
        },
        teams: { ghost: { noCommander: true } },
      }),
    );

    // A spectator owns no engine team, and `ghost` names no participant at all.
    expect(emitted).toContain("p0 = {}");
    expect(emitted).toContain("p1 = { team = 0 }");
    expect(emitted).toContain("ghost = { noCommander = true }");
  });

  it("emits the map and game so the runtime can refuse the wrong map", () => {
    const emitted = compileScenario(
      build({ setup: { gameName: "SF 0.1", mapName: "Comet Catcher" } }),
    );

    expect(emitted).toContain('game = "SF 0.1"');
    expect(emitted).toContain('map = "Comet Catcher"');
  });

  it("emits each zone shape's own fields and nothing else", () => {
    const emitted = compileScenario(
      build({
        zones: [
          {
            id: "z1",
            name: "Pass",
            shape: "box",
            min: { x: 0, z: 0 },
            max: { x: 8, z: 8 },
          },
          {
            id: "z2",
            name: "Hill",
            shape: "circle",
            center: { x: 4, z: 4 },
            radius: 2,
          },
        ],
      }),
    );

    expect(emitted).toContain('shape = "box"');
    expect(emitted).toContain("min = { x = 0, z = 0 }");
    expect(emitted).toContain("radius = 2");
    expect(emitted).not.toContain("radius = nil");
    // The box zone must not gain the circle's fields, or the other way round.
    expect(emitted.match(/center =/g)).toHaveLength(1);
    expect(emitted.match(/min =/g)).toHaveLength(1);
  });

  it("passes an unknown trigger type's parameters through unchanged", () => {
    const emitted = compileScenario(
      build({
        triggers: [
          {
            id: "t1",
            conditions: {
              op: "any",
              conditions: [
                {
                  type: "sf_rp_spent",
                  params: { amount: 5, tiers: ["a", "b"], on: { rp: true } },
                },
              ],
            },
            actions: [],
          },
        ],
      }),
    );

    expect(emitted).toContain('op = "any"');
    expect(emitted).toContain("amount = 5");
    expect(emitted).toContain("on = { rp = true }");
    expect(emitted).toContain('tiers = { "a", "b" }');
  });

  it("refuses a number Lua has no literal for", () => {
    const broken: Scenario = {
      ...build(),
      zones: [
        {
          id: "z1",
          name: "Bad",
          shape: "circle",
          center: { x: Number.NaN, z: 0 },
          radius: 1,
        },
      ],
    };

    expect(() => compileScenario(broken)).toThrow(/non-finite/);
  });
});

/**
 * Issue #2164. The whole feature is additive or it is a migration, and the
 * checked-in `fixtures/missions/*.lua` in `corpus.test.ts` is the other half of
 * this proof: five documents that name no difficulty still compile to the exact
 * bytes they did before difficulty existed.
 */
describe("difficulty", () => {
  /** Every registry a range can sit on, with nothing said about difficulty. */
  const populated = {
    actors: [
      { id: "a1", unitDef: "armcom", team: "p0", pos: { x: 100, z: 100 } },
    ],
    groups: [
      {
        id: "g1",
        team: "p0",
        units: [{ def: "armpw", count: 2 }],
        pos: { x: 200, z: 200 },
        orders: [],
      },
    ],
    blueprints: [
      {
        id: "bp1",
        name: "Keep",
        buildings: [{ def: "armlab", offset: { x: 0, z: 0 } }],
      },
    ],
    bases: [
      { id: "b1", blueprint: "bp1", team: "p0", origin: { x: 300, z: 300 } },
    ],
    triggers: [{ id: "t1", actions: [] }],
  };

  it("says nothing about a document that names no difficulty", () => {
    expect(compileScenario(build(populated))).not.toContain("difficulty");
  });

  it("emits the range on an actor, a group, a base and a trigger", () => {
    const range = { difficulty: { atLeast: "hard" } };
    const emitted = compileScenario(
      build({
        actors: [{ ...populated.actors[0], ...range }],
        groups: [{ ...populated.groups[0], ...range }],
        blueprints: populated.blueprints,
        bases: [{ ...populated.bases[0], ...range }],
        triggers: [{ ...populated.triggers[0], ...range }],
      }),
    );

    expect(emitted.match(/difficulty = \{ atLeast = "hard" \}/g)).toHaveLength(
      4,
    );
  });

  it("emits both ends of a range that has both", () => {
    const emitted = compileScenario(
      build({
        actors: [
          {
            ...populated.actors[0],
            difficulty: { atMost: "normal", atLeast: "easy" },
          },
        ],
      }),
    );

    expect(emitted).toContain(
      'difficulty = { atLeast = "easy", atMost = "normal" }',
    );
  });

  // A level this build has never heard of is dropped rather than written out,
  // so the runtime never reads a bound it cannot rank.
  it("drops a bound that is not a difficulty", () => {
    const emitted = compileScenario(
      build({
        actors: [
          {
            ...populated.actors[0],
            difficulty: { atLeast: "nightmare", atMost: "hard" },
          },
        ],
      }),
    );

    expect(emitted).toContain('difficulty = { atMost = "hard" }');
  });

  // An empty range and no range are the same thing, and they have to compile
  // the same way or a document that says nothing stops being byte-identical.
  it("treats a range with no bounds as no range", () => {
    expect(
      compileScenario(
        build({ actors: [{ ...populated.actors[0], difficulty: {} }] }),
      ),
    ).toBe(compileScenario(build({ actors: populated.actors })));
  });
});

/**
 * Issue #2205. A trigger's name is the editor's, not the runtime's. The runtime
 * addresses a trigger by its id and `enable_trigger` carries an id, so the name
 * has no work to do in the compiled file and is left out of it.
 *
 * That is what makes the whole change free at the far end. No mission.lua on
 * disk moves, no vendored runtime has to learn anything, and a game shipping a
 * mission does not fall out of step with the document beside it (issue #2160)
 * because somebody gave a trigger a better name.
 */
describe("a trigger's name", () => {
  const armed = {
    id: "t1",
    conditions: { op: "all", conditions: [] },
    actions: [{ type: "enable_trigger", params: { trigger: "t1" } }],
  };

  it("does not reach the compiled mission", () => {
    const renamed = compileScenario(
      build({ triggers: [{ ...armed, name: "The gates open" }] }),
    );
    expect(renamed).toBe(compileScenario(build({ triggers: [armed] })));
    expect(renamed).not.toContain("The gates open");
  });

  it("leaves the id in the file for the runtime to address it by", () => {
    expect(
      compileScenario(build({ triggers: [{ ...armed, name: "Anything" }] })),
    ).toContain('id = "t1"');
  });
});

/**
 * Issue #2248. An objective and a dialogue line are addressed by id in the
 * compiled mission, and `complete_objective` and `dialogue` carry that same id.
 * The words beside each one are the label: the player reads an objective's
 * `text`, the editor lists a line by its `speaker`, and neither is what anything
 * points at.
 *
 * So the id is minted once and nothing renames it, which is what makes this
 * change free at the far end. The compiled file did not move, no runtime has to
 * learn anything, and every mission written before now names the ids it always
 * named.
 */
describe("an objective's and a dialogue line's id", () => {
  const doc = (text: string, speaker: string) =>
    build({
      objectives: [{ id: "hold", kind: "primary", text, hidden: false }],
      dialogue: [{ id: "warn", speaker, text: "Contact." }],
      triggers: [
        {
          id: "t1",
          conditions: { op: "all", conditions: [] },
          actions: [
            { type: "complete_objective", params: { objective: "hold" } },
            { type: "dialogue", params: { line: "warn" } },
          ],
        },
      ],
    });

  it("is what the file carries and what the actions point at", () => {
    const emitted = compileScenario(doc("Hold the pad.", "HQ"));

    expect(emitted).toContain('id = "hold"');
    expect(emitted).toContain('objective = "hold"');
    expect(emitted).toContain('id = "warn"');
    expect(emitted).toContain('line = "warn"');
  });

  it("does not move when the words beside it are rewritten", () => {
    const emitted = compileScenario(doc("Hold the landing pad.", "Control"));

    expect(emitted).toContain('id = "hold"');
    expect(emitted).toContain('objective = "hold"');
    expect(emitted).toContain('id = "warn"');
    expect(emitted).toContain('line = "warn"');
  });
});

describe("missionPath", () => {
  it("puts a mission in its own folder under missions/", () => {
    expect(missionPath("abc-123")).toBe("missions/abc-123/mission.lua");
  });
});
