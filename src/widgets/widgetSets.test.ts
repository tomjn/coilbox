import { describe, expect, it } from "vitest";
import {
  absorbFile,
  appliedSet,
  dropOverride,
  EMPTY_SETS,
  recordWrite,
  type SwitchableWidget,
  setKey,
  statesToWrite,
  switchIn,
  type WidgetSets,
} from "./widgetSets";

const widget = (
  name: string,
  previousNames: string[] = [],
): SwitchableWidget => ({ kind: "ready", name, previousNames });

const watch = widget("Build Watch", ["Old Watch"]);
const minimap = widget("Minimap");
const PATH = "/spring/LuaUI/Config/MF.lua";
const OTHER = "/spring/LuaUI/Config/SF.lua";

describe("widget sets", () => {
  it("keys a game's own set by its short name", () => {
    expect(setKey({ game: "Metal Factions v2.58", shortName: "MF" })).toBe(
      "MF",
    );
    expect(setKey({ game: "Mystery 1.0" })).toBe("Mystery 1.0");
  });

  it("fills an empty set in from the first file read", () => {
    const sets = absorbFile(
      EMPTY_SETS,
      "MF",
      PATH,
      new Map([
        ["Old Watch", 3],
        ["Unknown", 1],
      ]),
      [watch, minimap],
    );
    // Read under its old name, kept under its own. Minimap has no entry, so
    // the file says nothing about it.
    expect(sets.global).toEqual({ "Build Watch": true });
    expect(sets.written[PATH]).toEqual({ "Build Watch": true });
  });

  it("does not let a file coilbox never wrote overrule the set", () => {
    const start: WidgetSets = { ...EMPTY_SETS, global: { Minimap: true } };
    const sets = absorbFile(start, "SF", OTHER, new Map([["Minimap", 0]]), [
      minimap,
    ]);
    expect(sets).toBe(start);
  });

  it("takes a change made in the game into the global set", () => {
    const start = recordWrite(
      { ...EMPTY_SETS, global: { Minimap: true, "Build Watch": false } },
      PATH,
      new Map([
        ["Minimap", true],
        ["Build Watch", false],
      ]),
    );
    const sets = absorbFile(
      start,
      "MF",
      PATH,
      new Map([
        ["Minimap", 0],
        ["Build Watch", 0],
      ]),
      [watch, minimap],
    );
    expect(sets.global).toEqual({ Minimap: false, "Build Watch": false });
    expect(sets.written[PATH]).toEqual({
      Minimap: false,
      "Build Watch": false,
    });
    // Read again, the same file is no news.
    expect(
      absorbFile(sets, "MF", PATH, new Map([["Minimap", 0]]), [minimap]),
    ).toBe(sets);
  });

  it("takes a change into the game's own set and leaves the global one", () => {
    const own = switchIn(
      { ...EMPTY_SETS, global: { Minimap: true } },
      "MF",
      "Build Watch",
      true,
    );
    const start = recordWrite(own, PATH, statesToWrite(own, "MF", [minimap]));
    const sets = absorbFile(start, "MF", PATH, new Map([["Minimap", 0]]), [
      minimap,
    ]);
    expect(sets.global).toEqual({ Minimap: true });
    expect(sets.overrides.MF).toEqual({ Minimap: false, "Build Watch": true });
  });

  it("starts a game's own set as a copy of the global one, which it then replaces", () => {
    let sets = switchIn(EMPTY_SETS, null, "Minimap", true);
    sets = switchIn(sets, "MF", "Build Watch", true);
    expect(appliedSet(sets, "MF")).toEqual({
      Minimap: true,
      "Build Watch": true,
    });
    // A widget switched on for all games later does not reach MF.
    sets = switchIn(sets, null, "Radar", true);
    expect(appliedSet(sets, "MF").Radar).toBeUndefined();
    expect(appliedSet(sets, "SF")).toEqual({ Minimap: true, Radar: true });
    sets = dropOverride(sets, "MF");
    expect(appliedSet(sets, "MF")).toBe(sets.global);
  });

  it("writes every widget the game loads, and one the set leaves out as off", () => {
    const sets = { ...EMPTY_SETS, global: { Minimap: true, Radar: true } };
    expect(statesToWrite(sets, "MF", [watch, minimap])).toEqual(
      new Map([
        ["Build Watch", false],
        ["Minimap", true],
      ]),
    );
  });
});
