import { describe, expect, it } from "vitest";
import { textRedirect, unitDisplayName } from "./unitName";

/** A Balanced Annihilation def, which names the unit itself. */
const baArmcom = { name: "Commander", description: "Commander" };

/** A Beyond All Reason def, which names it nowhere. */
const barArmaak = { health: 1000, objectname: "Units/ARMAAK.s3o" };

/** BAR's `armcomcon`, which borrows the commander's name (issue #2686). */
const barArmcomcon = { health: 1000, customparams: { i18nfromunit: "armcom" } };

/** The commander's own row, as the curated dataset carries it. */
const armcomRow = { name: "armcom", fullName: "Armada Commander" };

describe("unitDisplayName", () => {
  it("prefers the curated dataset, which is the only read that answers for every game", () => {
    expect(
      unitDisplayName("armaak", barArmaak, {
        name: "armaak",
        fullName: "Archangel",
      }),
    ).toBe("Archangel");
  });

  it("falls back to the key when nothing names the unit", () => {
    expect(unitDisplayName("armaak", barArmaak)).toBe("armaak");
    expect(unitDisplayName("armaak", undefined)).toBe("armaak");
  });

  /**
   * `unitLabel` answers with the entry's own internal name when the game gave
   * it no readable one, so a dataset that could not name the unit must not read
   * as one that did.
   */
  it("does not take a dataset row that only repeats the key as a name", () => {
    expect(unitDisplayName("armaak", barArmaak, { name: "armaak" })).toBe(
      "armaak",
    );
  });

  it("reads a name out of the def when the dataset has none", () => {
    expect(unitDisplayName("armcom", baArmcom)).toBe("Commander");
  });

  /**
   * `gamedata/defs.lua` lowercases every key, so a `def.humanName` property
   * access can never hit on a real game. This is the same fix the field
   * registry needed.
   */
  it("reads the def however the game spelled the key", () => {
    expect(unitDisplayName("armcom", { humanname: "Commander" })).toBe(
      "Commander",
    );
    expect(unitDisplayName("armcom", { HUMANNAME: "Commander" })).toBe(
      "Commander",
    );
    expect(unitDisplayName("armcom", { NAME: "Commander" })).toBe("Commander");
  });

  /** The engine reads `humanName` with `name` as its default, and its own
   *  comment calls `name` the internal name. */
  it("prefers humanName over name, as the engine does", () => {
    expect(
      unitDisplayName("armcom", { humanname: "Commander", name: "armcom" }),
    ).toBe("Commander");
  });

  it("ignores a def name that is only the internal key again", () => {
    expect(unitDisplayName("armcom", { name: "armcom" })).toBe("armcom");
    expect(unitDisplayName("armcom", { name: "   " })).toBe("armcom");
  });

  it("calls a unit what it borrows, which is what the game reads", () => {
    expect(
      unitDisplayName("armcomcon", barArmcomcon, undefined, armcomRow),
    ).toBe("Armada Commander");
  });

  /**
   * `fill_missing_names` in the worker only borrows for a unit nothing else
   * named, and this has to answer the same way or the heading and the catalog
   * would call one unit two things.
   */
  it("takes a name of the unit's own over a borrowed one", () => {
    expect(
      unitDisplayName(
        "armcomcon",
        barArmcomcon,
        { name: "armcomcon", fullName: "Construction Commander" },
        armcomRow,
      ),
    ).toBe("Construction Commander");
  });

  /** The ordinary Beyond All Reason case: nothing else names it at all. */
  it("borrows once the unit's own row has nothing to say", () => {
    expect(
      unitDisplayName(
        "armcomcon",
        barArmcomcon,
        { name: "armcomcon" },
        armcomRow,
      ),
    ).toBe("Armada Commander");
  });

  /**
   * A row that names nothing answers with its own key, and that key belongs to
   * a different unit. Showing it would rename `armcomcon` to `armcom`.
   */
  it("does not put the borrowed unit's key on screen", () => {
    expect(
      unitDisplayName("armcomcon", barArmcomcon, undefined, {
        name: "armcom",
      }),
    ).toBe("armcomcon");
  });

  /** A game that names its units in the def is not touched by any of this. */
  it("leaves a def that names itself alone", () => {
    expect(
      unitDisplayName(
        "armcom",
        { ...baArmcom, customparams: { i18nfromunit: "armcom" } },
        undefined,
        undefined,
      ),
    ).toBe("Commander");
    expect(unitDisplayName("armcom", baArmcom, undefined, armcomRow)).toBe(
      "Commander",
    );
  });
});

describe("textRedirect", () => {
  it("reads the unit a def borrows its name from", () => {
    expect(textRedirect(barArmcomcon)).toBe("armcom");
    expect(textRedirect({ customparams: { i18nfromunit: " ArmCom " } })).toBe(
      "armcom",
    );
  });

  it("answers nothing for a def that borrows nothing", () => {
    expect(textRedirect(barArmaak)).toBeUndefined();
    expect(textRedirect(undefined)).toBeUndefined();
    expect(textRedirect({ customparams: {} })).toBeUndefined();
    expect(
      textRedirect({ customparams: { i18nfromunit: "  " } }),
    ).toBeUndefined();
    expect(textRedirect({ customparams: { i18nfromunit: 7 } })).toBeUndefined();
  });
});
