import { describe, expect, it } from "vitest";
import { unitDisplayName } from "./unitName";

/** A Balanced Annihilation def, which names the unit itself. */
const baArmcom = { name: "Commander", description: "Commander" };

/** A Beyond All Reason def, which names it nowhere. */
const barArmaak = { health: 1000, objectname: "Units/ARMAAK.s3o" };

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
});
