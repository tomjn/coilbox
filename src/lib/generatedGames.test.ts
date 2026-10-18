import { describe, expect, it } from "vitest";
import {
  COMPAT_PREFIX,
  compatBaseName,
  generatedGameNote,
  isCompatArchive,
  isGeneratedGame,
  isMutatorArchive,
  isPlaybackArchive,
  isScratchArchive,
  isUnitsArchive,
  isWorkshopMutatorArchive,
  MUTATOR_FOLDER,
  PLAYBACK_FOLDER,
  SCRATCH_FOLDER,
  unitsFolder,
  WORKSHOP_MUTATOR_FOLDER,
  withoutGeneratedGames,
} from "./generatedGames";

const game = (name: string) => ({ name, primaryArchive: { name } });

// Issues #4516 and #4518.
describe("unitsFolder", () => {
  it("names one folder per campaign, in the shape the export guard accepts", () => {
    const id = "0b6f3a3e-9a39-4d0a-8f39-3b1d2f4c5e6a";
    expect(unitsFolder("campaign", id)).toBe(`coilbox-lego-campaign-${id}.sdd`);
    expect(unitsFolder("campaign", "Camp-01")).toBe(
      "coilbox-lego-campaign-camp-01.sdd",
    );
  });

  it("names a conquest's and a run's folder apart from a campaign's", () => {
    expect(unitsFolder("conquest", "generated-1")).toBe(
      "coilbox-lego-conquest-generated-1.sdd",
    );
    const run = "run-0b6f3a3e-9a39-4d0a-8f39-3b1d2f4c5e6a";
    expect(unitsFolder("warpath", run)).toBe(`coilbox-lego-run-${run}.sdd`);
  });

  it("names an id too long for a folder by a hash of it, the same each time", () => {
    const long = `map-${"x".repeat(60)}`;
    const folder = unitsFolder("conquest", long) as string;
    expect(folder).toMatch(/^coilbox-lego-conquest-[0-9a-f]{8}\.sdd$/);
    expect(unitsFolder("conquest", long)).toBe(folder);
    expect(unitsFolder("conquest", `${long}y`)).not.toBe(folder);
  });

  it("refuses an id that cannot name a folder", () => {
    expect(unitsFolder("campaign", "a_b")).toBeNull();
    expect(unitsFolder("warpath", "../x")).toBeNull();
  });

  it("is a generated game, not one to offer", () => {
    for (const folder of [
      unitsFolder("campaign", "c1") as string,
      unitsFolder("conquest", "g1") as string,
      unitsFolder("warpath", "run-1") as string,
    ]) {
      expect(isUnitsArchive(folder)).toBe(true);
      expect(isGeneratedGame(folder)).toBe(true);
      expect(isScratchArchive(folder)).toBe(false);
    }
    expect(isUnitsArchive(SCRATCH_FOLDER)).toBe(false);
  });
});

// Issue #4556. The folder names are the ones `compat_build` writes for an .sd7
// and an .sdd game.
describe("isCompatArchive", () => {
  const packed = "coilbox-compat-xta-9.65-1.sdd";
  const loose = "coilbox-compat-splinterfaction-12.sdd";

  it("recognises a compat mutator built from a packed or a loose game", () => {
    expect(packed.startsWith(COMPAT_PREFIX)).toBe(true);
    expect(isCompatArchive(packed)).toBe(true);
    expect(isCompatArchive(loose)).toBe(true);
    expect(isCompatArchive("Coilbox-Compat-XTA-9.65-1.sdd")).toBe(true);
  });

  it("is a generated game, so the pickers hide it", () => {
    expect(isGeneratedGame(packed)).toBe(true);
    expect(generatedGameNote(packed)).toContain("old game");
    expect(
      withoutGeneratedGames([game("xta-9.65.sd7"), game(packed)]).map(
        (g) => g.name,
      ),
    ).toEqual(["xta-9.65.sd7"]);
  });

  it("never mistakes another archive for it", () => {
    for (const name of [
      "xta-9.65.sd7",
      "coilbox-compat-xta.sdd",
      "coilbox-compat-xta-1.sdz",
      "coilbox-compat-xta-01.sdd",
      "coilbox-compat--1.sdd",
      WORKSHOP_MUTATOR_FOLDER,
    ]) {
      expect(isCompatArchive(name)).toBe(false);
    }
  });

  it("names the base archive's stem it wraps", () => {
    expect(compatBaseName(packed)).toBe("xta-9.65");
    expect(compatBaseName(loose)).toBe("splinterfaction");
    expect(compatBaseName("coilbox-compat-ca-stable-8405-1.sdd")).toBe(
      "ca-stable-8405",
    );
    expect(compatBaseName("xta-9.65.sd7")).toBeNull();
  });
});

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

describe("isPlaybackArchive", () => {
  it("recognises the replay playback game, whatever its casing", () => {
    expect(PLAYBACK_FOLDER).toBe("coilbox-replay-playback.sdd");
    expect(isPlaybackArchive(PLAYBACK_FOLDER)).toBe(true);
    expect(isPlaybackArchive("Coilbox-Replay-Playback.sdd")).toBe(true);
  });

  it("never mistakes another archive for it", () => {
    expect(isPlaybackArchive("ba1211.sdz")).toBe(false);
    expect(isPlaybackArchive(SCRATCH_FOLDER)).toBe(false);
    expect(isPlaybackArchive(MUTATOR_FOLDER)).toBe(false);
    expect(isPlaybackArchive(WORKSHOP_MUTATOR_FOLDER)).toBe(false);
  });

  it("is not taken for the playback by any of the others", () => {
    expect(isScratchArchive(PLAYBACK_FOLDER)).toBe(false);
    expect(isMutatorArchive(PLAYBACK_FOLDER)).toBe(false);
    expect(isWorkshopMutatorArchive(PLAYBACK_FOLDER)).toBe(false);
  });
});

describe("generatedGameNote", () => {
  it("knows every one of coilbox's own games, and tells them apart", () => {
    const scratch = generatedGameNote(SCRATCH_FOLDER);
    const mutator = generatedGameNote(MUTATOR_FOLDER);
    const workshop = generatedGameNote(WORKSHOP_MUTATOR_FOLDER);
    const playback = generatedGameNote(PLAYBACK_FOLDER);

    expect(scratch).toContain("unit");
    expect(mutator).toContain("scenario");
    expect(workshop).toContain("workshop");
    expect(playback).toContain("replay");
    expect(new Set([scratch, mutator, workshop, playback]).size).toBe(4);
  });

  it("says how to be rid of any of them, since that is the whole undo", () => {
    for (const name of [
      SCRATCH_FOLDER,
      MUTATOR_FOLDER,
      WORKSHOP_MUTATOR_FOLDER,
      PLAYBACK_FOLDER,
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
      game(PLAYBACK_FOLDER),
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
