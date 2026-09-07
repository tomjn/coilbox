import { describe, expect, it } from "vitest";
import {
  addClone,
  checkCloneName,
  deriveClone,
  normaliseCloneKey,
  removeClone,
  suggestCloneKey,
  type UnitClones,
  unitsWithClones,
} from "./clones";
import {
  overrideCount,
  resolvedDef,
  setOverride,
  type UnitOverrides,
} from "./overrides";

/**
 * A unit shaped the way Balanced Annihilation writes one: every key lowercased
 * by `gamedata/defs.lua` on the way out of the worker, and `name` carrying the
 * name a person reads rather than the internal one.
 */
const ARMCOM: Record<string, unknown> = {
  name: "Commander",
  health: 3000,
  buildcostmetal: 1200,
  canfly: false,
  weapons: [{ name: "disintegrator" }, { name: "armcomlaser" }],
  customparams: { model_author: "somebody" },
};

/** A unit as Beyond All Reason writes one: no name of any kind in the def. */
const ARMAAK: Record<string, unknown> = {
  health: 1000,
  buildcostmetal: 300,
  objectname: "Units/ARMAAK.s3o",
};

const GAME = { armcom: ARMCOM, armaak: ARMAAK };

describe("normaliseCloneKey", () => {
  it("stores an internal name lowercased and trimmed", () => {
    expect(normaliseCloneKey("  ArmCom4 ")).toBe("armcom4");
  });
});

describe("checkCloneName", () => {
  it("says a name nothing is using adds a unit", () => {
    expect(checkCloneName("armcom4", GAME, {})).toEqual({
      key: "armcom4",
      verdict: "adds",
      ok: true,
    });
  });

  /**
   * The distinction issue #1272 is about. Both outcomes are legitimate, so
   * neither is refused and the two never answer the same thing.
   */
  it("says a name the game already uses replaces that unit", () => {
    const check = checkCloneName("armcom", GAME, {});
    expect(check.verdict).toBe("replaces");
    expect(check.ok).toBe(true);
  });

  it("refuses a name one of your own clones is already using", () => {
    const clones = addClone(
      {},
      deriveClone({
        key: "armcom4",
        source: "armcom",
        sourceDef: ARMCOM,
        displayName: "Overlord",
        replacesGameUnit: false,
      }),
    );
    expect(checkCloneName("armcom4", GAME, clones)).toEqual({
      key: "armcom4",
      verdict: "taken",
      ok: false,
    });
  });

  it("refuses an empty name and one the engine could not use as a file name", () => {
    expect(checkCloneName("   ", GAME, {}).verdict).toBe("empty");
    expect(checkCloneName("arm com", GAME, {}).verdict).toBe("invalid");
    expect(checkCloneName("armcom.4", GAME, {}).verdict).toBe("invalid");
    expect(checkCloneName("arm-com", GAME, {}).verdict).toBe("invalid");
  });

  it("judges the name as it would be stored, not as it was typed", () => {
    expect(checkCloneName("ARMCOM", GAME, {}).verdict).toBe("replaces");
    expect(checkCloneName(" ArmCom4 ", GAME, {})).toEqual({
      key: "armcom4",
      verdict: "adds",
      ok: true,
    });
  });
});

describe("suggestCloneKey", () => {
  it("offers the first number the project is not already using", () => {
    const taken = new Set(["armcom2", "armcom3"]);
    expect(suggestCloneKey("armcom", (k) => taken.has(k))).toBe("armcom4");
    expect(suggestCloneKey("armcom", () => false)).toBe("armcom2");
  });
});

describe("deriveClone", () => {
  it("copies the whole definition rather than a patch of it", () => {
    const clone = deriveClone({
      key: "armcom4",
      source: "armcom",
      sourceDef: ARMCOM,
      displayName: "Overlord",
      replacesGameUnit: false,
    });
    expect(clone.def.health).toBe(3000);
    expect(clone.def.buildcostmetal).toBe(1200);
    expect(clone.def.canfly).toBe(false);
    expect(clone.def.weapons).toEqual(ARMCOM.weapons);
    expect(clone.source).toBe("armcom");
  });

  it("does not share any table with the unit it copied", () => {
    const clone = deriveClone({
      key: "armcom4",
      source: "armcom",
      sourceDef: ARMCOM,
      displayName: "Overlord",
      replacesGameUnit: false,
    });
    (clone.def.weapons as { name: string }[])[0].name = "nothing";
    (clone.def.customparams as Record<string, string>).model_author = "me";
    expect(ARMCOM.weapons).toEqual([
      { name: "disintegrator" },
      { name: "armcomlaser" },
    ]);
    expect(ARMCOM.customparams).toEqual({ model_author: "somebody" });
  });

  /**
   * Naming has one source in this app, and a clone does not get a second one.
   * The name goes into the keys the engine reads, so `unitName.ts` resolves a
   * clone the same way it resolves anything else.
   */
  it("writes the display name where the game already wrote one", () => {
    const clone = deriveClone({
      key: "armcom4",
      source: "armcom",
      sourceDef: ARMCOM,
      displayName: "Overlord",
      replacesGameUnit: false,
    });
    expect(clone.def.name).toBe("Overlord");
    expect(clone.def.humanName).toBeUndefined();
  });

  it("adds a name to a definition that carries none", () => {
    const clone = deriveClone({
      key: "armaak2",
      source: "armaak",
      sourceDef: ARMAAK,
      displayName: "Archangel II",
      replacesGameUnit: false,
    });
    expect(clone.def.humanName).toBe("Archangel II");
    expect(clone.def.objectname).toBe("Units/ARMAAK.s3o");
  });

  it("keeps an internal name internal and puts the display name beside it", () => {
    const clone = deriveClone({
      key: "armcom4",
      source: "armcom",
      // A game that writes the internal name in `name`, which is what the
      // engine's own comment calls that key.
      sourceDef: { name: "armcom", health: 3000 },
      displayName: "Overlord",
      replacesGameUnit: false,
    });
    expect(clone.def.name).toBe("armcom4");
    expect(clone.def.humanName).toBe("Overlord");
  });

  it("copies the unit as the project has it, edits included", () => {
    const patch = { health: 6000, "weapons.0.name": "bigger" };
    const clone = deriveClone({
      key: "armcom4",
      source: "armcom",
      sourceDef: ARMCOM,
      patch,
      displayName: "Overlord",
      replacesGameUnit: false,
    });
    expect(clone.def.health).toBe(6000);
    expect(clone.def.weapons).toEqual([
      { name: "bigger" },
      { name: "armcomlaser" },
    ]);
    expect(ARMCOM.health).toBe(3000);
  });

  it("records whether it was told it would replace a unit", () => {
    const clone = deriveClone({
      key: "armcom",
      source: "armcom",
      sourceDef: ARMCOM,
      displayName: "Overlord",
      replacesGameUnit: true,
    });
    expect(clone.replacesGameUnit).toBe(true);
  });
});

/**
 * The property `overrides.ts` exists to hold, restated for the other half of
 * the model. A clone is a whole definition and an override set is a sparse
 * patch, and putting a clone into the patch would freeze every field of the
 * unit it came from.
 */
describe("a clone stays out of the override set", () => {
  it("adds nothing to it when one is made, however many fields it copies", () => {
    const overrides: UnitOverrides = {};
    const clones = addClone(
      {},
      deriveClone({
        key: "armcom4",
        source: "armcom",
        sourceDef: ARMCOM,
        displayName: "Overlord",
        replacesGameUnit: false,
      }),
    );
    expect(overrides).toEqual({});
    expect(overrideCount(overrides)).toBe(0);
    expect(Object.keys(clones.armcom4.def).length).toBeGreaterThan(5);
  });

  it("carries the source's edits into its own definition rather than the set", () => {
    const edited = setOverride({}, "armcom", "health", 6000, 3000);
    const clone = deriveClone({
      key: "armcom4",
      source: "armcom",
      sourceDef: ARMCOM,
      patch: edited.armcom,
      displayName: "Overlord",
      replacesGameUnit: false,
    });
    expect(clone.def.health).toBe(6000);
    // The set still says one thing, about the unit the game owns.
    expect(edited).toEqual({ armcom: { health: 6000 } });
    expect(overrideCount(edited)).toBe(1);
  });

  it("takes ordinary sparse overrides once it exists, against its own values", () => {
    const clone = deriveClone({
      key: "armcom4",
      source: "armcom",
      sourceDef: ARMCOM,
      displayName: "Overlord",
      replacesGameUnit: false,
    });
    // Editing the clone is the same call the page makes for any unit, with the
    // clone's own definition as what is inherited.
    const after = setOverride({}, clone.key, "health", 9000, clone.def.health);
    expect(after).toEqual({ armcom4: { health: 9000 } });
    // And the clone's definition is still what it was made with, so a reset has
    // somewhere to go back to.
    expect(clone.def.health).toBe(3000);
    expect(resolvedDef(clone.def, after.armcom4).health).toBe(9000);
  });
});

describe("unitsWithClones", () => {
  it("adds a clone to the game's table", () => {
    const clones: UnitClones = addClone(
      {},
      deriveClone({
        key: "armcom4",
        source: "armcom",
        sourceDef: ARMCOM,
        displayName: "Overlord",
        replacesGameUnit: false,
      }),
    );
    const merged = unitsWithClones(GAME, clones);
    expect(Object.keys(merged).sort()).toEqual(["armaak", "armcom", "armcom4"]);
    expect(merged.armcom).toBe(ARMCOM);
  });

  it("puts a replacement in the place of the unit it replaces", () => {
    const clones = addClone(
      {},
      deriveClone({
        key: "armcom",
        source: "armcom",
        sourceDef: ARMCOM,
        displayName: "Overlord",
        replacesGameUnit: true,
      }),
    );
    const merged = unitsWithClones(GAME, clones);
    expect(Object.keys(merged).sort()).toEqual(["armaak", "armcom"]);
    expect(merged.armcom.name).toBe("Overlord");
  });

  it("hands back the game's own table when there are no clones", () => {
    expect(unitsWithClones(GAME, {})).toBe(GAME);
  });
});

describe("removeClone", () => {
  it("forgets one and keeps the rest", () => {
    const one = deriveClone({
      key: "armcom4",
      source: "armcom",
      sourceDef: ARMCOM,
      displayName: "Overlord",
      replacesGameUnit: false,
    });
    const two = deriveClone({
      key: "armcom5",
      source: "armcom",
      sourceDef: ARMCOM,
      displayName: "Warlord",
      replacesGameUnit: false,
    });
    const clones = addClone(addClone({}, one), two);
    expect(Object.keys(removeClone(clones, "armcom4"))).toEqual(["armcom5"]);
    expect(removeClone(clones, "nothing")).toBe(clones);
  });
});
