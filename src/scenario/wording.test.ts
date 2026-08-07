import { describe, expect, it } from "vitest";
import {
  adoptedGameRoute,
  coilboxTooOld,
  gameNotInstalled,
  missionProblems,
  missionWarnings,
  olderRuntimeRoute,
  packagedGameRoute,
  type ScenarioReader,
  setupNotFound,
  unadoptedGameRoute,
} from "./wording";

/** Every sentence this module has, for one reader. */
function everything(reader: ScenarioReader): string[] {
  return [
    gameNotInstalled(reader, "Balanced Annihilation"),
    gameNotInstalled(reader, ""),
    packagedGameRoute(reader, "Balanced Annihilation"),
    unadoptedGameRoute(reader, "Balanced Annihilation"),
    olderRuntimeRoute(reader, "Balanced Annihilation", 1, 3),
    adoptedGameRoute(reader, "Balanced Annihilation", 3),
    coilboxTooOld(reader, 9, 3),
    setupNotFound(reader, "Balanced Annihilation"),
    missionProblems(reader, 2),
    missionWarnings(reader, 2),
  ];
}

/**
 * Coilbox's own plumbing, and the one instruction only someone with the editor
 * open can follow. Issue #862 is exactly this list reaching the Scenarios page.
 */
const AUTHOR_ONLY = [
  /mutator/i,
  /mission runtime/i,
  /runtime version/i,
  /compiled mission/i,
  /vendors/i,
  /packaged archive/i,
  /\.sdd|\.sd7|\.sdz/i,
  /set the scenario up/i,
  /point the scenario at/i,
];

describe("player wording", () => {
  it("never names coilbox's plumbing or asks the reader to re-author anything", () => {
    for (const sentence of everything("player")) {
      for (const pattern of AUTHOR_ONLY) {
        expect(sentence).not.toMatch(pattern);
      }
    }
  });

  it("tells a player the one thing they can do about a missing game", () => {
    const said = gameNotInstalled("player", "Balanced Annihilation");

    expect(said).toContain("Balanced Annihilation is not installed.");
    expect(said).toContain("Install it from Content");
  });

  it("says the same thing about every route the game cannot take itself", () => {
    const game = "Balanced Annihilation";
    const said = packagedGameRoute("player", game);

    expect(said).toContain("cannot play a scenario on its own");
    expect(said).toContain("not changed");
    expect(unadoptedGameRoute("player", game)).toBe(said);
    expect(olderRuntimeRoute("player", game, 1, 3)).toBe(said);
  });

  it("sends a broken scenario back to whoever shared it", () => {
    expect(missionProblems("player", 2)).toContain("2 problems");
    expect(missionProblems("player", 1)).toContain("1 problem,");
    expect(missionProblems("player", 2)).toContain("Whoever made it");
  });
});

describe("author wording", () => {
  it("keeps the second choice only an author has", () => {
    expect(gameNotInstalled("author", "Balanced Annihilation")).toContain(
      "set the scenario up on a game you have",
    );
  });

  it("says which route a launch takes and why", () => {
    expect(packagedGameRoute("author", "BA")).toContain("packaged archive");
    expect(unadoptedGameRoute("author", "BA")).toContain("has not adopted");
    expect(olderRuntimeRoute("author", "BA", 1, 3)).toContain(
      "needs version 3",
    );
    expect(adoptedGameRoute("author", "BA", 3)).toContain("version 3");
  });

  it("names the versions when coilbox is the one that is out of date", () => {
    const said = coilboxTooOld("author", 9, 3);

    expect(said).toContain("version 9");
    expect(said).toContain("ships version 3");
    expect(coilboxTooOld("player", 9, 3)).toContain("Update coilbox");
  });
});

describe("both readers", () => {
  it("say something different to each", () => {
    const player = everything("player");
    const author = everything("author");

    expect(player).toHaveLength(author.length);
    // Only "this game is not installed" opens the same way for both, and the
    // sentence after it differs, so no pair may be identical.
    for (const [i, said] of player.entries()) {
      expect(said).not.toBe(author[i]);
    }
  });

  it("always name the game they are about", () => {
    for (const reader of ["author", "player"] as const) {
      for (const said of [
        gameNotInstalled(reader, "Balanced Annihilation"),
        packagedGameRoute(reader, "Balanced Annihilation"),
        unadoptedGameRoute(reader, "Balanced Annihilation"),
        adoptedGameRoute(reader, "Balanced Annihilation", 3),
        setupNotFound(reader, "Balanced Annihilation"),
      ]) {
        expect(said).toContain("Balanced Annihilation");
      }
    }
  });
});
