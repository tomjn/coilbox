import { describe, expect, it } from "vitest";
import type { ConfigOption } from "@/content/bindings";
import type { SkirmishDraft } from "./drafts";
import type { Participant } from "./participants";
import {
  type PresetFitFacts,
  presetFitWarnings,
  undeclaredOptions,
} from "./presetFit";
import { ALL_PARTS, type PresetSelection } from "./presetParts";

const declared = (...keys: string[]): ConfigOption[] =>
  keys.map((key) => ({ key, name: key }));

const member = (id: string, allyTeam: number): Participant => ({
  id,
  kind: "ai",
  name: id,
  side: "",
  color: [0.5, 0.5, 0.5],
  allyTeam,
  spectator: false,
});

const draft = (over: Partial<SkirmishDraft> = {}): SkirmishDraft => ({
  participants: [member("a", 0), member("b", 1)],
  gameName: "Game",
  mapName: "Map",
  startPosType: 0,
  modOptionValues: {},
  ...over,
});

const facts = (over: Partial<PresetFitFacts> = {}): PresetFitFacts => ({
  currentGameName: "Game",
  currentMapName: "Map",
  currentStartPosType: 0,
  modOptions: { current: declared("maxunits", "tweakdefs") },
  mapOptions: { current: declared("fog") },
  startPositions: { current: 4 },
  ...over,
});

const only = (...parts: PresetSelection["parts"]): PresetSelection => ({
  ...ALL_PARTS,
  parts,
});

describe("undeclaredOptions", () => {
  it("compares keys without regard to case", () => {
    expect(
      undeclaredOptions(["MaxUnits", "bogus"], declared("maxunits")),
    ).toEqual(["bogus"]);
  });

  it("flags nothing against a schema that is empty or absent", () => {
    expect(undeclaredOptions(["a"], [])).toEqual([]);
    expect(undeclaredOptions(["a"], undefined)).toEqual([]);
  });

  it("does not count a section as an option", () => {
    expect(
      undeclaredOptions(
        ["group"],
        [
          { key: "group", name: "Group", type: "section" },
          { key: "x", name: "x" },
        ],
      ),
    ).toEqual(["group"]);
  });
});

describe("presetFitWarnings", () => {
  it("names the mod options the game does not declare", () => {
    const warnings = presetFitWarnings(
      draft({ modOptionValues: { maxunits: "1", bogus: "1", odd: "2" } }),
      ALL_PARTS,
      facts(),
    );
    expect(warnings.modOptions).toBe("Game does not declare bogus, odd.");
  });

  it("names tweak slots separately from plain options", () => {
    const warnings = presetFitWarnings(
      draft({ modOptionValues: { tweakdefs: "x", tweakdefs9: "y" } }),
      ALL_PARTS,
      facts(),
    );
    expect(warnings.tweakSlots).toBe("Game does not declare tweakdefs9.");
    expect(warnings.modOptions).toBeUndefined();
  });

  it("shortens a long list of names", () => {
    const warnings = presetFitWarnings(
      draft({ modOptionValues: { a: "1", b: "1", c: "1", d: "1", e: "1" } }),
      ALL_PARTS,
      facts(),
    );
    expect(warnings.modOptions).toBe(
      "Game does not declare a, b, c and 2 more.",
    );
  });

  it("names the map options the map does not declare", () => {
    const warnings = presetFitWarnings(
      draft({ mapOptionValues: { fog: "1", wind: "2" } }),
      ALL_PARTS,
      facts(),
    );
    expect(warnings.mapOptions).toBe("Map does not declare wind.");
  });

  it("reads the preset's map when the map is taken, and the current one when not", () => {
    const f = facts({
      currentMapName: "Current",
      mapOptions: { current: declared("wind"), preset: declared("fog") },
    });
    const d = draft({ mapName: "Preset", mapOptionValues: { wind: "1" } });
    expect(presetFitWarnings(d, ALL_PARTS, f).mapOptions).toBe(
      "Preset does not declare wind.",
    );
    expect(
      presetFitWarnings(d, only("mapOptions"), f).mapOptions,
    ).toBeUndefined();
  });

  it("reads the preset's game when the game is taken", () => {
    const f = facts({
      currentGameName: "Current",
      modOptions: { current: declared("a"), preset: declared("b") },
    });
    const d = draft({ gameName: "Other", modOptionValues: { a: "1" } });
    expect(presetFitWarnings(d, ALL_PARTS, f).modOptions).toBe(
      "Other does not declare a.",
    );
  });

  it("warns when the roster has more teams than the map has start positions", () => {
    const warnings = presetFitWarnings(
      draft({
        participants: [member("a", 0), member("b", 1), member("c", 2)],
      }),
      ALL_PARTS,
      facts({ startPositions: { current: 2 } }),
    );
    expect(warnings.teams).toBe("3 teams, but Map has 2 start positions.");
  });

  it("uses the singular for one start position", () => {
    const warnings = presetFitWarnings(
      draft(),
      ALL_PARTS,
      facts({ startPositions: { current: 1 } }),
    );
    expect(warnings.teams).toBe("2 teams, but Map has 1 start position.");
  });

  it("does not warn about positions when the boxes decide where teams start", () => {
    const warnings = presetFitWarnings(
      draft({ startPosType: 2 }),
      ALL_PARTS,
      facts({ startPositions: { current: 1 } }),
    );
    expect(warnings.teams).toBeUndefined();
  });

  it("falls back to the current mode when the preset's start positions are left out", () => {
    const f = facts({ startPositions: { current: 1 } });
    expect(
      presetFitWarnings(draft({ startPosType: 2 }), only("teams"), f).teams,
    ).toBe("2 teams, but Map has 1 start position.");
  });

  it("counts the preset's map when it is taken", () => {
    const f = facts({
      currentMapName: "Current",
      startPositions: { current: 8, preset: 1 },
    });
    expect(
      presetFitWarnings(draft({ mapName: "Tiny" }), ALL_PARTS, f).teams,
    ).toBe("2 teams, but Tiny has 1 start position.");
  });

  it("has nothing to say about a preset that fits", () => {
    expect(
      presetFitWarnings(
        draft({
          modOptionValues: { maxunits: "1", tweakdefs: "x" },
          mapOptionValues: { fog: "1" },
        }),
        ALL_PARTS,
        facts(),
      ),
    ).toEqual({});
  });

  it("says nothing before the game and map have been read", () => {
    expect(
      presetFitWarnings(
        draft({
          modOptionValues: { bogus: "1" },
          mapOptionValues: { bogus: "1" },
        }),
        ALL_PARTS,
        facts({
          modOptions: {},
          mapOptions: {},
          startPositions: {},
        }),
      ),
    ).toEqual({});
  });

  it("says nothing about a part that is not taken", () => {
    expect(
      presetFitWarnings(
        draft({ modOptionValues: { bogus: "1" } }),
        only("map"),
        facts(),
      ),
    ).toEqual({});
  });
});
