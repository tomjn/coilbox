import { describe, expect, it } from "vitest";
import {
  extensionSpecs,
  hasExtensions,
  NO_EXTENSIONS,
  parseExtensions,
} from "./extensions";

/** A declaration in the shape `missions/extensions.lua` returns. */
const declaring = (
  conditions: unknown[] = [],
  actions: unknown[] = [],
): unknown => ({
  handler: "luarules/mission_extensions/demo.lua",
  conditions,
  actions,
});

const RESEARCH = {
  type: "sf_research_above",
  label: "Research above",
  description: "The team has more research points than this",
  params: [
    { name: "team", kind: "teamId" },
    { name: "amount", kind: "number" },
  ],
};

describe("parseExtensions", () => {
  it("reads a declared condition with its display metadata", () => {
    const types = parseExtensions(declaring([RESEARCH]));

    expect(types.conditions.sf_research_above).toEqual({
      type: "sf_research_above",
      label: "Research above",
      description: "The team has more research points than this",
      spec: {
        team: { kind: "teamId" },
        amount: { kind: "number" },
      },
    });
    expect(types.problems).toEqual([]);
  });

  it("reads actions the same way", () => {
    const types = parseExtensions(
      declaring([], [{ type: "sf_grant_research", params: [] }]),
    );
    expect(Object.keys(types.actions)).toEqual(["sf_grant_research"]);
    expect(types.conditions).toEqual({});
  });

  it("keeps the order the game declared its parameters in", () => {
    const types = parseExtensions(declaring([RESEARCH]));
    expect(Object.keys(types.conditions.sf_research_above.spec)).toEqual([
      "team",
      "amount",
    ]);
  });

  it("falls back to the type name when the game names no label", () => {
    const types = parseExtensions(declaring([{ type: "sf_weather" }]));
    expect(types.conditions.sf_weather.label).toBe("sf_weather");
    expect(types.conditions.sf_weather.description).toBeUndefined();
  });

  it("carries optional and enum values through", () => {
    const types = parseExtensions(
      declaring([
        {
          type: "sf_weather",
          params: [
            { name: "kind", kind: "enum", values: ["storm", "clear"] },
            { name: "seconds", kind: "number", optional: true },
          ],
        },
      ]),
    );
    expect(types.conditions.sf_weather.spec).toEqual({
      kind: { kind: "enum", values: ["storm", "clear"] },
      seconds: { kind: "number", optional: true },
    });
  });

  it("reads nothing out of a game that declares nothing", () => {
    expect(parseExtensions(null)).toBe(NO_EXTENSIONS);
    expect(parseExtensions("not a table")).toBe(NO_EXTENSIONS);
    expect(hasExtensions(parseExtensions(declaring()))).toBe(false);
  });

  /* ---------------------------------------------------------------------- *
   * The boundary. An extension adds a game concept, never an engine one.
   * ---------------------------------------------------------------------- */

  it("refuses a type coilbox's own runtime owns", () => {
    const types = parseExtensions(
      declaring([{ type: "time_elapsed" }], [{ type: "victory" }]),
    );

    expect(types.conditions).toEqual({});
    expect(types.actions).toEqual({});
    expect(types.problems).toEqual([
      "time_elapsed is the runtime's own type, which an extension may not redefine",
      "victory is the runtime's own type, which an extension may not redefine",
    ]);
  });

  it("refuses one an engine-level type owns in the other list", () => {
    // A condition's name and an action's are one namespace, because the
    // runtime reserves both lists of its marker against both of a
    // declaration's.
    const types = parseExtensions(declaring([{ type: "victory" }]));
    expect(types.conditions).toEqual({});
    expect(types.problems).toHaveLength(1);
  });

  it("refuses a type the game's own runtime owns beyond this build", () => {
    const types = parseExtensions(declaring([{ type: "weather_is" }]), [
      "weather_is",
    ]);
    expect(types.conditions).toEqual({});
    expect(types.problems[0]).toContain("weather_is is the runtime's own type");
  });

  /* ---------------------------------------------------------------------- *
   * A declaration is hand-written, so half of it being wrong costs it half.
   * ---------------------------------------------------------------------- */

  it("drops a type whose parameter has a kind coilbox has no field for", () => {
    const types = parseExtensions(
      declaring([
        { type: "sf_ok", params: [{ name: "n", kind: "number" }] },
        { type: "sf_odd", params: [{ name: "colour", kind: "rgb" }] },
      ]),
    );

    expect(Object.keys(types.conditions)).toEqual(["sf_ok"]);
    expect(types.problems).toEqual([
      "sf_odd: parameter colour has no kind coilbox knows: rgb",
    ]);
  });

  it("drops an enum with no values, which has nothing to pick from", () => {
    const types = parseExtensions(
      declaring([{ type: "sf_weather", params: [{ name: "k", kind: "enum" }] }]),
    );
    expect(types.conditions).toEqual({});
    expect(types.problems[0]).toContain("is an enum with no values");
  });

  it("drops an entry that is not a table, or has no type name", () => {
    const types = parseExtensions(declaring(["nonsense", { label: "no type" }]));
    expect(types.problems).toEqual([
      "an entry that is not a table",
      "an entry with no type name",
    ]);
  });

  it("drops a parameter with no name", () => {
    const types = parseExtensions(
      declaring([{ type: "sf_x", params: [{ kind: "number" }] }]),
    );
    expect(types.problems).toEqual(["sf_x: a parameter with no name"]);
  });

  it("keeps the first of a type declared twice", () => {
    const types = parseExtensions(
      declaring([
        { type: "sf_x", label: "First" },
        { type: "sf_x", label: "Second" },
      ]),
    );
    expect(types.conditions.sf_x.label).toBe("First");
    expect(types.problems).toEqual(["sf_x is declared twice"]);
  });

  it("keeps a condition and an action apart", () => {
    const types = parseExtensions(
      declaring([{ type: "sf_ready" }], [{ type: "sf_grant" }]),
    );
    expect(Object.keys(types.conditions)).toEqual(["sf_ready"]);
    expect(Object.keys(types.actions)).toEqual(["sf_grant"]);
  });

  it("refuses an action that reuses a declared condition's name", () => {
    const types = parseExtensions(
      declaring([{ type: "sf_ready" }], [{ type: "sf_ready" }]),
    );
    expect(Object.keys(types.actions)).toEqual([]);
    expect(types.problems).toEqual(["sf_ready is declared twice"]);
  });
});

describe("extensionSpecs", () => {
  it("is the parameter tables, keyed by type", () => {
    const types = parseExtensions(declaring([RESEARCH]));
    expect(extensionSpecs(types.conditions)).toEqual({
      sf_research_above: { team: { kind: "teamId" }, amount: { kind: "number" } },
    });
  });
});
