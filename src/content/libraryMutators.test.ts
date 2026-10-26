import { describe, expect, it } from "vitest";
import type { HubGame } from "../hub/api";
import type { GameItem } from "./bindings";
import { buildLibrary, type LibraryGame } from "./library";
import {
  inGamesGrid,
  installRequest,
  isSearchableMutator,
  matchesSearch,
  mutatorsOf,
} from "./libraryGames";

const game = (
  name: string,
  archive: string,
  deps: string[] = [],
  info: Record<string, string> = {},
): GameItem => ({
  name,
  primaryArchive: { name: archive },
  dependencyArchives: deps.map((name) => ({ name })),
  info,
});

const libraryOf = (games: GameItem[]) =>
  buildLibrary({
    scan: { games, maps: [] },
    files: null,
    hubGames: null,
    catalogues: [],
    queue: [],
  }).games;

const find = (games: LibraryGame[], title: string): LibraryGame => {
  const g = games.find((r) => r.title === title);
  if (!g) throw new Error(`no record for ${title}`);
  return g;
};

const base = game("Base Game 1.0", "basegame_1.0.sdz");

describe("a mutator's parent", () => {
  it("is the installed game its dependencies name, by game name", () => {
    const games = libraryOf([
      base,
      game("Deployment Mode", "deploy.sdz", ["Base Game 1.0", "Bitmaps.sdz"]),
    ]);
    expect(find(games, "Deployment Mode").parent).toBe(
      find(games, "Base Game").id,
    );
    expect(find(games, "Base Game").parent).toBeUndefined();
  });

  it("is found by archive name, whatever the case", () => {
    const games = libraryOf([
      base,
      game("Deployment Mode", "deploy.sdz", ["BaseGame_1.0.SDZ"]),
    ]);
    expect(find(games, "Deployment Mode").parent).toBe(
      find(games, "Base Game").id,
    );
  });

  it("is unset when the dependency is not an installed game", () => {
    const games = libraryOf([
      game("Loner", "loner.sdz", ["Bitmaps.sdz", "not installed v1"]),
    ]);
    expect(find(games, "Loner").parent).toBeUndefined();
  });

  it("is unset when the parent is missing, so the mutator stays in the grid", () => {
    const games = libraryOf([
      {
        ...game("Orphan Mode", "orphan.sdz", ["base game 1.0"]),
        missingDependencies: ["base game 1.0"],
      },
    ]);
    const orphan = find(games, "Orphan Mode");
    expect(orphan.parent).toBeUndefined();
    expect(inGamesGrid(orphan)).toBe(true);
  });

  it("goes to the game at the bottom of a chain of two mutators", () => {
    const games = libraryOf([
      base,
      game("Mode One", "one.sdz", ["Base Game 1.0"]),
      game("Mode Two", "two.sdz", ["Mode One"]),
    ]);
    const baseId = find(games, "Base Game").id;
    expect(find(games, "Mode One").parent).toBe(baseId);
    expect(find(games, "Mode Two").parent).toBe(baseId);
    expect(mutatorsOf(games, baseId).map((g) => g.title)).toEqual([
      "Mode One",
      "Mode Two",
    ]);
  });

  it("is kept apart from the base game when its name starts with the base's", () => {
    const games = libraryOf([
      base,
      game("Base Game 1.0 (compat 17)", "compat.sdd", ["Base Game 1.0"]),
    ]);
    const baseRecord = find(games, "Base Game");
    expect(baseRecord.installed.map((g) => g.name)).toEqual(["Base Game 1.0"]);
    expect(find(games, "Base Game 1.0 (compat 17)").parent).toBe(baseRecord.id);
  });

  it("is unset for games that depend on each other", () => {
    const games = libraryOf([
      game("Ping", "ping.sdz", ["Pong"]),
      game("Pong", "pong.sdz", ["Ping"]),
    ]);
    expect(games.every((g) => g.parent === undefined)).toBe(true);
  });
});

describe("the Games grid and mutators", () => {
  const games = libraryOf([
    base,
    game("Deployment Mode", "deploy.sdz", ["Base Game 1.0"], {
      mutator: "deployment",
    }),
  ]);

  it("shows one card for the game and none for its mutator", () => {
    expect(games.filter(inGamesGrid).map((g) => g.title)).toEqual([
      "Base Game",
    ]);
  });

  it("lets a search find the mutator", () => {
    const mutators = games.filter(isSearchableMutator);
    expect(mutators.map((g) => g.title)).toEqual(["Deployment Mode"]);
    expect(matchesSearch(mutators[0], "deploy")).toBe(true);
    expect(matchesSearch(mutators[0], "base")).toBe(false);
  });
});

const hubGame = (shortname: string, base: string | null): HubGame => ({
  shortname,
  title: `Hub ${shortname}`,
  description: null,
  featured: false,
  downloads: [{ kind: "rapid", value: `${shortname}:test` }],
  logo: null,
  card: null,
  faction_count: 0,
  unit_count: 0,
  item_count: 0,
  base_game: base,
});

const hubLibrary = (scanned: GameItem[], hub: HubGame[]) =>
  buildLibrary({
    scan: { games: scanned, maps: [] },
    files: null,
    hubGames: hub,
    catalogues: [],
    queue: [],
  }).games;

describe("a hub mutator that is not installed", () => {
  const installedBase = {
    ...game("Base Game 1.0", "basegame_1.0.sdz"),
    info: { shortname: "bg" },
  };

  it("goes under its installed base game and out of the grid", () => {
    const games = hubLibrary(
      [installedBase],
      [hubGame("bg", null), hubGame("mode", "bg")],
    );
    const baseId = find(games, "Base Game").id;
    const mode = find(games, "Hub mode");
    expect(mode.parent).toBe(baseId);
    expect(inGamesGrid(mode)).toBe(false);
    expect(games.filter(inGamesGrid).map((g) => g.title)).toEqual([
      "Base Game",
    ]);
    expect(mutatorsOf(games, baseId).map((g) => g.title)).toEqual(["Hub mode"]);
  });

  it("is installed from its hub sources", async () => {
    const games = hubLibrary([installedBase], [hubGame("mode", "bg")]);
    expect(await installRequest(find(games, "Hub mode"), "/data")).toEqual({
      kind: "rapid",
      label: "Hub mode",
      args: { tag: "mode:test" },
    });
  });

  it("stays in the grid when its base game is not in the library", () => {
    const games = hubLibrary([], [hubGame("mode", "missing")]);
    const mode = find(games, "Hub mode");
    expect(mode.parent).toBeUndefined();
    expect(inGamesGrid(mode)).toBe(true);
  });

  it("stays in the grid when its base game is only on the hub", () => {
    const games = hubLibrary([], [hubGame("bg", null), hubGame("mode", "bg")]);
    expect(inGamesGrid(find(games, "Hub mode"))).toBe(true);
  });
});

describe("an installed mutator with a hub record", () => {
  it("takes its parent from the scan, whatever the hub says", () => {
    const scanned = [
      {
        ...game("Base Game 1.0", "basegame_1.0.sdz"),
        info: { shortname: "bg" },
      },
      {
        ...game("Mode Two", "two.sdz", ["Base Game 1.0"]),
        info: { shortname: "mode" },
      },
    ];
    const games = hubLibrary(scanned, [hubGame("mode", "other")]);
    expect(find(games, "Mode Two").parent).toBe(find(games, "Base Game").id);
    expect(find(games, "Mode Two").hub?.shortname).toBe("mode");
    expect(games.filter((g) => g.hub?.shortname === "mode")).toHaveLength(1);
  });
});
