import { describe, expect, it } from "vitest";
import {
  gamesHidingGeneratedStyles,
  hidesGeneratedStyles,
} from "./ownMapsOnly";

const game = (name: string, shortname: string) => ({
  name,
  info: { shortname },
});
const map = (shortname: string) => ({
  id: `m-${shortname}`,
  title: "Map",
  game: { shortname },
  source: "bundled" as const,
  warpath: true,
});

describe("hidesGeneratedStyles", () => {
  const maps = [{}];
  const none = { onlyOwnMaps: [] as string[] };

  it("hides nothing with no flag set", () => {
    expect(hidesGeneratedStyles({ name: "A" }, maps, none, false)).toBe(false);
  });

  it("hides on the profile switch alone", () => {
    expect(hidesGeneratedStyles({ name: "A" }, maps, none, true)).toBe(true);
  });

  it("hides on the archive flag alone, and only for the game that sets it", () => {
    const list = { onlyOwnMaps: ["A"] };
    expect(hidesGeneratedStyles({ name: "A" }, maps, list, false)).toBe(true);
    expect(hidesGeneratedStyles({ name: "B" }, maps, list, false)).toBe(false);
  });

  it("keeps the styles when there is no map, whichever flag is set", () => {
    const list = { onlyOwnMaps: ["A"] };
    expect(hidesGeneratedStyles({ name: "A" }, [], list, true)).toBe(false);
  });
});

describe("gamesHidingGeneratedStyles", () => {
  const games = [game("War v1", "WAR"), game("Space v2", "SPACE")];

  it("covers every game that has a map when the profile switch is on", () => {
    const list = { maps: [map("WAR")], onlyOwnMaps: [] };
    expect(gamesHidingGeneratedStyles(games, list, true)).toEqual(["War v1"]);
  });

  it("changes nothing with no switch and no flag", () => {
    const list = { maps: [map("WAR")], onlyOwnMaps: [] };
    expect(gamesHidingGeneratedStyles(games, list, false)).toEqual([]);
  });

  it("combines the archive flag and the profile switch", () => {
    const list = {
      maps: [map("WAR"), map("SPACE")],
      onlyOwnMaps: ["Space v2"],
    };
    expect(gamesHidingGeneratedStyles(games, list, false)).toEqual([
      "Space v2",
    ]);
    expect(gamesHidingGeneratedStyles(games, list, true)).toEqual([
      "War v1",
      "Space v2",
    ]);
  });
});
