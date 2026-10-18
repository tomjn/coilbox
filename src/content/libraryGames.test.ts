import { describe, expect, it, vi } from "vitest";
import { LIBRARY_GAMES_INPUT } from "./fixtures/libraryGames";
import { buildLibrary, type LibraryGame } from "./library";
import {
  chipCounts,
  inGamesGrid,
  installRequest,
  matchesChip,
  matchesSearch,
  sortGames,
  sourceKinds,
  updateRequest,
} from "./libraryGames";

// A GitHub source would read a release list, and no test may reach a server.
vi.mock("../downloads/githubReleases", () => ({
  loadGithubReleases: async () => {
    throw new Error("no network in tests");
  },
}));

const { games } = buildLibrary(LIBRARY_GAMES_INPUT);
const grid = games.filter(inGamesGrid);
const byId = (id: string): LibraryGame => {
  const g = games.find((r) => r.id === id);
  if (!g) throw new Error(`no record for ${id}`);
  return g;
};

describe("the Games grid", () => {
  it("holds hub games and games on disk, and leaves out a game only a mirror lists", () => {
    expect(grid.map((g) => g.id).sort()).toEqual([
      "ba",
      "evo",
      "mf",
      "my test game",
      "sf",
      "ta",
      "zk",
    ]);
  });

  it("covers every state once", () => {
    expect(Object.fromEntries(grid.map((g) => [g.id, g.state]))).toEqual({
      sf: "update",
      ba: "installed",
      zk: "downloading",
      evo: "queued",
      mf: "available",
      "my test game": "local",
      ta: "noSource",
    });
  });

  it("counts each chip", () => {
    expect(chipCounts(grid)).toEqual({
      all: 7,
      installed: 3,
      updates: 1,
      featured: 2,
      notInstalled: 4,
    });
  });

  it("filters by chip", () => {
    const ids = (chip: Parameters<typeof matchesChip>[1]) =>
      grid
        .filter((g) => matchesChip(g, chip))
        .map((g) => g.id)
        .sort();
    expect(ids("updates")).toEqual(["sf"]);
    expect(ids("featured")).toEqual(["sf", "zk"]);
    expect(ids("installed")).toEqual(["ba", "my test game", "sf"]);
  });

  it("searches the title and the installed archive names", () => {
    expect(matchesSearch(byId("mf"), "metal")).toBe(true);
    expect(matchesSearch(byId("sf"), "splinterfaction_0.1")).toBe(true);
    expect(matchesSearch(byId("sf"), "zero")).toBe(false);
    expect(matchesSearch(byId("sf"), "  ")).toBe(true);
  });

  it("puts featured games first, then sorts by title", () => {
    expect(sortGames(grid, "featured").map((g) => g.id)).toEqual([
      "sf",
      "zk",
      "ba",
      "evo",
      "mf",
      "my test game",
      "ta",
    ]);
    expect(sortGames(grid, "name-desc")[0].id).toBe("zk");
  });

  it("names the hub's sources first, then the mirrors', once each", () => {
    expect(sourceKinds(byId("mf"))).toEqual(["rapid", "github", "springfiles"]);
    expect(sourceKinds(byId("sf"))).toEqual(["github"]);
    expect(sourceKinds(byId("ta"))).toEqual([]);
  });
});

describe("download requests", () => {
  it("installs a hub game from the hub's first source", async () => {
    expect(await installRequest(byId("mf"), "/data")).toEqual({
      kind: "rapid",
      label: "Metal Factions",
      args: { tag: "mf:stable" },
    });
  });

  it("installs a game the hub names no source for from springfiles by spring name", async () => {
    const mf = byId("mf");
    const noHubSources = {
      ...mf,
      hub: mf.hub && { ...mf.hub, downloads: [] },
    };
    expect(await installRequest(noHubSources, "/data")).toEqual({
      kind: "game",
      label: "Metal Factions",
      args: { gameName: "Metal Factions V1.4", writePath: "/data" },
      sizeBytes: 100,
    });
  });

  it("says why when a game has no source at all", async () => {
    await expect(installRequest(byId("ta"), "/data")).rejects.toThrow(
      /no download source/i,
    );
  });

  it("updates from the newer archive itself", async () => {
    expect(await updateRequest(byId("sf"), "/data")).toEqual({
      kind: "file",
      label: "SplinterFaction",
      args: {
        url: "https://github.example/SplinterFaction_0.1.87.sdz",
        destDir: "/data/games",
        filename: "SplinterFaction_0.1.87.sdz",
      },
      sizeBytes: 200,
    });
  });

  it("updates a rapid game from the tag that moved", async () => {
    const ba = { ...byId("ba"), rapidUpdate: { tag: "ba:stable", md5: "abc" } };
    expect(await updateRequest(ba, "/data")).toEqual({
      kind: "rapid",
      label: "Balanced Annihilation",
      args: { tag: "ba:stable" },
    });
  });
});
