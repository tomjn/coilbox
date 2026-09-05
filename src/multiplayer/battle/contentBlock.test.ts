import { describe, expect, it } from "vitest";
import {
  type LaunchContent,
  launchBlock,
  startedWithoutYou,
} from "./contentBlock";

function content(p: Partial<LaunchContent> = {}): LaunchContent {
  return {
    hasTarget: true,
    targetLoading: false,
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

  it("falls back to a generic noun when the host named nothing", () => {
    const block = launchBlock(content({ gameMissing: true, gameName: "" }));
    expect(block?.reason).toContain("the game");
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
