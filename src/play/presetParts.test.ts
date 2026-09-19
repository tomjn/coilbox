import { describe, expect, it } from "vitest";
import type { SkirmishDraft } from "./drafts";
import type { Participant } from "./participants";
import {
  ALL_PARTS,
  applySelection,
  PRESET_PARTS,
  type PresetSelection,
  partSummary,
} from "./presetParts";

function participant(id: string, allyTeam: number, ai?: string): Participant {
  return {
    id,
    kind: ai ? "ai" : "you",
    name: ai ?? "You",
    ...(ai ? { ai: { shortName: ai, kind: "native" as const } } : {}),
    side: "arm",
    color: [0.5, 0.5, 0.5],
    allyTeam,
    spectator: false,
  };
}

/** What the user already has on screen. Differs from `preset` in every part. */
const current: SkirmishDraft = {
  participants: [participant("c0", 0), participant("c1", 1, "NullAI")],
  gameName: "Current Game 1.0",
  mapName: "Current Map",
  startPosType: 0,
  startRects: { "0": { left: 0, top: 0, right: 50, bottom: 200 } },
  modOptionValues: { maxunits: "1000", onlykept: "yes", tweakdefs: "CURRENT" },
  mapOptionValues: { fog: "0" },
  restrictions: { disabledUnits: ["armcom"] },
};

/** The shared preset being applied. */
const preset: SkirmishDraft = {
  participants: [
    participant("p0", 0),
    participant("p1", 1, "BARb"),
    participant("p2", 1, "BARb"),
  ],
  gameName: "Preset Game 2.0",
  mapName: "Preset Map",
  startPosType: 2,
  startRects: { "0": { left: 0, top: 0, right: 100, bottom: 100 } },
  modOptionValues: { maxunits: "8000", tweakunits3: "PRESET" },
  mapOptionValues: { fog: "1", waterlevel: "20" },
  restrictions: { advantage: 0.2 },
};

const select = (over: Partial<PresetSelection> = {}): PresetSelection => ({
  parts: [],
  modOptions: "replace",
  tweakSlots: "replace",
  ...over,
});

describe("applySelection", () => {
  it("returns the preset unchanged when every part is taken", () => {
    // The partition property: the parts cover SkirmishDraft exactly, so taking
    // all of them must equal a wholesale load. This is what makes the existing
    // behaviour a special case of the new code rather than a branch beside it.
    expect(applySelection(current, preset, ALL_PARTS)).toEqual(preset);
  });

  it("returns the current draft unchanged when no part is taken", () => {
    expect(applySelection(current, preset, select())).toEqual(current);
  });

  it("covers every field of the draft across the parts", () => {
    // Guards against a field being added to SkirmishDraft without being
    // assigned to a part, which would silently never transfer.
    const keys = Object.keys(preset).sort();
    expect(
      Object.keys(applySelection(current, preset, ALL_PARTS)).sort(),
    ).toEqual(keys);
  });

  it("takes the game alone", () => {
    const out = applySelection(current, preset, select({ parts: ["game"] }));
    expect(out.gameName).toBe("Preset Game 2.0");
    expect(out.mapName).toBe("Current Map");
    expect(out.participants).toEqual(current.participants);
    // The options do not survive, because the game changed under them. Covered
    // in its own right below.
  });

  it("takes the map alone", () => {
    const out = applySelection(current, preset, select({ parts: ["map"] }));
    expect(out.mapName).toBe("Preset Map");
    expect(out.gameName).toBe("Current Game 1.0");
    expect(out.startPosType).toBe(0);
  });

  it("takes the start-pos type and boxes together", () => {
    const out = applySelection(
      current,
      preset,
      select({ parts: ["startPositions"] }),
    );
    expect(out.startPosType).toBe(2);
    expect(out.startRects).toEqual(preset.startRects);
    expect(out.mapName).toBe("Current Map");
  });

  it("takes the teams alone", () => {
    const out = applySelection(current, preset, select({ parts: ["teams"] }));
    expect(out.participants).toEqual(preset.participants);
    expect(out.gameName).toBe("Current Game 1.0");
  });

  it("takes the restrictions alone", () => {
    const out = applySelection(
      current,
      preset,
      select({ parts: ["restrictions"] }),
    );
    expect(out.restrictions).toEqual({ advantage: 0.2 });
    expect(out.participants).toEqual(current.participants);
  });

  it("replaces the plain mod options and leaves the tweak slots alone", () => {
    const out = applySelection(
      current,
      preset,
      select({ parts: ["modOptions"], modOptions: "replace" }),
    );
    // `onlykept` is dropped because replace means the preset's set is the set.
    // `tweakdefs` survives because it belongs to the tweakSlots part, which was
    // not taken.
    expect(out.modOptionValues).toEqual({
      maxunits: "8000",
      tweakdefs: "CURRENT",
    });
  });

  it("overlays the plain mod options, keeping keys the preset does not set", () => {
    const out = applySelection(
      current,
      preset,
      select({ parts: ["modOptions"], modOptions: "overlay" }),
    );
    expect(out.modOptionValues).toEqual({
      maxunits: "8000",
      onlykept: "yes",
      tweakdefs: "CURRENT",
    });
  });

  it("replaces the tweak slots and leaves the plain mod options alone", () => {
    const out = applySelection(
      current,
      preset,
      select({ parts: ["tweakSlots"], tweakSlots: "replace" }),
    );
    // The current `tweakdefs` goes because replace means the preset's slots are
    // the slots. `maxunits` and `onlykept` are untouched.
    expect(out.modOptionValues).toEqual({
      maxunits: "1000",
      onlykept: "yes",
      tweakunits3: "PRESET",
    });
  });

  it("overlays the tweak slots, keeping a slot the preset does not set", () => {
    const out = applySelection(
      current,
      preset,
      select({ parts: ["tweakSlots"], tweakSlots: "overlay" }),
    );
    expect(out.modOptionValues).toEqual({
      maxunits: "1000",
      onlykept: "yes",
      tweakdefs: "CURRENT",
      tweakunits3: "PRESET",
    });
  });

  it("merges the two option parts independently when both are taken", () => {
    const out = applySelection(
      current,
      preset,
      select({
        parts: ["modOptions", "tweakSlots"],
        modOptions: "overlay",
        tweakSlots: "replace",
      }),
    );
    expect(out.modOptionValues).toEqual({
      maxunits: "8000",
      onlykept: "yes",
      tweakunits3: "PRESET",
    });
  });

  it("clears an untaken option group when the game changes under it", () => {
    // Option keys are declared by the game, so keeping the old game's values
    // would carry keys the new game never declared.
    const out = applySelection(current, preset, select({ parts: ["game"] }));
    expect(out.gameName).toBe("Preset Game 2.0");
    expect(out.modOptionValues).toEqual({});
    expect(out.restrictions).toBeUndefined();
  });

  it("keeps an untaken option group when the game stays put", () => {
    const sameGame: SkirmishDraft = { ...preset, gameName: current.gameName };
    const out = applySelection(current, sameGame, select({ parts: ["game"] }));
    expect(out.modOptionValues).toEqual(current.modOptionValues);
    expect(out.restrictions).toEqual(current.restrictions);
  });

  it("still takes the options it was asked for across a game change", () => {
    const out = applySelection(
      current,
      preset,
      select({ parts: ["game", "modOptions", "tweakSlots"] }),
    );
    expect(out.modOptionValues).toEqual(preset.modOptionValues);
  });

  it("takes the map options alone, leaving the mod options", () => {
    const out = applySelection(
      current,
      preset,
      select({ parts: ["mapOptions"] }),
    );
    expect(out.mapOptionValues).toEqual({ fog: "1", waterlevel: "20" });
    expect(out.modOptionValues).toEqual(current.modOptionValues);
  });

  it("clears the map options when the map changes under them", () => {
    // Map option keys are declared by the map, and two maps sharing a key want
    // opposite things by it, so carrying the old map's values is worse than
    // dropping them.
    const out = applySelection(current, preset, select({ parts: ["map"] }));
    expect(out.mapName).toBe("Preset Map");
    expect(out.mapOptionValues).toEqual({});
  });

  it("keeps the map options when the map stays put", () => {
    const sameMap: SkirmishDraft = { ...preset, mapName: current.mapName };
    const out = applySelection(current, sameMap, select({ parts: ["map"] }));
    expect(out.mapOptionValues).toEqual(current.mapOptionValues);
  });

  it("still takes the map options it was asked for across a map change", () => {
    const out = applySelection(
      current,
      preset,
      select({ parts: ["map", "mapOptions"] }),
    );
    expect(out.mapOptionValues).toEqual(preset.mapOptionValues);
  });

  it("drops the boxes when the preset has none and start positions are taken", () => {
    const boxless: SkirmishDraft = { ...preset, startRects: undefined };
    const out = applySelection(
      current,
      boxless,
      select({ parts: ["startPositions"] }),
    );
    expect(out.startRects).toBeUndefined();
  });
});

describe("PRESET_PARTS", () => {
  it("lists the eight parts in picker order", () => {
    expect(PRESET_PARTS).toEqual([
      "game",
      "map",
      "startPositions",
      "modOptions",
      "tweakSlots",
      "mapOptions",
      "teams",
      "restrictions",
    ]);
  });

  it("takes every part by default, replacing rather than overlaying", () => {
    // Overlay as the default would break the partition property above, because
    // a key the current draft sets and the preset does not would survive a
    // full load that today wipes it.
    expect(ALL_PARTS).toEqual({
      parts: PRESET_PARTS,
      modOptions: "replace",
      tweakSlots: "replace",
    });
  });
});

describe("partSummary", () => {
  it("names the map and counts each option group", () => {
    expect(partSummary(preset, "map")).toBe("Preset Map");
    expect(partSummary(preset, "game")).toBe("Preset Game 2.0");
    expect(partSummary(preset, "modOptions")).toBe("1 option");
    expect(partSummary(preset, "mapOptions")).toBe("2 map options");
    expect(partSummary(preset, "tweakSlots")).toBe("1 tweak slot");
  });

  it("counts the roster as allies and bots", () => {
    expect(partSummary(preset, "teams")).toBe("3 players, 2 bots");
  });

  it("describes the start positions by mode", () => {
    expect(partSummary(preset, "startPositions")).toBe("Choose in-game, 1 box");
    expect(partSummary({ ...preset, startPosType: 0 }, "startPositions")).toBe(
      "Fixed map positions",
    );
  });

  it("returns null for a part the preset carries nothing for", () => {
    const bare: SkirmishDraft = {
      participants: [],
      gameName: "G",
      mapName: "M",
      startPosType: 0,
      modOptionValues: {},
    };
    expect(partSummary(bare, "modOptions")).toBeNull();
    expect(partSummary(bare, "mapOptions")).toBeNull();
    expect(partSummary(bare, "tweakSlots")).toBeNull();
    expect(partSummary(bare, "restrictions")).toBeNull();
    expect(partSummary(bare, "teams")).toBeNull();
  });
});
