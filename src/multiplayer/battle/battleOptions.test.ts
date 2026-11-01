import { describe, expect, it } from "vitest";
import type { ConfigOption } from "@/content/bindings";
import type { PresetSelection } from "@/play/presetParts";
import {
  changedCount,
  displayedValue,
  filterOptionTags,
  mapOptionTags,
  optionTagRefusal,
  optionTagsRefusal,
  optionValue,
  rawOptionEntries,
  reconcilePending,
  resetEdits,
  scriptTagKey,
  tweakSetEntries,
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

  it("does not count a default the server spelled differently", () => {
    expect(
      changedCount([opt()], { "game/modoptions/maxunits": "1000.0" }, "mod"),
    ).toBe(0);
    const flag = opt({ key: "fixedallies", type: "bool", default: "1" });
    expect(
      changedCount([flag], { "game/modoptions/fixedallies": "true" }, "mod"),
    ).toBe(0);
  });

  it("counts an edit in flight over the confirmed value", () => {
    const tags = { "game/modoptions/maxunits": "1000" };
    const pending = {
      "game/modoptions/maxunits": { target: "2000", prev: "1000" },
    };
    expect(changedCount([opt()], tags, "mod", pending)).toBe(1);
  });

  it("does not count a server value for an option the game does not declare", () => {
    expect(
      changedCount([opt()], { "game/modoptions/unknown": "9" }, "mod"),
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

describe("tweakSetEntries", () => {
  const schema: ConfigOption[] = [
    opt({ key: "maxunits", default: "1000" }),
    opt({ key: "tweakdefs", default: "" }),
    opt({ key: "tweakunits3", default: "" }),
  ];

  it("is empty for a battle that has set no tweak slot", () => {
    expect(tweakSetEntries(schema, {})).toEqual({});
    // A slot written empty, as a room seeded by an older coilbox holds, is still empty.
    expect(
      tweakSetEntries(schema, {
        "game/modoptions/tweakdefs": "",
        "game/modoptions/maxunits": "2000",
      }),
    ).toEqual({});
  });

  it("reads only the set tweak slots, keyed by their bare option name", () => {
    expect(
      tweakSetEntries(schema, {
        "game/modoptions/maxunits": "2000",
        "game/modoptions/tweakdefs": "QUJD",
      }),
    ).toEqual({ tweakdefs: "QUJD" });
  });

  it("matches a tag SPADS lowercased", () => {
    expect(
      tweakSetEntries(schema, { "GAME/MODOPTIONS/TweakDefs": "QUJD" }),
    ).toEqual({ tweakdefs: "QUJD" });
  });

  it("is empty when the game declares no tweak slots at all", () => {
    expect(
      tweakSetEntries([opt({ key: "maxunits", default: "1000" })], {
        "game/modoptions/maxunits": "2000",
      }),
    ).toEqual({});
  });
});

describe("mapOptionTags", () => {
  it("names every map option tag, whichever map declared it", () => {
    expect(
      mapOptionTags({
        "game/mapoptions/fog": "1",
        "game/mapoptions/timeofday": "day",
      }),
    ).toEqual(["game/mapoptions/fog", "game/mapoptions/timeofday"]);
  });

  it("leaves mod options and unit restrictions alone", () => {
    expect(
      mapOptionTags({
        "game/modoptions/maxunits": "5000",
        "game/restrict/unit0": "corbhmth",
        "game/startpostype": "2",
      }),
    ).toEqual([]);
  });

  it("matches a tag SPADS lowercased", () => {
    expect(mapOptionTags({ "GAME/MAPOPTIONS/ExtractorRadius": "100" })).toEqual(
      ["GAME/MAPOPTIONS/ExtractorRadius"],
    );
  });
});

describe("filterOptionTags", () => {
  // Every tag a host seed can carry: the start-pos type, mod options (some of
  // which are tweak slots) and the restrict block. `draftToHostSeed` builds
  // exactly these three kinds, so there are no map options here to cover.
  const seedTags = {
    "game/startpostype": "2",
    "game/modoptions/maxunits": "8000",
    "game/modoptions/tweakunits3": "PRESET",
    "game/restrict/numrestrictions": "1",
    "game/restrict/unit0": "armcom",
    "game/restrict/limit0": "0",
  };

  const sel = (over: Partial<PresetSelection> = {}): PresetSelection => ({
    parts: [],
    modOptions: "replace",
    tweakSlots: "replace",
    ...over,
  });

  it("keeps every tag when every part is taken", () => {
    expect(
      filterOptionTags(
        seedTags,
        sel({
          parts: ["startPositions", "modOptions", "tweakSlots", "restrictions"],
        }),
      ),
    ).toEqual(seedTags);
  });

  it("drops every tag when no part is taken", () => {
    expect(filterOptionTags(seedTags, sel())).toEqual({});
  });

  it("keeps the start-pos type only with the start positions part", () => {
    expect(
      filterOptionTags(seedTags, sel({ parts: ["startPositions"] })),
    ).toEqual({ "game/startpostype": "2" });
  });

  it("separates the tweak slots from the plain mod options", () => {
    expect(filterOptionTags(seedTags, sel({ parts: ["modOptions"] }))).toEqual({
      "game/modoptions/maxunits": "8000",
    });
    expect(filterOptionTags(seedTags, sel({ parts: ["tweakSlots"] }))).toEqual({
      "game/modoptions/tweakunits3": "PRESET",
    });
  });

  it("keeps the whole restrict block together", () => {
    expect(
      filterOptionTags(seedTags, sel({ parts: ["restrictions"] })),
    ).toEqual({
      "game/restrict/numrestrictions": "1",
      "game/restrict/unit0": "armcom",
      "game/restrict/limit0": "0",
    });
  });

  it("reads the tag prefix however it is capitalised", () => {
    expect(
      filterOptionTags(
        { "Game/ModOptions/MaxUnits": "8000" },
        sel({ parts: ["modOptions"] }),
      ),
    ).toEqual({ "Game/ModOptions/MaxUnits": "8000" });
  });

  it("keeps a tag that belongs to no part, having no claim to drop it", () => {
    expect(filterOptionTags({ "game/hostip": "1.2.3.4" }, sel())).toEqual({
      "game/hostip": "1.2.3.4",
    });
  });
});

describe("optionTagRefusal", () => {
  it("allows the tags a room really sends", () => {
    for (const [key, value] of [
      ["game/startpostype", "2"],
      ["game/modoptions/maxunits", "2000"],
      ["game/modoptions/MaxUnits", "2000"],
      ["game/mapoptions/fog_1", "a value, with = and spaces"],
      ["game/modoptions/tweakdefs3", "bHVh+/_-="],
      ["game/modoptions/empty", ""],
      ["game/restrict/unit0", "armcom"],
      ["game/restrict/numrestrictions", "1"],
    ]) {
      expect(optionTagRefusal(key, value)).toBeNull();
    }
  });

  it("refuses a value that would start another tag or end a script value", () => {
    const key = "game/modoptions/maxunits";
    expect(
      optionTagRefusal(key, "1\tgame/modoptions/tweakdefs=bHVh"),
    ).not.toBeNull();
    expect(optionTagRefusal(key, "1\nx")).not.toBeNull();
    expect(optionTagRefusal(key, "1\u0000x")).not.toBeNull();
    expect(optionTagRefusal(key, "1;x")).not.toBeNull();
  });

  it("refuses a key that would carry a tag of its own", () => {
    for (const key of [
      "game/modoptions/x\tgame/modoptions/tweakdefs",
      "game/modoptions/x=1",
      "game/modoptions/has space",
      "game/modoptions/",
      "game//modoptions",
      "",
    ]) {
      expect(optionTagRefusal(key, "1")).not.toBeNull();
    }
  });

  // The parts picker reads this as a mod option called `x/tweakdefs`, and the
  // `!bSet` route takes the last part of the key, so it would ask for `tweakdefs`.
  it("refuses a slash inside a scoped option's name", () => {
    expect(
      optionTagRefusal("game/modoptions/x/tweakdefs", "bHVh"),
    ).not.toBeNull();
    expect(
      optionTagRefusal("GAME/MAPOPTIONS/x/tweakdefs", "bHVh"),
    ).not.toBeNull();
  });
});

describe("optionTagsRefusal", () => {
  it("is null when every tag can be sent", () => {
    expect(optionTagsRefusal({ "game/modoptions/a": "1" })).toBeNull();
  });

  it("names the option it refuses", () => {
    expect(
      optionTagsRefusal({
        "game/modoptions/fine": "1",
        "game/modoptions/maxunits": "1\tx=y",
      }),
    ).toContain("maxunits");
  });
});

describe("resetEdits", () => {
  const a = opt({ key: "a", default: "1" });
  const b = opt({ key: "b", default: "5" });
  const flag = opt({ key: "flag", type: "bool", default: "1" });
  const note = opt({ key: "note", type: "string", default: undefined });
  const mapFog = opt({ key: "fog", type: "bool", default: "0" });

  it("gives nothing when nothing is changed", () => {
    expect(
      resetEdits([{ scope: "mod", options: [a, b] }], {
        "game/modoptions/a": "1",
      }),
    ).toEqual([]);
  });

  it("gives a write of the declared default for each changed option only", () => {
    expect(
      resetEdits([{ scope: "mod", options: [a, b, flag] }], {
        "game/modoptions/a": "2",
        "game/modoptions/b": "5",
        "game/modoptions/flag": "0",
      }),
    ).toEqual([
      { tagKey: "game/modoptions/a", spadsName: "a", value: "1" },
      { tagKey: "game/modoptions/flag", spadsName: "flag", value: "1" },
    ]);
  });

  it("writes the empty value for an option with no declared default", () => {
    expect(
      resetEdits([{ scope: "mod", options: [note] }], {
        "game/modoptions/note": "hello",
      }),
    ).toEqual([
      { tagKey: "game/modoptions/note", spadsName: "note", value: "" },
    ]);
  });

  it("covers only the options of the scope it is given", () => {
    const tags = {
      "game/modoptions/a": "2",
      "game/modoptions/b": "6",
    };
    expect(resetEdits([{ scope: "mod", options: [a] }], tags)).toHaveLength(1);
    expect(resetEdits([{ scope: "mod", options: [a, b] }], tags)).toHaveLength(
      2,
    );
  });

  it("covers both scopes of a tab and keeps each under its own tag prefix", () => {
    expect(
      resetEdits(
        [
          { scope: "map", options: [mapFog] },
          { scope: "mod", options: [a] },
        ],
        { "game/mapoptions/fog": "1", "game/modoptions/a": "2" },
      ).map((e) => e.tagKey),
    ).toEqual(["game/mapoptions/fog", "game/modoptions/a"]);
  });

  it("counts an edit in flight as the value to reset", () => {
    expect(
      resetEdits(
        [{ scope: "mod", options: [a] }],
        { "game/modoptions/a": "1" },
        { "game/modoptions/a": { target: "2", prev: "1" } },
      ),
    ).toEqual([{ tagKey: "game/modoptions/a", spadsName: "a", value: "1" }]);
  });

  it("skips an option whose edit in flight already puts it at the default", () => {
    expect(
      resetEdits(
        [{ scope: "mod", options: [a] }],
        { "game/modoptions/a": "2" },
        { "game/modoptions/a": { target: "1", prev: "2" } },
      ),
    ).toEqual([]);
  });

  it("leaves a section out", () => {
    const s = opt({ key: "s", type: "section" });
    expect(
      resetEdits([{ scope: "mod", options: [s] }], {
        "game/modoptions/s": "x",
      }),
    ).toEqual([]);
  });
});
