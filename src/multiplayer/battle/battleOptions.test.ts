import { describe, expect, it } from "vitest";
import type { ConfigOption } from "@/content/bindings";
import {
  changedCount,
  displayedValue,
  missingOptionTags,
  optionValue,
  rawOptionEntries,
  reconcilePending,
  scriptTagKey,
  staleMapOptionTags,
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
describe("missingOptionTags for a game", () => {
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
    expect(missingOptionTags("mod", schema, {})).toEqual({
      "game/modoptions/maxunits": "5000",
      "game/modoptions/fixedallies": "0",
      "game/modoptions/maxspeed": "1",
    });
  });

  it("never overwrites a value the host or a preset already set", () => {
    expect(
      missingOptionTags("mod", schema, { "game/modoptions/maxunits": "500" }),
    ).toEqual({
      "game/modoptions/fixedallies": "0",
      "game/modoptions/maxspeed": "1",
    });
  });

  it("treats a tag SPADS lowercased as already set", () => {
    expect(
      missingOptionTags("mod", schema, { "GAME/MODOPTIONS/MaxUnits": "500" }),
    ).not.toHaveProperty("game/modoptions/maxunits");
  });

  it("is empty once every option has a tag, so filling settles", () => {
    const filled = missingOptionTags("mod", schema, {});
    expect(missingOptionTags("mod", schema, filled)).toEqual({});
  });

  it("skips sections and any option the game declares no default for", () => {
    expect(
      missingOptionTags(
        "mod",
        [
          { key: "presets", name: "Presets", type: "section" },
          opt({ key: "tweakdefs", type: "string", default: undefined }),
        ],
        {},
      ),
    ).toEqual({});
  });

  it("answers nothing when the game's option list has not loaded", () => {
    expect(missingOptionTags("mod", [], {})).toEqual({});
  });

  it("leaves map options and unit restrictions alone", () => {
    expect(
      missingOptionTags("mod", schema, {
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

/**
 * The bug this guards against (#1868): a battle coilbox hosts published no map
 * options at all, so a map's own declared defaults never reached the script.
 * `Spring.GetMapOptions()` hands game Lua exactly the script's section and the
 * engine substitutes nothing for a missing key, so the map's Lua reads `nil`.
 *
 * Real defaults, read from unitsync: BlockFort v1 wants fog on and an extractor
 * radius of 100, and airport 0.6 declares the same `fog` key and wants it off.
 * Two maps sharing a generic key with opposite defaults is the ordinary case,
 * which is why a map change has to clear the previous map's tags rather than
 * fill around them.
 */
describe("map options across a map change", () => {
  const blockfort: ConfigOption[] = [
    { key: "atmosphere", name: "Atmosphere Settings", type: "section" },
    opt({ key: "fog", type: "bool", default: "1", section: "atmosphere" }),
    opt({ key: "extractorradius", default: "100" }),
  ];
  const airport: ConfigOption[] = [
    opt({ key: "fog", type: "bool", default: "0" }),
    opt({ key: "timeofday", type: "list", default: "day" }),
  ];

  it("offers the map's own declared defaults", () => {
    expect(missingOptionTags("map", blockfort, {})).toEqual({
      "game/mapoptions/fog": "1",
      "game/mapoptions/extractorradius": "100",
    });
  });

  it("names a key the new map does not declare as the old map's to clear", () => {
    const seeded = missingOptionTags("map", airport, {});
    expect(staleMapOptionTags(blockfort, seeded)).toEqual([
      "game/mapoptions/timeofday",
    ]);
  });

  it("leaves a shared key to be overwritten rather than removed", () => {
    // `fog` is declared by both, so clearing it would blank the room between the
    // remove and the set. The new map's default is written over it instead.
    const seeded = missingOptionTags("map", airport, {});
    expect(staleMapOptionTags(blockfort, seeded)).not.toContain(
      "game/mapoptions/fog",
    );
    expect(missingOptionTags("map", blockfort, {})).toHaveProperty(
      "game/mapoptions/fog",
      "1",
    );
  });

  it("leaves mod options and unit restrictions alone", () => {
    expect(
      staleMapOptionTags(blockfort, {
        "game/modoptions/maxunits": "5000",
        "game/restrict/unit0": "corbhmth",
        "game/startpostype": "2",
      }),
    ).toEqual([]);
  });

  it("clears every map option when the new map declares none", () => {
    expect(staleMapOptionTags([], { "game/mapoptions/dry": "0" })).toEqual([
      "game/mapoptions/dry",
    ]);
  });

  it("matches a tag SPADS lowercased", () => {
    expect(
      staleMapOptionTags(airport, { "GAME/MAPOPTIONS/ExtractorRadius": "100" }),
    ).toEqual(["GAME/MAPOPTIONS/ExtractorRadius"]);
  });
});
