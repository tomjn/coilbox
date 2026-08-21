import { describe, expect, it } from "vitest";
import type { ConfigOption } from "@/content/bindings";
import { effectiveOptions, groupOptions, withOption } from "./modOptions";

const section = (key: string, name: string): ConfigOption => ({
  key,
  name,
  type: "section",
});

const opt = (key: string, extra: Partial<ConfigOption> = {}): ConfigOption => ({
  key,
  name: key,
  type: "number",
  default: "1",
  ...extra,
});

describe("groupOptions", () => {
  it("puts each option under the section it names, in declaration order", () => {
    const groups = groupOptions([
      section("engine", "Engine Options"),
      opt("maxunits", { section: "engine" }),
      section("speed", "Speed Restriction"),
      opt("maxspeed", { section: "speed" }),
      opt("minspeed", { section: "speed" }),
    ]);
    expect(groups.map((g) => [g.name, g.options.map((o) => o.key)])).toEqual([
      ["Engine Options", ["maxunits"]],
      ["Speed Restriction", ["maxspeed", "minspeed"]],
    ]);
  });

  it("collects top-level options into a leading unnamed group", () => {
    const groups = groupOptions([
      opt("loose"),
      section("engine", "Engine Options"),
      opt("maxunits", { section: "engine" }),
    ]);
    expect(groups[0].name).toBeUndefined();
    expect(groups[0].options.map((o) => o.key)).toEqual(["loose"]);
    expect(groups[1].name).toBe("Engine Options");
  });

  it("never renders a section as a setting of its own", () => {
    const groups = groupOptions([
      section("engine", "Engine Options"),
      opt("maxunits", { section: "engine" }),
    ]);
    expect(groups.flatMap((g) => g.options).map((o) => o.key)).toEqual([
      "maxunits",
    ]);
  });

  it("drops sections that have no options rather than showing an empty group", () => {
    const groups = groupOptions([
      section("empty", "Nothing Here"),
      section("engine", "Engine Options"),
      opt("maxunits", { section: "engine" }),
    ]);
    expect(groups.map((g) => g.name)).toEqual(["Engine Options"]);
  });

  it("keeps an option reachable when it names a section that does not exist", () => {
    const groups = groupOptions([opt("orphan", { section: "ghost" })]);
    expect(groups).toHaveLength(1);
    expect(groups[0].name).toBeUndefined();
    expect(groups[0].options.map((o) => o.key)).toEqual(["orphan"]);
  });

  it("returns nothing for an empty option list", () => {
    expect(groupOptions([])).toEqual([]);
  });
});

describe("withOption", () => {
  it("records what the user set", () => {
    expect(withOption({ maxunits: "5000" }, "startmetal", "2000")).toEqual({
      maxunits: "5000",
      startmetal: "2000",
    });
  });

  it("drops the key when the override goes away, keeping the map sparse", () => {
    // Storing the default instead would pin it, so the setup would stop
    // following the game if the game later changed its mind.
    expect(withOption({ maxunits: "5000" }, "maxunits", undefined)).toEqual({});
  });

  it("leaves an untouched map alone", () => {
    expect(withOption({ maxunits: "5000" }, "startmetal", undefined)).toEqual({
      maxunits: "5000",
    });
  });
});

describe("effectiveOptions", () => {
  it("sends every option's value, defaults included", () => {
    // The engine does NOT fall back to the game's declared defaults for absent
    // keys — it applies its own (MaxUnits 32000, GhostedBuildings 1, ...), so
    // omitting an unchanged option silently changes the game.
    const out = effectiveOptions(
      [
        opt("maxunits", { default: "5000" }),
        opt("startmetal", { default: "1000" }),
      ],
      { startmetal: "2000" },
    );
    expect(out).toEqual({ maxunits: "5000", startmetal: "2000" });
  });

  it("never sends a section", () => {
    const out = effectiveOptions(
      [
        section("engine", "Engine Options"),
        opt("maxunits", { default: "5000" }),
      ],
      {},
    );
    expect(out).toEqual({ maxunits: "5000" });
  });

  it("skips an option with neither a value nor a default", () => {
    const out = effectiveOptions(
      [opt("mystery", { type: "string", default: undefined })],
      {},
    );
    expect(out).toEqual({});
  });

  it("sends an explicit empty override", () => {
    const out = effectiveOptions(
      [opt("note", { type: "string", default: "x" })],
      {
        note: "",
      },
    );
    expect(out).toEqual({ note: "" });
  });

  it("keeps a value the game never declared, which is how a scenario arms the runtime", () => {
    const out = effectiveOptions([opt("startmetal", { default: "1000" })], {
      coilbox_mission: "s1",
    });
    expect(out).toEqual({ startmetal: "1000", coilbox_mission: "s1" });
  });
});
