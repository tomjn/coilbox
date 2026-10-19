import { describe, expect, it } from "vitest";
import { LIBRARY_MAPS_INPUT, mapFacts } from "./fixtures/libraryMaps";
import { buildLibrary } from "./library";
import {
  isMapOnDisk,
  mapCaption,
  mapInstallRequest,
  mapPlayTypes,
  mapSquares,
  matchesMapScope,
  matchesMapSearch,
  matchesPlayType,
} from "./libraryMaps";

const { maps } = buildLibrary(LIBRARY_MAPS_INPUT);
const byId = (id: string) => {
  const m = maps.find((r) => r.id === id);
  if (!m) throw new Error(`no record ${id}`);
  return m;
};

describe("mapPlayTypes", () => {
  it("reads two starts as 1v1 and four or more as team", () => {
    expect([...mapPlayTypes(mapFacts(2))]).toEqual(["1v1"]);
    expect([...mapPlayTypes(mapFacts(3))]).toEqual([]);
    expect([...mapPlayTypes(mapFacts(4))]).toEqual(["team"]);
    expect([...mapPlayTypes(mapFacts(16))]).toEqual(["team"]);
    expect([...mapPlayTypes(mapFacts(0))]).toEqual([]);
  });

  it("takes 1v1 and water from the hub's tags", () => {
    expect([...mapPlayTypes(mapFacts(6, ["1v1"]))].sort()).toEqual([
      "1v1",
      "team",
    ]);
    expect([...mapPlayTypes(mapFacts(0, ["water map", "windy"]))]).toEqual([
      "water",
    ]);
    // A void map has no sea, and tidal needs only a puddle.
    expect([...mapPlayTypes(mapFacts(0, ["void map", "tidal"]))]).toEqual([]);
  });
});

describe("chip filters", () => {
  it("filter by start count and tag, and show nothing the hub has not answered", () => {
    const duel = mapFacts(2);
    const sea = mapFacts(8, ["water map"]);
    expect(matchesPlayType(duel, "1v1")).toBe(true);
    expect(matchesPlayType(duel, "team")).toBe(false);
    expect(matchesPlayType(duel, "water")).toBe(false);
    expect(matchesPlayType(sea, "team")).toBe(true);
    expect(matchesPlayType(sea, "water")).toBe(true);
    expect(matchesPlayType(undefined, "1v1")).toBe(false);
  });

  it("narrow to what is on disk under My Maps, and the rest under New Maps", () => {
    const installed = maps.filter((m) => matchesMapScope(m, "installed"));
    expect(installed.map((m) => m.id)).toEqual([
      "Comet Catcher Redux",
      "my_test_map v3",
    ]);
    expect(
      maps.filter((m) => matchesMapScope(m, "notInstalled")).map((m) => m.id),
    ).toEqual(["Isis", "Supreme Isthmus v2"]);
    expect(isMapOnDisk(byId("Isis"))).toBe(false);
  });

  it("search the name and every source's file name", () => {
    expect(matchesMapSearch(byId("Supreme Isthmus v2"), "isthmus")).toBe(true);
    expect(matchesMapSearch(byId("Supreme Isthmus v2"), "_v2.sd7")).toBe(true);
    expect(matchesMapSearch(byId("Isis"), "comet")).toBe(false);
  });
});

describe("mapCaption", () => {
  it("gives size, starts and both sources of an installed map", () => {
    const m = byId("Comet Catcher Redux");
    const squares = mapSquares(m, undefined, undefined);
    expect(squares).toEqual({ width: 12, height: 12 });
    expect(mapCaption(m, squares, mapFacts(8))).toBe(
      "12 × 12 · 8 starts · springfiles · hakora",
    );
  });

  it("says a local map is on no mirror", () => {
    const m = byId("my_test_map v3");
    expect(mapCaption(m, mapSquares(m, undefined, undefined), undefined)).toBe(
      "12 × 12 · not on any mirror",
    );
  });

  it("gives a queued map's source and size", () => {
    expect(mapCaption(byId("Isis"), null, undefined)).toBe(
      "springfiles · 14 MB",
    );
  });

  it("falls back to the springfiles size, then the hub's", () => {
    const m = byId("Supreme Isthmus v2");
    expect(mapSquares(m, undefined, undefined)).toEqual({
      width: 20,
      height: 20,
    });
    const bare = { ...m, sources: [] };
    expect(mapSquares(bare, undefined, mapFacts(2))).toEqual({
      width: 20,
      height: 20,
    });
  });
});

describe("mapInstallRequest", () => {
  it("walks every mirror by name for a map a mirror index lists", () => {
    expect(mapInstallRequest(byId("Supreme Isthmus v2"), "/data")).toEqual({
      kind: "mapAnySource",
      label: "Supreme Isthmus v2",
      sizeBytes: 14 * 1024 * 1024,
      args: { mapName: "Supreme Isthmus v2", writePath: "/data" },
    });
  });

  it("fetches a map only a GitHub repo carries from its release", () => {
    const m = {
      ...byId("Supreme Isthmus v2"),
      sources: [
        {
          kind: "github" as const,
          repo: "FluidPlay/TAP-maps",
          filename: "tap_map.sd7",
          url: "https://github.example/tap_map.sd7",
          size: 300,
          installed: false,
        },
      ],
    };
    expect(mapInstallRequest(m, "/data")).toEqual({
      kind: "file",
      label: "Supreme Isthmus v2",
      sizeBytes: 300,
      args: {
        url: "https://github.example/tap_map.sd7",
        destDir: "/data/maps",
        filename: "tap_map.sd7",
      },
    });
  });

  it("has nothing to fetch for a map with no source", () => {
    expect(mapInstallRequest(byId("my_test_map v3"), "/data")).toBeNull();
  });
});
