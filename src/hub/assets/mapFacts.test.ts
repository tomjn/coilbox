import { describe, expect, it } from "vitest";
import type { BarMap } from "@/downloads/bindings";
import { mapFactsLabel, mapPlayersLabel, mapSizeLabel } from "./mapFacts";

/** An entry with only the fields the caption reads, since the rest of a real one
 * is a page of URLs. */
function bar(fields: Partial<BarMap>): BarMap {
  return {
    springName: "Supreme Isthmus 1.2",
    displayName: "Supreme Isthmus",
    author: "Somebody",
    filename: "supreme_isthmus_1.2.sd7",
    ...fields,
  };
}

describe("mapSizeLabel", () => {
  it("says the size in the squares players quote", () => {
    expect(mapSizeLabel(bar({ mapWidth: 12, mapHeight: 20 }))).toBe("12 × 20");
  });

  it("says nothing for a map BAR gives no size for", () => {
    expect(mapSizeLabel(bar({ mapWidth: 12 }))).toBeNull();
    expect(mapSizeLabel(null)).toBeNull();
    expect(mapSizeLabel(undefined)).toBeNull();
  });
});

describe("mapPlayersLabel", () => {
  it("gives a range when the ends differ", () => {
    expect(
      mapPlayersLabel(bar({ playerCountMin: 2, playerCountMax: 16 })),
    ).toBe("2–16 players");
  });

  it("gives one number when the ends agree, or when only one end is listed", () => {
    expect(mapPlayersLabel(bar({ playerCountMin: 8, playerCountMax: 8 }))).toBe(
      "8 players",
    );
    expect(mapPlayersLabel(bar({ playerCountMax: 4 }))).toBe("4 players");
    expect(mapPlayersLabel(bar({ playerCountMin: 1 }))).toBe("1 player");
  });

  it("says nothing for a map BAR gives no count for", () => {
    expect(mapPlayersLabel(bar({}))).toBeNull();
    expect(mapPlayersLabel(null)).toBeNull();
  });
});

describe("mapFactsLabel", () => {
  it("joins what BAR knows into one line", () => {
    expect(
      mapFactsLabel(
        bar({
          mapWidth: 12,
          mapHeight: 20,
          playerCountMin: 2,
          playerCountMax: 16,
        }),
      ),
    ).toBe("12 × 20 · 2–16 players");
  });

  it("says whichever half it has", () => {
    expect(mapFactsLabel(bar({ mapWidth: 8, mapHeight: 8 }))).toBe("8 × 8");
    expect(mapFactsLabel(bar({ playerCountMax: 6 }))).toBe("6 players");
  });

  it("says nothing about a map BAR does not certify", () => {
    expect(mapFactsLabel(undefined)).toBeNull();
  });
});
