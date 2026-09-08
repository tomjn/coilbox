import { describe, expect, it } from "vitest";
import {
  generatedGameNote,
  isGeneratedGame,
  isMutatorArchive,
  isScratchArchive,
  isWorkshopMutatorArchive,
  MUTATOR_FOLDER,
  SCRATCH_FOLDER,
  WORKSHOP_MUTATOR_FOLDER,
  withoutGeneratedGames,
} from "./generatedGames";

const game = (name: string) => ({ name, primaryArchive: { name } });

describe("isScratchArchive", () => {
  it("recognises the unit builder's scratch game, whatever its casing", () => {
    expect(isScratchArchive(SCRATCH_FOLDER)).toBe(true);
    expect(isScratchArchive(SCRATCH_FOLDER.toUpperCase())).toBe(true);
  });

  it("never mistakes another archive for it", () => {
    expect(isScratchArchive("ba1211.sdz")).toBe(false);
    expect(isScratchArchive("mygame.sdd")).toBe(false);
    expect(isScratchArchive(MUTATOR_FOLDER)).toBe(false);
  });
});

describe("isMutatorArchive", () => {
  it("recognises the scenario test mutator, whatever its casing", () => {
    expect(isMutatorArchive(MUTATOR_FOLDER)).toBe(true);
    expect(isMutatorArchive("Coilbox-Mission-Test.sdd")).toBe(true);
  });

  it("never mistakes another archive for it", () => {
    expect(isMutatorArchive("ba1211.sdz")).toBe(false);
    expect(isMutatorArchive(SCRATCH_FOLDER)).toBe(false);
  });
});

describe("isWorkshopMutatorArchive", () => {
  it("recognises the workshop's local test mutator, whatever its casing", () => {
    expect(isWorkshopMutatorArchive(WORKSHOP_MUTATOR_FOLDER)).toBe(true);
    expect(isWorkshopMutatorArchive("Coilbox-Workshop-Test.sdd")).toBe(true);
  });

  it("never mistakes another archive for it", () => {
    expect(isWorkshopMutatorArchive("ba1211.sdz")).toBe(false);
    expect(isWorkshopMutatorArchive(SCRATCH_FOLDER)).toBe(false);
    expect(isWorkshopMutatorArchive(MUTATOR_FOLDER)).toBe(false);
  });
});

describe("generatedGameNote", () => {
  it("knows every one of coilbox's own games, and tells them apart", () => {
    const scratch = generatedGameNote(SCRATCH_FOLDER);
    const mutator = generatedGameNote(MUTATOR_FOLDER);
    const workshop = generatedGameNote(WORKSHOP_MUTATOR_FOLDER);

    expect(scratch).toContain("unit");
    expect(mutator).toContain("scenario");
    expect(workshop).toContain("workshop");
    expect(new Set([scratch, mutator, workshop]).size).toBe(3);
  });

  it("says how to be rid of any of them, since that is the whole undo", () => {
    for (const name of [
      SCRATCH_FOLDER,
      MUTATOR_FOLDER,
      WORKSHOP_MUTATOR_FOLDER,
    ]) {
      expect(generatedGameNote(name)).toContain("Deleting its folder undoes");
    }
  });

  it("says nothing about a game the player installed", () => {
    expect(generatedGameNote("ba1211.sdz")).toBeNull();
    expect(isGeneratedGame("ba1211.sdz")).toBe(false);
  });
});

describe("withoutGeneratedGames", () => {
  it("takes every one of coilbox's own out of a scanned list at once", () => {
    const games = [
      game("ba1211.sdz"),
      game(SCRATCH_FOLDER),
      game(MUTATOR_FOLDER),
      game(WORKSHOP_MUTATOR_FOLDER),
      game("evolutionrts.sdz"),
    ];

    expect(withoutGeneratedGames(games).map((g) => g.name)).toEqual([
      "ba1211.sdz",
      "evolutionrts.sdz",
    ]);
  });

  it("leaves a list with none of them alone", () => {
    const games = [game("ba1211.sdz")];

    expect(withoutGeneratedGames(games)).toEqual(games);
  });

  // A screen resolves its selection against this list, so dropping the game it
  // already holds would report one sitting in `games/` as not installed.
  it("keeps the one already chosen, and still drops the other", () => {
    const games = [
      game("ba1211.sdz"),
      game(SCRATCH_FOLDER),
      game(MUTATOR_FOLDER),
    ];

    expect(
      withoutGeneratedGames(games, SCRATCH_FOLDER).map((g) => g.name),
    ).toEqual(["ba1211.sdz", SCRATCH_FOLDER]);
  });

  it("keeps nothing extra when the chosen game is an ordinary one", () => {
    const games = [game("ba1211.sdz"), game(SCRATCH_FOLDER)];

    expect(
      withoutGeneratedGames(games, "ba1211.sdz").map((g) => g.name),
    ).toEqual(["ba1211.sdz"]);
  });
});
