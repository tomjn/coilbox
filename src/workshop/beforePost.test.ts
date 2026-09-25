import { describe, expect, it } from "vitest";
import {
  adoptBeforePost,
  adoptedChange,
  copiedFrom,
  overlaps,
  parsePostChange,
  withoutEdited,
  withoutNames,
} from "./beforePost";
import type { UnitClones } from "./clones";
import type { WeaponLibrary } from "./weaponLibrary";

/** Balanced Annihilation V15.9.8's shape: the post files point the slot at
 *  the full name and cut the crater multiplier (issue #3054). */
const ARMBRTHA_POST = {
  humanName: "Big Bertha",
  weapons: [{ name: "armbrtha_arm_berthacannon" }],
  weapondefs: { arm_berthacannon: { cratermult: 0.009, range: 4650 } },
};
const ARMBRTHA_CHANGE = {
  values: {
    "weapons.0.def": "ARM_BERTHACANNON",
    "weapondefs.arm_berthacannon.cratermult": 0.1,
  },
  added: ["weapons.0.name"],
};

describe("what the game's post files changed, on a copy (issue #3054)", () => {
  it("counts a slot's def and name as one field", () => {
    expect(overlaps("weapons.0.def", "Weapons.0.Name")).toBe(true);
    expect(overlaps("weapondefs.laser", "weapondefs.laser.range")).toBe(true);
    expect(overlaps("weapondefs.laser.range", "weapondefs.laser2")).toBe(false);
  });

  it("gives a path the project edited back to the project", () => {
    expect(
      withoutEdited(ARMBRTHA_CHANGE, [
        "weapondefs.arm_berthacannon.cratermult",
      ]),
    ).toEqual({
      values: { "weapons.0.def": "ARM_BERTHACANNON" },
      added: ["weapons.0.name"],
    });
    expect(withoutEdited(ARMBRTHA_CHANGE, ["weapons.0.name"])).toEqual({
      values: { "weapondefs.arm_berthacannon.cratermult": 0.1 },
    });
  });

  it("leaves the copy's own name alone", () => {
    expect(
      withoutNames({ values: { humanName: "Old", "sounds.ok": "x" } }),
    ).toEqual({ values: { "sounds.ok": "x" } });
  });

  it("takes a carried weapon's part out of its unit's", () => {
    expect(
      copiedFrom(ARMBRTHA_CHANGE, "weapondefs.arm_berthacannon", []),
    ).toEqual({ values: { cratermult: 0.1 } });
    expect(
      copiedFrom(ARMBRTHA_CHANGE, "weapondefs.arm_berthacannon", [
        "weapondefs.arm_berthacannon.cratermult",
      ]),
    ).toEqual({});
    // The whole weapon replaced leaves nothing of the game's to put back.
    expect(
      copiedFrom(ARMBRTHA_CHANGE, "weapondefs.arm_berthacannon", [
        "weapondefs",
      ]),
    ).toEqual({});
  });

  it("gives an old copy only what it still holds of its source", () => {
    const copy = structuredClone(ARMBRTHA_POST);
    copy.weapondefs.arm_berthacannon.cratermult = 0.5;
    expect(adoptedChange(copy, ARMBRTHA_POST, ARMBRTHA_CHANGE)).toEqual({
      values: { "weapons.0.def": "ARM_BERTHACANNON" },
      added: ["weapons.0.name"],
    });
  });

  it("gives every copy saved before this what applies, once", () => {
    const clones: UnitClones = {
      armbrtha2: {
        key: "armbrtha2",
        source: "armbrtha",
        replacesGameUnit: false,
        def: { ...structuredClone(ARMBRTHA_POST), humanName: "Bertha 2" },
      },
      lego: {
        key: "lego",
        replacesGameUnit: false,
        def: {},
      },
    };
    const weapons: WeaponLibrary = {
      cannon: {
        key: "cannon",
        source: "armbrtha_arm_berthacannon",
        def: { cratermult: 0.009, range: 4650 },
      },
    };
    const read = {
      units: { armbrtha: ARMBRTHA_CHANGE },
      weaponDefs: {
        armbrtha_arm_berthacannon: { values: { cratermult: 0.1 } },
      },
    };
    const game = { armbrtha: ARMBRTHA_POST };
    const gameWeapons = {
      armbrtha_arm_berthacannon: ARMBRTHA_POST.weapondefs.arm_berthacannon,
    };

    const adopted = adoptBeforePost(clones, weapons, read, game, gameWeapons);
    expect(adopted?.clones.armbrtha2.beforePost).toEqual(ARMBRTHA_CHANGE);
    expect(adopted?.clones.lego.beforePost).toBeUndefined();
    expect(adopted?.weapons?.cannon.beforePost).toEqual({
      values: { cratermult: 0.1 },
    });
    // Nothing left to give the second time, so the page does not write again.
    expect(
      adoptBeforePost(
        adopted?.clones ?? {},
        adopted?.weapons,
        read,
        game,
        gameWeapons,
      ),
    ).toBeNull();
    // A game whose read could not say gives nothing.
    expect(
      adoptBeforePost(clones, weapons, undefined, game, gameWeapons),
    ).toBeNull();
  });

  it("reads a change out of a saved project, dropping what is not one", () => {
    expect(parsePostChange({ values: { a: 1 }, added: ["b", 2] })).toEqual({
      values: { a: 1 },
      added: ["b"],
    });
    expect(parsePostChange({})).toEqual({});
    expect(parsePostChange("nope")).toBeUndefined();
    expect(parsePostChange(undefined)).toBeUndefined();
  });
});
