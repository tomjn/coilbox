import { describe, expect, it } from "vitest";
import type { ConfigOption } from "@/content/bindings";
import {
  changedCount,
  displayedValue,
  missingModOptionTags,
  optionValue,
  rawOptionEntries,
  reconcilePending,
  scriptTagKey,
} from "./battleOptions";

const opt = (over: Partial<ConfigOption> = {}): ConfigOption => ({
  key: "maxunits",
  name: "Max units",
  default: "1000",
  type: "number",
  ...over,
});

describe("battleOptions", () => {
  it("builds scoped script-tag keys", () => {
    expect(scriptTagKey("mod", "maxunits")).toBe("game/modoptions/maxunits");
    expect(scriptTagKey("map", "waterlevel")).toBe(
      "game/mapoptions/waterlevel",
    );
  });

  it("resolves option values case-insensitively", () => {
    const tags = { "GAME/MODOPTIONS/MaxUnits": "2000" };
    expect(optionValue(tags, "mod", "maxunits")).toBe("2000");
    expect(optionValue(tags, "mod", "missing")).toBeUndefined();
  });

  it("counts options changed from default", () => {
    const tags = { "game/modoptions/maxunits": "2000" };
    expect(changedCount([opt()], tags, "mod")).toBe(1);
    expect(
      changedCount([opt()], { "game/modoptions/maxunits": "1000" }, "mod"),
    ).toBe(0);
  });

  it("extracts raw entries for a scope", () => {
    const tags = {
      "game/modoptions/a": "1",
      "game/mapoptions/b": "2",
      "game/startpostype": "2",
    };
    expect(rawOptionEntries(tags, "mod")).toEqual([{ key: "a", value: "1" }]);
  });

  it("keeps pending until an echo changes the confirmed value", () => {
    const pending = {
      "game/modoptions/maxunits": { target: "2000", prev: "1000" },
    };
    // No echo yet: confirmed still equals prev -> stays pending.
    expect(
      reconcilePending(pending, { "game/modoptions/maxunits": "1000" }),
    ).toEqual(pending);
    // Echo arrives (value changed): resolved -> dropped.
    expect(
      reconcilePending(pending, { "game/modoptions/maxunits": "2000" }),
    ).toEqual({});
  });

  it("shows the pending target over the confirmed value", () => {
    const pending = {
      "game/modoptions/maxunits": { target: "2000", prev: "1000" },
    };
    const tags = { "game/modoptions/maxunits": "1000" };
    expect(displayedValue(pending, tags, "mod", "maxunits")).toBe("2000");
    expect(displayedValue({}, tags, "mod", "maxunits")).toBe("1000");
    expect(displayedValue({}, {}, "mod", "maxunits")).toBeUndefined();
  });
});

/**
 * The bug this guards against (#1837): a battle coilbox hosts published only the
 * options somebody had changed, so the engine substituted its own built-in
 * values for the rest and the match played nothing like the game intends.
 * SplinterFaction 0.1.80 asks for 5000 units, unlocked allies and a speed cap of
 * 1, and got 32000, locked, and 20.
 */
describe("missingModOptionTags", () => {
  // The three the issue names, at SplinterFaction 0.1.80's real defaults.
  const schema: ConfigOption[] = [
    { key: "engineoptions", name: "Engine options", type: "section" },
    opt({ key: "maxunits", default: "5000", section: "engineoptions" }),
    opt({
      key: "fixedallies",
      name: "Fixed ingame alliances",
      type: "bool",
      default: "0",
      section: "engineoptions",
    }),
    opt({
      key: "maxspeed",
      name: "Maximum game speed",
      default: "1",
      section: "limitspeed",
    }),
  ];

  it("offers every declared default a fresh hosted battle is missing", () => {
    expect(missingModOptionTags(schema, {})).toEqual({
      "game/modoptions/maxunits": "5000",
      "game/modoptions/fixedallies": "0",
      "game/modoptions/maxspeed": "1",
    });
  });

  it("never overwrites a value the host or a preset already set", () => {
    expect(
      missingModOptionTags(schema, { "game/modoptions/maxunits": "500" }),
    ).toEqual({
      "game/modoptions/fixedallies": "0",
      "game/modoptions/maxspeed": "1",
    });
  });

  it("treats a tag SPADS lowercased as already set", () => {
    expect(
      missingModOptionTags(schema, { "GAME/MODOPTIONS/MaxUnits": "500" }),
    ).not.toHaveProperty("game/modoptions/maxunits");
  });

  it("is empty once every option has a tag, so filling settles", () => {
    const filled = missingModOptionTags(schema, {});
    expect(missingModOptionTags(schema, filled)).toEqual({});
  });

  it("skips sections and any option the game declares no default for", () => {
    expect(
      missingModOptionTags(
        [
          { key: "presets", name: "Presets", type: "section" },
          opt({ key: "tweakdefs", type: "string", default: undefined }),
        ],
        {},
      ),
    ).toEqual({});
  });

  it("answers nothing when the game's option list has not loaded", () => {
    expect(missingModOptionTags([], {})).toEqual({});
  });

  it("leaves map options and unit restrictions alone", () => {
    expect(
      missingModOptionTags(schema, {
        "game/mapoptions/waterlevel": "0",
        "game/restrict/unit0": "corbhmth",
      }),
    ).toEqual({
      "game/modoptions/maxunits": "5000",
      "game/modoptions/fixedallies": "0",
      "game/modoptions/maxspeed": "1",
    });
  });
});
