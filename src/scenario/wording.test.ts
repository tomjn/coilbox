import { describe, expect, it } from "vitest";
import {
  adoptedGameRoute,
  coilboxTooOld,
  engineRunProblems,
  gameNotInstalled,
  gameOwnMissionRoute,
  missionDriftedFromDocument,
  missionProblemCount,
  missionProblems,
  missionProblemsLookWrong,
  missionProblemsStopPlay,
  missionRunLogMissing,
  missionRuntimeProblems,
  missionRuntimeSaidNothing,
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
    gameOwnMissionRoute(reader, "Balanced Annihilation"),
    missionDriftedFromDocument(reader, "Balanced Annihilation"),
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
  /bundles/i,
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

  it("tells a player a mission comes with the game, and nothing else", () => {
    const said = gameOwnMissionRoute("player", "SplinterFaction");

    expect(said).toContain("comes with SplinterFaction");
    for (const pattern of AUTHOR_ONLY) {
      expect(said).not.toMatch(pattern);
    }
  });

  it("says nothing to a player about a mission that has drifted", () => {
    expect(missionDriftedFromDocument("player", "SplinterFaction")).toBe("");
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

  it("tells an author which mission the game is playing", () => {
    expect(gameOwnMissionRoute("author", "SplinterFaction")).toContain(
      "ships this mission",
    );
  });

  it("tells an author when the shipped mission has drifted", () => {
    const said = missionDriftedFromDocument("author", "SplinterFaction");

    expect(said).toContain("does not match the document beside it");
    expect(said).toContain("SplinterFaction");
  });

  it("names the versions when coilbox is the one that is out of date", () => {
    const said = coilboxTooOld("author", 9, 3);

    expect(said).toContain("version 9");
    expect(said).toContain("ships version 3");
    expect(coilboxTooOld("player", 9, 3)).toContain("Update coilbox");
  });
});

describe("the editor header's count", () => {
  it("counts what stops a launch apart from what only looks wrong", () => {
    expect(missionProblemCount(2, 1)).toBe("2 problems, 1 warning");
    expect(missionProblemCount(1, 0)).toBe("1 problem");
    expect(missionProblemCount(0, 3)).toBe("3 warnings");
  });

  it("says nothing about a mission with nothing wrong in it", () => {
    expect(missionProblemCount(0, 0)).toBe("");
  });

  it("says which of the two lists stops the mission playing", () => {
    expect(missionProblemsStopPlay(1)).toBe(
      "1 problem stops this mission from playing:",
    );
    expect(missionProblemsStopPlay(2)).toContain("2 problems stop");
    expect(missionProblemsLookWrong(1)).toBe(
      "One thing plays, and reads to a player as a bug:",
    );
    expect(missionProblemsLookWrong(3)).toContain("3 things play");
  });
});

describe("what the engine's log said about a test run", () => {
  it("counts the runtime's own problems apart from the engine's", () => {
    expect(missionRuntimeProblems(1)).toBe(
      "The mission runtime reported 1 problem while it played:",
    );
    expect(missionRuntimeProblems(4)).toContain("4 problems");
    expect(engineRunProblems(1)).toContain("one error or warning of its own");
    expect(engineRunProblems(3)).toContain("3 errors and warnings of its own");
  });

  it("reads silence from the runtime as an answer, not as nothing", () => {
    const said = missionRuntimeSaidNothing();

    expect(said).toContain("reported nothing");
    expect(said).toContain("reached the map");
  });

  it("says when there was no log to read rather than implying a clean run", () => {
    expect(missionRunLogMissing()).toContain("could not be read");
    expect(missionRunLogMissing()).not.toBe(missionRuntimeSaidNothing());
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
