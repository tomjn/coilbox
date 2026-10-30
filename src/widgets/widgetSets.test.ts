import { describe, expect, it } from "vitest";
import {
  absorbFile,
  addWidgets,
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
  enabled = false,
): SwitchableWidget => ({ kind: "ready", name, previousNames, enabled });

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
    // it takes what it declares, and nothing is recorded as written for it.
    expect(sets.global).toEqual({ "Build Watch": true, Minimap: false });
    expect(sets.written[PATH]).toEqual({ "Build Watch": true });
  });

  it("keeps a widget on that the game would switch on for itself", () => {
    const radar = widget("Radar", [], true);
    const sets = absorbFile(EMPTY_SETS, "MF", PATH, new Map(), [radar]);
    expect(sets.global).toEqual({ Radar: true });
    expect(sets.written).toEqual({});
    expect(statesToWrite(sets, "MF", [radar])).toEqual(
      new Map([["Radar", true]]),
    );
    // Once the set says, a missing entry changes nothing.
    const off = switchIn(sets, null, "Radar", false);
    expect(absorbFile(off, "MF", PATH, new Map(), [radar])).toBe(off);
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

  it("does not take an inherited property for a set or a setting", () => {
    expect(appliedSet(EMPTY_SETS, "constructor")).toBe(EMPTY_SETS.global);
    const ctor = widget("constructor", [], true);
    expect(
      absorbFile(EMPTY_SETS, "MF", PATH, new Map(), [ctor]).global,
    ).toEqual({ constructor: true });
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

  describe("addWidgets", () => {
    const sets: WidgetSets = {
      global: { Minimap: true },
      overrides: { MF: { Minimap: false } },
      written: {},
    };

    it("switches a new widget on for every game and says off in each game's own set", () => {
      const next = addWidgets(sets, null, ["Radar"]);
      expect(next.global).toEqual({ Minimap: true, Radar: true });
      expect(next.overrides.MF).toEqual({ Minimap: false, Radar: false });
    });

    it("switches it on in one game's set and off in the rest", () => {
      const next = addWidgets(sets, "MF", ["Radar"]);
      expect(next.global).toEqual({ Minimap: true, Radar: false });
      expect(next.overrides.MF).toEqual({ Minimap: false, Radar: true });
    });

    it("gives a game without a set of its own one that copies the global set", () => {
      const next = addWidgets(sets, "SF", ["Radar"]);
      expect(next.global).toEqual({ Minimap: true, Radar: false });
      expect(next.overrides.SF).toEqual({ Minimap: true, Radar: true });
      expect(next.overrides.MF).toEqual({ Minimap: false, Radar: false });
    });

    it("changes nothing for no widgets", () => {
      expect(addWidgets(sets, null, [])).toBe(sets);
    });

    it("writes the new widget as off to a file that has no entry for it", () => {
      const next = addWidgets(sets, "SF", ["Radar"]);
      const radar = widget("Radar", [], true);
      // A handler would switch on a widget its file has no entry for. Absorbing
      // that file leaves the sets' answer alone.
      const absorbed = absorbFile(next, "MF", PATH, new Map(), [radar]);
      expect(statesToWrite(absorbed, "MF", [radar])).toEqual(
        new Map([["Radar", false]]),
      );
      expect(statesToWrite(absorbed, "SF", [radar])).toEqual(
        new Map([["Radar", true]]),
      );
    });
  });
});
