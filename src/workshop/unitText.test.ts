import { describe, expect, it } from "vitest";
import { setOverride, type UnitOverrides } from "./overrides";
import {
  baseLanguage,
  clearUnitText,
  clearUnitTexts,
  type LanguageTexts,
  languageCodes,
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

/**
 * BAR's translations as the worker hands them over. It ships six of these
 * (de, en, es, fr, ru and zh), and each is sparse against English: a locale
 * names the units somebody translated and says nothing about the rest.
 *
 * German here has a name and no description, which is the ordinary case a
 * fallback has to cover.
 */
const barTexts: LanguageTexts = {
  en: {
    names: { armaak: "Archangel" },
    descriptions: { armaak: "Anti-Air Turret" },
  },
  de: { names: { armaak: "Erzengel" } },
};

/** A game that ships one translation, which is the case with no picker. */
const oneLocale: LanguageTexts = { en: barTexts.en };

describe("textHome", () => {
  it("is the def for a game that names a unit there", () => {
    expect(textHome({ ajuno: ba }, undefined)).toBe("def");
  });

  it("is the language file for a game whose defs name nothing", () => {
    expect(textHome({ armaak: bar }, barTexts)).toBe("language");
  });

  /**
   * A game with no localisation file has nowhere else to put a name, so the def
   * is the answer even for a unit nothing currently names.
   */
  it("is the def when there is no language file to read", () => {
    expect(textHome({ armaak: bar }, undefined)).toBe("def");
    expect(textHome({ armaak: bar }, {})).toBe("def");
    expect(textHome({ armaak: bar }, { en: { names: {} } })).toBe("def");
  });

  /**
   * The hazard this is asked of the game's own units to avoid: a copy carries a
   * `humanName` of its own, and one copy must not move a game's other 564 units
   * to a home they do not use.
   */
  it("is the def as soon as one unit names itself", () => {
    const withClone = { armaak: bar, mytank: { humanName: "My Tank" } };
    expect(textHome(withClone, barTexts)).toBe("def");
  });

  /**
   * A game that ships no English at all is read in whichever language it does
   * ship, since falling back to a file it has not got leaves every box blank.
   */
  it("reads a game with no English in the language it has", () => {
    const german: LanguageTexts = { de: { names: { armaak: "Erzengel" } } };
    expect(textHome({ armaak: bar }, german)).toBe("language");
    expect(baseLanguage(german)).toBe("de");
  });
});

describe("languageCodes", () => {
  /** English leads because it is the one everything else falls back to. */
  it("puts English first and the rest in code order", () => {
    const six: LanguageTexts = {
      zh: {},
      de: {},
      en: {},
      ru: {},
      es: {},
      fr: {},
    };
    expect(languageCodes(six)).toEqual(["en", "de", "es", "fr", "ru", "zh"]);
  });

  it("answers nothing for a game that ships no translations", () => {
    expect(languageCodes(undefined)).toEqual([]);
    expect(languageCodes({})).toEqual([]);
    expect(baseLanguage({})).toBe("en");
  });

  /** The case the panel draws no picker for. */
  it("answers one code for a game that ships one", () => {
    expect(languageCodes(oneLocale)).toEqual(["en"]);
  });
});

describe("unitTextRows", () => {
  const rows = (
    over: UnitOverrides = {},
    edits: UnitTextEdits = {},
    home: "def" | "language" = "def",
    unitKey = "ajuno",
    def: Record<string, unknown> | undefined = ba,
    texts: LanguageTexts | undefined = undefined,
    language?: string,
  ) =>
    unitTextRows({
      unitKey,
      def,
      home,
      texts,
      language,
      overrides: over,
      edits,
    });

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
      barTexts,
    );

    expect(name.value).toBe("Archangel");
    expect(name.present).toBe(true);
    expect(name.state).toBe("inherited");
    // Nothing in the def to write to, so nothing points at one.
    expect(name.path).toBeUndefined();
    expect(description.value).toBe("Anti-Air Turret");
    // English is what everything else falls back to, so it inherits from
    // nowhere.
    expect(name.inheritedFrom).toBeUndefined();
  });

  it("shows a language home edit over what the file says", () => {
    const edits = setUnitText(
      {},
      "armaak",
      "en",
      "name",
      "Seraph",
      "Archangel",
    );
    const { name } = rows({}, edits, "language", "armaak", bar, barTexts);

    expect(name.value).toBe("Seraph");
    expect(name.inherited).toBe("Archangel");
    expect(name.state).toBe("overridden");
  });

  it("reads another language out of that language's file", () => {
    const { name } = rows({}, {}, "language", "armaak", bar, barTexts, "de");

    expect(name.value).toBe("Erzengel");
    expect(name.state).toBe("inherited");
    expect(name.inheritedFrom).toBeUndefined();
  });

  /**
   * What the player actually reads. BAR's own i18n module loads English up
   * front and answers in English for a key the chosen locale is missing, so a
   * German box with no German translation shows the English string rather than
   * nothing at all, and says where it came from.
   */
  it("falls back to English where a language says nothing", () => {
    const { description } = rows(
      {},
      {},
      "language",
      "armaak",
      bar,
      barTexts,
      "de",
    );

    expect(description.value).toBe("Anti-Air Turret");
    expect(description.present).toBe(true);
    expect(description.state).toBe("inherited");
    expect(description.inheritedFrom).toBe("en");
  });

  /** The rename you have just made, not the name the game shipped. */
  it("falls back to the English edit once there is one", () => {
    const edits = setUnitText(
      {},
      "armaak",
      "en",
      "name",
      "Seraph",
      "Archangel",
    );
    const { name } = rows({}, edits, "language", "armaak", bar, barTexts, "es");

    expect(name.value).toBe("Seraph");
    expect(name.state).toBe("inherited");
    expect(name.inheritedFrom).toBe("en");
  });

  /** One language's edit is not another's. */
  it("keeps each language's edit to itself", () => {
    let edits = setUnitText({}, "armaak", "en", "name", "Seraph", "Archangel");
    edits = setUnitText(edits, "armaak", "de", "name", "Seraph", "Erzengel");

    expect(
      rows({}, edits, "language", "armaak", bar, barTexts, "de").name.state,
    ).toBe("overridden");
    expect(
      rows({}, edits, "language", "armaak", bar, barTexts, "fr").name.value,
    ).toBe("Seraph");
    expect(
      rows({}, edits, "language", "armaak", bar, barTexts, "fr").name.state,
    ).toBe("inherited");
  });

  /**
   * A def that hands its lookup to another unit reads that unit's entries, so
   * its own are keys the game never asks for. BAR's commander variants and its
   * scavengers work this way.
   */
  it("reads a redirected def at the unit it points to, and offers no edit", () => {
    const variant = { ...bar, customparams: { i18nfromunit: "armaak" } };
    const { name, description } = rows(
      {},
      {},
      "language",
      "armaakt2",
      variant,
      barTexts,
    );

    expect(name.value).toBe("Archangel");
    expect(name.redirect).toBe("armaak");
    expect(description.redirect).toBe("armaak");
  });

  /** An edit against the unit's own key is not what a redirected unit reads. */
  it("ignores an edit on a redirected unit's own key", () => {
    const variant = { ...bar, customparams: { i18nfromunit: "armaak" } };
    const edits = setUnitText({}, "armaakt2", "en", "name", "Mine", "");
    const { name } = rows({}, edits, "language", "armaakt2", variant, barTexts);

    expect(name.value).toBe("Archangel");
    expect(name.state).toBe("inherited");
  });

  /**
   * The same guarantee `overrides.test.ts` holds for the field list. Looking at
   * a unit, in either home, records nothing about it.
   */
  it("records nothing about a unit that is only looked at", () => {
    const over: UnitOverrides = {};
    const edits: UnitTextEdits = {};

    rows(over, edits);
    rows(over, edits, "language", "armaak", bar, barTexts);
    rows(over, edits, "language", "armaak", bar, barTexts, "de");

    expect(over).toEqual({});
    expect(edits).toEqual({});
    expect(textEditCount(edits)).toBe(0);
  });
});

describe("setUnitText", () => {
  it("records an edit and nothing else", () => {
    const edits = setUnitText(
      {},
      "armaak",
      "en",
      "name",
      "Seraph",
      "Archangel",
    );

    expect(edits).toEqual({ armaak: { en: { name: "Seraph" } } });
    expect(unitTextCount(edits, "armaak")).toBe(1);
    expect(unitTextCount(edits, "armsolar")).toBe(0);
  });

  /** Typing the game's own name back in leaves the unit as it was found. */
  it("drops a value that only repeats what was inherited", () => {
    const edits = setUnitText(
      {},
      "armaak",
      "en",
      "name",
      "Archangel",
      "Archangel",
    );

    expect(edits).toEqual({});
  });

  /**
   * A locale that says nothing shows the English value, so retyping what the
   * box already reads must not manufacture a translation of it.
   */
  it("drops a translation that only repeats the fallback", () => {
    const edits = setUnitText(
      {},
      "armaak",
      "fr",
      "name",
      "Archangel",
      "Archangel",
    );

    expect(edits).toEqual({});
  });

  /** A name in German and a name in English are two edits, not one. */
  it("counts each language apart", () => {
    let edits = setUnitText({}, "armaak", "en", "name", "Seraph", "Archangel");
    edits = setUnitText(edits, "armaak", "de", "name", "Seraph", "Erzengel");

    expect(unitTextCount(edits, "armaak")).toBe(2);
    expect(textEditCount(edits)).toBe(2);
    expect(edits).toEqual({
      armaak: { en: { name: "Seraph" }, de: { name: "Seraph" } },
    });
  });

  it("drops the unit once its last edit goes", () => {
    let edits = setUnitText({}, "armaak", "en", "name", "Seraph", "Archangel");
    edits = setUnitText(edits, "armaak", "en", "description", "Shoots up", "");

    expect(textEditCount(edits)).toBe(2);

    edits = clearUnitText(edits, "armaak", "en", "name");
    expect(edits).toEqual({ armaak: { en: { description: "Shoots up" } } });

    edits = clearUnitText(edits, "armaak", "en", "description");
    expect(edits).toEqual({});
  });

  /** The sparseness rule one level down: an emptied language goes too. */
  it("drops a language once its last edit goes", () => {
    let edits = setUnitText({}, "armaak", "en", "name", "Seraph", "Archangel");
    edits = setUnitText(edits, "armaak", "de", "name", "Seraph", "Erzengel");

    edits = clearUnitText(edits, "armaak", "de", "name");
    expect(edits).toEqual({ armaak: { en: { name: "Seraph" } } });

    edits = clearUnitText(edits, "armaak", "en", "name");
    expect(edits).toEqual({});
  });

  it("forgets every language's edits at once", () => {
    let edits = setUnitText({}, "armaak", "en", "name", "Seraph", "Archangel");
    edits = setUnitText(edits, "armaak", "de", "name", "Seraph", "Erzengel");
    edits = setUnitText(edits, "corcom", "en", "name", "Boss", "Commander");

    expect(clearUnitTexts(edits, "armaak")).toEqual({
      corcom: { en: { name: "Boss" } },
    });
  });

  it("leaves a set it has nothing to remove from alone", () => {
    const edits = setUnitText(
      {},
      "armaak",
      "en",
      "name",
      "Seraph",
      "Archangel",
    );

    expect(clearUnitText(edits, "armaak", "en", "description")).toBe(edits);
    expect(clearUnitText(edits, "armaak", "de", "name")).toBe(edits);
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

    const edits = setUnitText(
      {},
      "armaak",
      "en",
      "name",
      "Seraph",
      "Archangel",
    );
    expect(nameEdit("armaak", bar, {}, edits)).toBe("Seraph");
  });

  /**
   * The unit list has one row per unit, so it gets one name. English wins,
   * being the one every other locale falls back to, and a project edited only
   * in German shows the German rather than nothing.
   */
  it("prefers English, and answers in another language where there is no English", () => {
    let edits = setUnitText(
      {},
      "armaak",
      "de",
      "name",
      "Racheengel",
      "Erzengel",
    );
    expect(nameEdit("armaak", bar, {}, edits)).toBe("Racheengel");

    edits = setUnitText(edits, "armaak", "en", "name", "Seraph", "Archangel");
    expect(nameEdit("armaak", bar, {}, edits)).toBe("Seraph");
  });

  /** An edit to some other field is not a rename. */
  it("ignores an override on a different key", () => {
    const over = setOverride({}, "ajuno", "maxdamage", 5000, 2120);
    expect(nameEdit("ajuno", ba, over, {})).toBeUndefined();
  });
});
