import { describe, expect, it } from "vitest";
import {
  mapDisplayName,
  mapFactsLabel,
  mapPlayersLabel,
  mapSizeLabel,
} from "./facts";
import type { MapFacts } from "./lookup";

function facts(over: Partial<MapFacts> = {}): MapFacts {
  return {
    slug: "isis",
    display_name: "Isis",
    description: null,
    authors: [],
    width_elmos: 6144,
    height_elmos: 10240,
    world_height_min: -50,
    world_height_max: 300,
    min_wind: null,
    max_wind: null,
    tidal_strength: null,
    void_water: null,
    water_coverage: null,
    tags: [],
    points: { start: [], metal: [], geo: [] },
    appearance: {},
    ...over,
  };
}

function starts(count: number) {
  return Array.from({ length: count }, (_, at) => ({
    x: at * 100,
    z: at * 100,
    y: null,
    meta: null,
  }));
}

describe("mapSizeLabel", () => {
  /// The unit players quote, which is elmos over 512: a 6144 by 10240 elmo map
  /// is a 12 by 20.
  it("says the size in the squares players count in", () => {
    expect(mapSizeLabel(facts())).toBe("12 × 20");
  });

  it("says nothing for a map the hub does not know", () => {
    expect(mapSizeLabel(null)).toBeNull();
    expect(mapSizeLabel(undefined)).toBeNull();
  });

  it("says nothing rather than zero for a map with no extent", () => {
    expect(mapSizeLabel(facts({ width_elmos: 0, height_elmos: 0 }))).toBeNull();
  });
});

describe("mapPlayersLabel", () => {
  /// The map's own answer: how many start positions it places.
  it("counts the start positions", () => {
    expect(
      mapPlayersLabel(
        facts({ points: { start: starts(8), metal: [], geo: [] } }),
      ),
    ).toBe("8 players");
    expect(
      mapPlayersLabel(
        facts({ points: { start: starts(1), metal: [], geo: [] } }),
      ),
    ).toBe("1 player");
  });

  /// Every map with no `mapinfo.lua` to place them in, which is twelve of this
  /// maintainer's hundred.
  it("says nothing for a map that places none", () => {
    expect(mapPlayersLabel(facts())).toBeNull();
    expect(mapPlayersLabel(null)).toBeNull();
  });
});

describe("mapFactsLabel", () => {
  it("joins what it can say", () => {
    expect(
      mapFactsLabel(
        facts({ points: { start: starts(4), metal: [], geo: [] } }),
      ),
    ).toBe("12 × 20 · 4 players");
  });

  it("says the size alone when there are no start positions", () => {
    expect(mapFactsLabel(facts())).toBe("12 × 20");
  });

  /// A map the hub has never heard of renders exactly as it does today: the
  /// name, and no caption under it.
  it("says nothing at all for a map the hub does not know", () => {
    expect(mapFactsLabel(null)).toBeNull();
  });
});

describe("mapDisplayName", () => {
  it("prefers the hub's spelling over the spring name", () => {
    expect(mapDisplayName(facts())).toBe("Isis");
  });

  it("leaves the fallback to the caller", () => {
    expect(mapDisplayName(facts({ display_name: null }))).toBeNull();
    expect(mapDisplayName(facts({ display_name: "  " }))).toBeNull();
    expect(mapDisplayName(null)).toBeNull();
  });
});
