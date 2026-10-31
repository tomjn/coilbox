import { describe, expect, it } from "vitest";
import {
  missingForLoad,
  otherInstalledVersions,
  presetLoadRequirements,
  takenOptionKeys,
  withoutGame,
} from "./presetLoad";
import { ALL_PARTS, type PresetSelection } from "./presetParts";

const preset = { gameName: "Game 2.0", mapName: "Far Map" };
const only = (...parts: PresetSelection["parts"]): PresetSelection => ({
  ...ALL_PARTS,
  parts,
});

describe("presetLoadRequirements", () => {
  it("asks for the game and the map when both are taken", () => {
    expect(
      presetLoadRequirements(preset, ALL_PARTS).map((r) => [r.kind, r.label]),
    ).toEqual([
      ["game", "Game 2.0"],
      ["map", "Far Map"],
    ]);
  });

  it("makes no check for a map nobody takes", () => {
    expect(
      presetLoadRequirements(preset, only("game", "modOptions")).map(
        (r) => r.kind,
      ),
    ).toEqual(["game"]);
  });

  it("makes no check for a game the setup stays on", () => {
    expect(
      presetLoadRequirements(preset, only("map")).map((r) => r.kind),
    ).toEqual(["map"]);
  });
});

describe("missingForLoad", () => {
  it("is empty when everything is installed", () => {
    expect(
      missingForLoad(preset, ALL_PARTS, {
        games: ["Game 2.0"],
        maps: ["Far Map"],
      }),
    ).toEqual([]);
  });

  it("names what is missing", () => {
    expect(
      missingForLoad(preset, ALL_PARTS, { games: ["Game 1.0"], maps: [] }).map(
        (r) => r.label,
      ),
    ).toEqual(["Game 2.0", "Far Map"]);
  });
});

describe("otherInstalledVersions", () => {
  it("finds other versions of the same game and no other game", () => {
    expect(
      otherInstalledVersions("Game 2.0", [
        "Game 1.0",
        "Game 2.0",
        "Game Reloaded 1.0",
        "Other 2.0",
      ]),
    ).toEqual(["Game 1.0"]);
  });
});

describe("withoutGame", () => {
  it("drops the game and the parts keyed by it", () => {
    expect(withoutGame(ALL_PARTS).parts).toEqual(
      ALL_PARTS.parts.filter(
        (p) =>
          !["game", "modOptions", "tweakSlots", "restrictions"].includes(p),
      ),
    );
  });
});

describe("takenOptionKeys", () => {
  it("returns the plain and tweak keys the selection takes", () => {
    const values = { maxunits: "1", tweakdefs: "x" };
    expect(takenOptionKeys(values, only("modOptions"))).toEqual(["maxunits"]);
    expect(takenOptionKeys(values, only("tweakSlots"))).toEqual(["tweakdefs"]);
    expect(takenOptionKeys(values, ALL_PARTS)).toEqual([
      "maxunits",
      "tweakdefs",
    ]);
  });
});
