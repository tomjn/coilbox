/**
 * What the mission briefing's download panel shows (issue #3366). Pure: the
 * facts the page reads go in, the rows and their wording come out.
 */

import { describe, expect, it } from "vitest";
import { missionNeeds, type NeedsFacts, needNotice } from "./missionNeeds";

const installed: NeedsFacts = {
  unfinished: false,
  noEngine: false,
  scanReady: true,
  gameName: "BA 9.1",
  mapName: "Comet",
  games: [{ name: "BA 9.1" }],
  maps: [{ name: "Comet" }],
};

describe("missionNeeds", () => {
  it("is empty when the game and map are installed", () => {
    expect(missionNeeds(installed)).toEqual([]);
  });

  it("names a missing game", () => {
    expect(missionNeeds({ ...installed, games: [] })).toEqual([
      { kind: "game", name: "BA 9.1" },
    ]);
  });

  it("names a missing map", () => {
    expect(missionNeeds({ ...installed, maps: [] })).toEqual([
      { kind: "map", name: "Comet" },
    ]);
  });

  it("names both, game first, when both are missing", () => {
    expect(missionNeeds({ ...installed, games: [], maps: [] })).toEqual([
      { kind: "game", name: "BA 9.1" },
      { kind: "map", name: "Comet" },
    ]);
  });

  it("matches the game by exact name, not by another version of it", () => {
    expect(missionNeeds({ ...installed, games: [{ name: "BA 9.0" }] })).toEqual(
      [{ kind: "game", name: "BA 9.1" }],
    );
  });

  it("names only the engine when there is none, whatever else is missing", () => {
    expect(
      missionNeeds({
        ...installed,
        noEngine: true,
        scanReady: false,
        games: [],
        maps: [],
      }),
    ).toEqual([{ kind: "engine", name: "" }]);
  });

  it("says nothing while the install is still being read", () => {
    expect(
      missionNeeds({ ...installed, scanReady: false, games: [], maps: [] }),
    ).toEqual([]);
  });

  it("offers nothing for a mission that was never finished", () => {
    expect(
      missionNeeds({
        ...installed,
        unfinished: true,
        mapName: "",
        maps: [],
        noEngine: true,
      }),
    ).toEqual([]);
  });

  it("is playable after the download: the same facts with the game now scanned", () => {
    const before = { ...installed, games: [] };
    expect(missionNeeds(before)).toHaveLength(1);
    expect(missionNeeds({ ...before, games: [{ name: "BA 9.1" }] })).toEqual(
      [],
    );
  });

  it("moves from the engine to the game once an engine exists", () => {
    const before = {
      ...installed,
      noEngine: true,
      scanReady: false,
      games: [],
    };
    expect(missionNeeds(before)[0].kind).toBe("engine");
    expect(
      missionNeeds({ ...before, noEngine: false, scanReady: true }),
    ).toEqual([{ kind: "game", name: "BA 9.1" }]);
  });
});

describe("needNotice", () => {
  const game = { kind: "game", name: "BA 9.1" } as const;
  const base = {
    failure: null,
    engineRelease: "found",
    noWriteRoot: false,
  } as const;

  it("offers a download and says nothing when nothing is wrong", () => {
    expect(needNotice({ ...base, need: game })).toEqual({
      canDownload: true,
      message: null,
    });
  });

  it("says plainly that a pinned game version could not be fetched, naming it", () => {
    const notice = needNotice({
      ...base,
      need: game,
      failure: "No release matches",
    });
    expect(notice.message).toContain("BA 9.1");
    expect(notice.message).toContain("no longer be published");
    expect(notice.message).toContain("No release matches");
    expect(notice.message).toContain("Another version will not run");
  });

  it("keeps a retry open after a failed game download", () => {
    expect(
      needNotice({ ...base, need: game, failure: "offline" }).canDownload,
    ).toBe(true);
  });

  it("shows a failed map download's own error", () => {
    const notice = needNotice({
      ...base,
      need: { kind: "map", name: "Comet" },
      failure: "timed out",
    });
    expect(notice.message).toBe("timed out");
    expect(notice.canDownload).toBe(true);
  });

  it("turns the engine offer off when no build exists for this platform", () => {
    const notice = needNotice({
      ...base,
      need: { kind: "engine", name: "" },
      engineRelease: "none",
    });
    expect(notice.canDownload).toBe(false);
    expect(notice.message).toContain("Settings");
  });

  it("holds the engine offer while the release list is still loading, without a message", () => {
    expect(
      needNotice({
        ...base,
        need: { kind: "engine", name: "" },
        engineRelease: "pending",
      }),
    ).toEqual({ canDownload: false, message: null });
  });

  it("turns every offer off with no download folder, and says why", () => {
    const notice = needNotice({ ...base, need: game, noWriteRoot: true });
    expect(notice.canDownload).toBe(false);
    expect(notice.message).toContain("download folder");
  });
});
