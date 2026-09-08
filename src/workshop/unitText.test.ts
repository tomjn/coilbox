import { describe, expect, it } from "vitest";
import { setOverride, type UnitOverrides } from "./overrides";
import {
  clearUnitText,
  clearUnitTexts,
  languageNamesUnits,
  nameEdit,
  setUnitText,
  textEditCount,
  textHome,
  type UnitTextEdits,
  unitTextCount,
  unitTextRows,
} from "./unitText";

/**
 * One unit as Balanced Annihilation's def pipeline hands it over: lowercased
 * keys, with the readable name and the tooltip both in the def.
 */
const ba: Record<string, unknown> = {
  name: "Arm Juno",
  description: "Anti Radar/Jammer/Minefield/ScoutSpam Weapon",
  maxdamage: 2120,
};

/** One unit as Beyond All Reason's does: no words in the def at all. */
const bar: Record<string, unknown> = {
  health: 1000,
  objectname: "Units/ARMAAK.s3o",
};

/** What BAR's `language/en/units.json` says about it. */
const barLanguage = {
  names: { armaak: "Archangel" },
  descriptions: { armaak: "Anti-Air Turret" },
};

describe("textHome", () => {
  it("is the def for a game that names a unit there", () => {
    expect(textHome({ ajuno: ba }, undefined)).toBe("def");
  });

  it("is the language file for a game whose defs name nothing", () => {
    expect(textHome({ armaak: bar }, barLanguage)).toBe("language");
  });

  /**
   * A game with no localisation file has nowhere else to put a name, so the def
   * is the answer even for a unit nothing currently names.
   */
  it("is the def when there is no language file to read", () => {
    expect(textHome({ armaak: bar }, undefined)).toBe("def");
    expect(textHome({ armaak: bar }, { names: {} })).toBe("def");
  });

  /**
   * The hazard this is asked of the game's own units to avoid: a copy carries a
   * `humanName` of its own, and one copy must not move a game's other 564 units
   * to a home they do not use.
   */
  it("is the def as soon as one unit names itself", () => {
    const withClone = { armaak: bar, mytank: { humanName: "My Tank" } };
    expect(textHome(withClone, barLanguage)).toBe("def");
  });
});

/**
 * The half of the answer the lego builder's export drawer can ask (issue
 * #2683). It has a folder off a picker rather than a scanned game, so the
 * localisation file is the only thing it can open, and `textHome` has to be
 * able to hand that half over rather than have a second copy of it written.
 */
describe("languageNamesUnits", () => {
  it("is true for a game that names its units in the file", () => {
    expect(languageNamesUnits(barLanguage)).toBe(true);
  });

  it("is false for a game with no file, and for an empty one", () => {
    expect(languageNamesUnits(undefined)).toBe(false);
    expect(languageNamesUnits({ names: {} })).toBe(false);
  });

  /**
   * Descriptions alone do not make a language home. A game naming its units in
   * their definitions and describing them in a file would lose its names if it
   * did.
   */
  it("is false for a file that describes units without naming them", () => {
    expect(languageNamesUnits({ descriptions: { armaak: "Turret" } })).toBe(
      false,
    );
  });

  it("agrees with textHome on the game whose defs say nothing", () => {
    expect(languageNamesUnits(barLanguage)).toBe(
      textHome({ armaak: bar }, barLanguage) === "language",
    );
  });
});

describe("unitTextRows", () => {
  const rows = (
    over: UnitOverrides = {},
    edits: UnitTextEdits = {},
    home: "def" | "language" = "def",
    unitKey = "ajuno",
    def: Record<string, unknown> | undefined = ba,
    language = undefined as
      | {
          names?: Record<string, string>;
          descriptions?: Record<string, string>;
        }
      | undefined,
  ) => unitTextRows({ unitKey, def, home, language, overrides: over, edits });

  it("reads a def home out of the def, in the game's own spelling", () => {
    const { name, description } = rows();

    expect(name.value).toBe("Arm Juno");
    expect(name.inherited).toBe("Arm Juno");
    expect(name.state).toBe("inherited");
    expect(name.path).toBe("name");
    expect(description.value).toBe(
      "Anti Radar/Jammer/Minefield/ScoutSpam Weapon",
    );
    expect(description.path).toBe("description");
  });

  /**
   * The engine reads `humanName` first, and `UnitDef.cpp` calls `name` the
   * internal name. A game that writes both must be renamed in the first, or the
   * edit renames the unit itself.
   */
  it("writes to humanName over an internal name", () => {
    const def = { name: "armcom", humanName: "Commander", health: 3000 };
    const { name } = rows({}, {}, "def", "armcom", def);

    expect(name.path).toBe("humanName");
    expect(name.inherited).toBe("Commander");
  });

  it("offers a def home key the game never wrote, and says so", () => {
    const { name, description } = rows({}, {}, "def", "armaak", bar);

    expect(name.path).toBe("humanName");
    expect(name.inherited).toBe("");
    expect(name.present).toBe(false);
    expect(description.present).toBe(false);
  });

  it("shows the override and what it replaced once one is set", () => {
    const over = setOverride({}, "ajuno", "name", "Big Juno", "Arm Juno");
    const { name } = rows(over);

    expect(name.value).toBe("Big Juno");
    expect(name.inherited).toBe("Arm Juno");
    expect(name.state).toBe("overridden");
  });

  it("reads a language home out of the language file", () => {
    const { name, description } = rows(
      {},
      {},
      "language",
      "armaak",
      bar,
      barLanguage,
    );

    expect(name.value).toBe("Archangel");
    expect(name.present).toBe(true);
    expect(name.state).toBe("inherited");
    // Nothing in the def to write to, so nothing points at one.
    expect(name.path).toBeUndefined();
    expect(description.value).toBe("Anti-Air Turret");
  });

  it("shows a language home edit over what the file says", () => {
    const edits = setUnitText({}, "armaak", "name", "Seraph", "Archangel");
    const { name } = rows({}, edits, "language", "armaak", bar, barLanguage);

    expect(name.value).toBe("Seraph");
    expect(name.inherited).toBe("Archangel");
    expect(name.state).toBe("overridden");
  });

  /**
   * The same guarantee `overrides.test.ts` holds for the field list. Looking at
   * a unit, in either home, records nothing about it.
   */
  it("records nothing about a unit that is only looked at", () => {
    const over: UnitOverrides = {};
    const edits: UnitTextEdits = {};

    rows(over, edits);
    rows(over, edits, "language", "armaak", bar, barLanguage);

    expect(over).toEqual({});
    expect(edits).toEqual({});
    expect(textEditCount(edits)).toBe(0);
  });
});

describe("setUnitText", () => {
  it("records an edit and nothing else", () => {
    const edits = setUnitText({}, "armaak", "name", "Seraph", "Archangel");

    expect(edits).toEqual({ armaak: { name: "Seraph" } });
    expect(unitTextCount(edits, "armaak")).toBe(1);
    expect(unitTextCount(edits, "armsolar")).toBe(0);
  });

  /** Typing the game's own name back in leaves the unit as it was found. */
  it("drops a value that only repeats what was inherited", () => {
    const edits = setUnitText({}, "armaak", "name", "Archangel", "Archangel");

    expect(edits).toEqual({});
  });

  it("drops the unit once its last edit goes", () => {
    let edits = setUnitText({}, "armaak", "name", "Seraph", "Archangel");
    edits = setUnitText(edits, "armaak", "description", "Shoots up", "");

    expect(textEditCount(edits)).toBe(2);

    edits = clearUnitText(edits, "armaak", "name");
    expect(edits).toEqual({ armaak: { description: "Shoots up" } });

    edits = clearUnitText(edits, "armaak", "description");
    expect(edits).toEqual({});
  });

  it("forgets both edits at once", () => {
    let edits = setUnitText({}, "armaak", "name", "Seraph", "Archangel");
    edits = setUnitText(edits, "armaak", "description", "Shoots up", "");
    edits = setUnitText(edits, "corcom", "name", "Boss", "Commander");

    expect(clearUnitTexts(edits, "armaak")).toEqual({
      corcom: { name: "Boss" },
    });
  });

  it("leaves a set it has nothing to remove from alone", () => {
    const edits = setUnitText({}, "armaak", "name", "Seraph", "Archangel");

    expect(clearUnitText(edits, "armaak", "description")).toBe(edits);
    expect(clearUnitTexts(edits, "corcom")).toBe(edits);
  });
});

describe("nameEdit", () => {
  it("answers nothing for a unit nobody renamed", () => {
    expect(nameEdit("ajuno", ba, {}, {})).toBeUndefined();
  });

  it("finds a rename in either store", () => {
    const over = setOverride({}, "ajuno", "name", "Big Juno", "Arm Juno");
    expect(nameEdit("ajuno", ba, over, {})).toBe("Big Juno");

    const edits = setUnitText({}, "armaak", "name", "Seraph", "Archangel");
    expect(nameEdit("armaak", bar, {}, edits)).toBe("Seraph");
  });

  /** An edit to some other field is not a rename. */
  it("ignores an override on a different key", () => {
    const over = setOverride({}, "ajuno", "maxdamage", 5000, 2120);
    expect(nameEdit("ajuno", ba, over, {})).toBeUndefined();
  });
});
