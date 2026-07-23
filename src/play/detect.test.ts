import { describe, expect, it } from "vitest";
import type { DemoInfo } from "../content/bindings";
import { diffNewReplays, pickNewestReplay, resultFromDemoInfo } from "./detect";

function replay(path: string, modifiedMs: number) {
  return { filename: path, path, sizeBytes: 0, modifiedMs };
}

describe("diffNewReplays", () => {
  it("returns only replays absent from the before set", () => {
    const before = new Set(["a.sdfz", "b.sdfz"]);
    const after = [
      replay("a.sdfz", 1),
      replay("b.sdfz", 2),
      replay("c.sdfz", 3),
    ];
    expect(diffNewReplays(before, after)).toEqual([replay("c.sdfz", 3)]);
  });

  it("returns everything when the before set is empty", () => {
    const after = [replay("a.sdfz", 1)];
    expect(diffNewReplays(new Set(), after)).toEqual(after);
  });

  it("returns nothing new when nothing changed", () => {
    const before = new Set(["a.sdfz"]);
    expect(diffNewReplays(before, [replay("a.sdfz", 1)])).toEqual([]);
  });
});

describe("pickNewestReplay", () => {
  it("returns null for an empty list", () => {
    expect(pickNewestReplay([])).toBeNull();
  });

  it("returns the only replay", () => {
    const r = replay("a.sdfz", 1);
    expect(pickNewestReplay([r])).toEqual(r);
  });

  it("picks the replay with the largest modifiedMs", () => {
    const older = replay("a.sdfz", 100);
    const newer = replay("b.sdfz", 200);
    expect(pickNewestReplay([older, newer])).toEqual(newer);
    expect(pickNewestReplay([newer, older])).toEqual(newer);
  });
});

function demoInfo(overrides: Partial<DemoInfo> = {}): DemoInfo {
  return {
    engineVersion: "1",
    startTimeMs: 0,
    durationSec: 0,
    wallclockSec: 0,
    mapName: "map",
    gameType: "game",
    winningAllyTeams: [0],
    winnersKnown: true,
    numAllyTeams: 2,
    allyTeams: [],
    players: [],
    modOptions: {},
    ...overrides,
  };
}

describe("resultFromDemoInfo", () => {
  it("is ambiguous when the winner isn't known", () => {
    const info = demoInfo({
      winnersKnown: false,
      players: [{ name: "You", spectator: false, won: true }],
    });
    expect(resultFromDemoInfo(info, "You")).toBe("ambiguous");
  });

  it("is ambiguous when the named player isn't in the demo", () => {
    const info = demoInfo({
      players: [{ name: "SomeoneElse", spectator: false, won: true }],
    });
    expect(resultFromDemoInfo(info, "You")).toBe("ambiguous");
  });

  it("is ambiguous when the matching entry is a spectator", () => {
    const info = demoInfo({
      players: [{ name: "You", spectator: true, won: true }],
    });
    expect(resultFromDemoInfo(info, "You")).toBe("ambiguous");
  });

  it("is ambiguous when won is null", () => {
    const info = demoInfo({
      players: [{ name: "You", spectator: false, won: undefined }],
    });
    expect(resultFromDemoInfo(info, "You")).toBe("ambiguous");
  });

  it("is victory when the player's won is true", () => {
    const info = demoInfo({
      players: [{ name: "You", spectator: false, won: true }],
    });
    expect(resultFromDemoInfo(info, "You")).toBe("victory");
  });

  it("is defeat when the player's won is false", () => {
    const info = demoInfo({
      players: [{ name: "You", spectator: false, won: false }],
    });
    expect(resultFromDemoInfo(info, "You")).toBe("defeat");
  });

  it("matches the right player among several", () => {
    const info = demoInfo({
      players: [
        { name: "Enemy", spectator: false, won: false },
        { name: "You", spectator: false, won: true },
      ],
    });
    expect(resultFromDemoInfo(info, "You")).toBe("victory");
  });
});
