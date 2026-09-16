import { describe, expect, it } from "vitest";
import type { MapItem } from "@/content/bindings";
import { matchMapSuggestion } from "./mapSuggestion";

function map(name: string): MapItem {
  return { name, archives: [], info: {} };
}

const maps = [
  map("Comet Catcher Remake"),
  map("Comet Catcher Redux"),
  map("DeltaSiegeDry"),
];

describe("matchMapSuggestion", () => {
  it("finds a single unambiguous match by partial name", () => {
    expect(matchMapSuggestion("!map deltasiege", maps)).toEqual({
      query: "deltasiege",
      matches: ["DeltaSiegeDry"],
    });
  });

  it("matches case-insensitively", () => {
    expect(matchMapSuggestion("!map DELTASIEGEDRY", maps)).toEqual({
      query: "DELTASIEGEDRY",
      matches: ["DeltaSiegeDry"],
    });
  });

  it("lists every installed map that matches an ambiguous partial name", () => {
    expect(matchMapSuggestion("!map comet", maps)).toEqual({
      query: "comet",
      matches: ["Comet Catcher Remake", "Comet Catcher Redux"],
    });
  });

  it("reports no matches for a name nothing installed has", () => {
    expect(matchMapSuggestion("!map nonexistentmap", maps)).toEqual({
      query: "nonexistentmap",
      matches: [],
    });
  });

  it("de-dupes a map name that appears more than once in the list", () => {
    const dupes = [map("DeltaSiegeDry"), map("DeltaSiegeDry")];
    expect(matchMapSuggestion("!map delta", dupes)).toEqual({
      query: "delta",
      matches: ["DeltaSiegeDry"],
    });
  });

  it("ignores a command that isn't !map", () => {
    expect(matchMapSuggestion("!balance", maps)).toBeNull();
    expect(matchMapSuggestion("!lock", maps)).toBeNull();
  });

  it("ignores !map with no name after it", () => {
    expect(matchMapSuggestion("!map", maps)).toBeNull();
    expect(matchMapSuggestion("!map   ", maps)).toBeNull();
  });

  it("ignores plain chat text", () => {
    expect(
      matchMapSuggestion("has anyone got a good 1v1 map?", maps),
    ).toBeNull();
  });
});
