import { describe, expect, it } from "vitest";
import { gameListState } from "./gameListState";

/** The common case: a scan that ran and found something. */
const base = {
  hasTarget: true,
  scanned: true,
  hasGames: true,
  scanErrors: [] as string[],
};

describe("gameListState", () => {
  it("is ready when a scan found games", () => {
    expect(gameListState(base)).toBe("ready");
  });

  it("is no-engine when nothing can run a scan", () => {
    expect(gameListState({ ...base, hasTarget: false })).toBe("no-engine");
  });

  it("is scanning until the first result lands", () => {
    expect(gameListState({ ...base, scanned: false, hasGames: false })).toBe(
      "scanning",
    );
  });

  it("is empty when a clean scan found no games", () => {
    expect(gameListState({ ...base, hasGames: false })).toBe("empty");
  });

  // The bug this exists for: unitsync answers with a valid document even when
  // its Init failed, so a broken engine reads as an empty install. Telling
  // somebody to download a game they already own is the wrong instruction.
  it("is unreadable when a scan found no games but reported problems", () => {
    expect(
      gameListState({
        ...base,
        hasGames: false,
        scanErrors: [
          "Init: Required base file 'base/springcontent.sdz' does not exist.",
        ],
      }),
    ).toBe("unreadable");
  });

  // Diagnostics are routine on a working install, so they only change the
  // verdict when there is nothing to show alongside them.
  it("stays ready when a scan reported problems but still found games", () => {
    expect(gameListState({ ...base, scanErrors: ["a warning"] })).toBe("ready");
  });

  it("has no verdict on content before an engine is known", () => {
    expect(
      gameListState({
        ...base,
        hasTarget: false,
        hasGames: false,
        scanErrors: ["a problem"],
      }),
    ).toBe("no-engine");
  });
});
