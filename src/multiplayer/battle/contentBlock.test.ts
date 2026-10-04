import { describe, expect, it } from "vitest";
import { computeMissingRequirements } from "@/content/resolveContent";
import {
  battleRequirements,
  type LaunchContent,
  launchBlock,
  startedWithoutYou,
} from "./contentBlock";

function content(p: Partial<LaunchContent> = {}): LaunchContent {
  return {
    hasTarget: true,
    targetLoading: false,
    engineMissing: null,
    engineUnreadable: false,
    unreadable: false,
    contentKnown: true,
    mapMissing: false,
    gameMissing: false,
    mapName: "Comet Catcher Remake 1.8",
    gameName: "Beyond All Reason test-1234",
    ...p,
  };
}

describe("launchBlock", () => {
  it("blocks a player without the host's engine, naming the version", () => {
    const block = launchBlock(content({ engineMissing: "Recoil 2026.03.01" }));
    expect(block?.short).toBe("Engine missing");
    expect(block?.reason).toContain("Recoil 2026.03.01");
  });

  it("blocks an engine that would not report its version", () => {
    const block = launchBlock(content({ engineUnreadable: true }));
    expect(block?.short).toBe("Engine unknown");
  });

  it("names the engine before content it cannot be trusted to have read", () => {
    const block = launchBlock(
      content({ engineMissing: "Recoil 2026.03.01", gameMissing: true }),
    );
    expect(block?.short).toBe("Engine missing");
  });

  it("lets a player with the map and the game launch", () => {
    expect(launchBlock(content())).toBeNull();
  });

  it("blocks a player without the game, naming the game", () => {
    const block = launchBlock(content({ gameMissing: true }));
    expect(block?.short).toBe("Game missing");
    expect(block?.reason).toContain("Beyond All Reason test-1234");
    expect(block?.reason).not.toContain("Comet Catcher");
  });

  it("blocks a player without the map, naming the map", () => {
    const block = launchBlock(content({ mapMissing: true }));
    expect(block?.short).toBe("Map missing");
    expect(block?.reason).toContain("Comet Catcher Remake 1.8");
    expect(block?.reason).not.toContain("Beyond All Reason");
  });

  it("names both when both are missing", () => {
    const block = launchBlock(content({ mapMissing: true, gameMissing: true }));
    expect(block?.short).toBe("Map and game missing");
    expect(block?.reason).toContain("Beyond All Reason test-1234");
    expect(block?.reason).toContain("Comet Catcher Remake 1.8");
  });

  it("blocks a player whose game lacks a dependency archive, naming both", () => {
    const block = launchBlock(
      content({
        dependencyBlock:
          "Archive not installed: zero-k v1.7.6.4. Zero-K Benchmark v3 depends on it.",
      }),
    );
    expect(block?.short).toBe("Archive missing");
    expect(block?.reason).toContain("zero-k v1.7.6.4");
    expect(block?.reason).toContain("Zero-K Benchmark v3");
  });

  it("names a missing game before a dependency it cannot have read", () => {
    const block = launchBlock(
      content({ gameMissing: true, dependencyBlock: "Archive not installed." }),
    );
    expect(block?.short).toBe("Game missing");
  });

  it("blocks with no engine selected", () => {
    const block = launchBlock(content({ hasTarget: false }));
    expect(block?.short).toBe("No engine");
    expect(block?.reason).toContain("Content folders");
  });

  // A verdict given before the scan settles reads as "you do not have this game"
  // for a game that is installed, which is worse than saying nothing.
  it("gives no verdict while the content scan is still running", () => {
    expect(
      launchBlock(content({ contentKnown: false, mapMissing: true })),
    ).toBeNull();
  });

  it("gives no verdict while the engine target is still resolving", () => {
    expect(
      launchBlock(content({ hasTarget: false, targetLoading: true })),
    ).toBeNull();
  });

  // An unreadable install means "unknown", not "missing" (issue #1386, #2458):
  // reporting the content as missing would send a player chasing a download
  // for something they may already have.
  it("blocks with its own reason when the install cannot be read, even if a stale missing flag is set", () => {
    const block = launchBlock(
      content({ unreadable: true, contentKnown: false, mapMissing: true }),
    );
    expect(block?.short).toBe("Can't check content");
    expect(block?.reason).toContain("could not read");
  });

  it("carries the reason the install could not be read, when there is one", () => {
    const block = launchBlock(
      content({
        unreadable: true,
        unreadableReason: "no space left on device",
      }),
    );
    expect(block?.reason).toContain("no space left on device");
  });

  it("falls back to a generic noun when the host named nothing", () => {
    const block = launchBlock(content({ gameMissing: true, gameName: "" }));
    expect(block?.reason).toContain("the game");
  });
});

describe("battleRequirements and a dependency archive", () => {
  const battle = { modname: "Zero-K Benchmark v3", map: "Tabula" };
  const installed = (missingDependencies?: string[]) => ({
    games: [{ name: battle.modname, missingDependencies }],
    maps: [battle.map],
    engineVersions: [],
  });

  it("reports an archive the battle's game lacks", () => {
    const missing = computeMissingRequirements(
      battleRequirements(battle),
      installed(["zero-k v1.7.6.4"]),
    );
    expect(missing.map((r) => [r.kind, r.label, r.gameName])).toEqual([
      ["dependency", "zero-k v1.7.6.4", battle.modname],
    ]);
  });

  it("reports nothing for a game that lacks nothing", () => {
    expect(
      computeMissingRequirements(battleRequirements(battle), installed([])),
    ).toEqual([]);
  });
});

describe("startedWithoutYou", () => {
  it("keeps the reason and adds what just happened", () => {
    const block = launchBlock(content({ mapMissing: true }));
    const text = block ? startedWithoutYou(block) : "";
    expect(text).toContain("The match has started without you");
    expect(text).toContain("Comet Catcher Remake 1.8");
  });
});
