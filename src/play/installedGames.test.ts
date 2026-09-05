import { describe, expect, it } from "vitest";
import { compareGameVersions, resolveGameByShortname } from "./installedGames";

describe("compareGameVersions / resolveGameByShortname", () => {
  it("compares numeric segments numerically", () => {
    expect(compareGameVersions("1.10", "1.9")).toBeGreaterThan(0);
    expect(compareGameVersions("test-26575", "test-9999")).toBeGreaterThan(0);
    expect(compareGameVersions("2.0", "2.0")).toBe(0);
  });

  it("resolves the newest installed version of a shortname", () => {
    const games = [
      { name: "Game 1.9", info: { shortname: "TG", version: "1.9" } },
      { name: "Game 1.10", info: { shortname: "TG", version: "1.10" } },
      { name: "Other 9", info: { shortname: "XX", version: "9" } },
    ];
    expect(resolveGameByShortname({ shortname: "tg" }, games)?.name).toBe(
      "Game 1.10",
    );
    expect(
      resolveGameByShortname({ shortname: "nope" }, games),
    ).toBeUndefined();
  });

  it("prefers an exact pinned archive name", () => {
    const games = [
      { name: "Game 1.9", info: { shortname: "TG", version: "1.9" } },
      { name: "Game 1.10", info: { shortname: "TG", version: "1.10" } },
    ];
    expect(
      resolveGameByShortname({ shortname: "TG", pinnedName: "Game 1.9" }, games)
        ?.name,
    ).toBe("Game 1.9");
  });
});
