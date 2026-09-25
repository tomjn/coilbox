import { describe, expect, it } from "vitest";
import {
  addLibraryWeapon,
  checkWeaponName,
  clearLibraryField,
  copyGameWeapon,
  deathExplosionCount,
  equippedCount,
  equipRefusal,
  equipWeapon,
  libraryWeaponDef,
  mountsOf,
  parseEquippedWeapons,
  parseWeaponLibrary,
  removeLibraryWeapon,
  setLibraryField,
  suggestWeaponKey,
  unequipEverywhere,
  unequipUnit,
  unequipWeapon,
  type WeaponLibrary,
} from "./weaponLibrary";

const LASER = { range: 300, damage: { default: 75 } };

function library(): WeaponLibrary {
  return addLibraryWeapon(
    {},
    copyGameWeapon("heavylaser", "ARMCOM_ARMCOMLASER", LASER, "abc"),
  ) as WeaponLibrary;
}

describe("a library weapon and the game's post files (issue #3054)", () => {
  it("keeps what they changed in the weapon, and reads it back from a save", () => {
    const weapon = copyGameWeapon(
      "cannon",
      "armbrtha_arm_berthacannon",
      { cratermult: 0.009 },
      "abc",
      { values: { cratermult: 0.1 } },
    );
    expect(weapon.beforePost).toEqual({ values: { cratermult: 0.1 } });
    expect(
      parseWeaponLibrary(JSON.parse(JSON.stringify({ cannon: weapon }))),
    ).toEqual({ cannon: weapon });
  });
});

describe("the weapon library (issue #2640)", () => {
  it("copies a game weapon with its source and checksum, and never shares the table", () => {
    const lib = library();
    expect(lib.heavylaser).toEqual({
      key: "heavylaser",
      source: "armcom_armcomlaser",
      sourceChecksum: "abc",
      def: LASER,
    });
    expect(lib.heavylaser.def).not.toBe(LASER);
    expect(copyGameWeapon("x", "y", {}, undefined)).not.toHaveProperty(
      "sourceChecksum",
    );
  });

  it("keeps a weapon it already holds rather than overwriting it", () => {
    const lib = library();
    expect(
      addLibraryWeapon(lib, copyGameWeapon("heavylaser", "other", {}, "")),
    ).toBe(lib);
  });

  it("records a change sparsely and forgets one set back to the copied value", () => {
    let lib = setLibraryField(library(), "heavylaser", "range", 450, 300);
    expect(lib?.heavylaser.changes).toEqual({ range: 450 });
    expect(libraryWeaponDef(lib?.heavylaser as never)).toEqual({
      range: 450,
      damage: { default: 75 },
    });
    lib = setLibraryField(lib, "heavylaser", "damage.default", 90, 75);
    lib = setLibraryField(lib, "heavylaser", "range", 300, 300);
    expect(lib?.heavylaser.changes).toEqual({ "damage.default": 90 });
    lib = clearLibraryField(lib, "heavylaser", "damage.default");
    expect(lib?.heavylaser).not.toHaveProperty("changes");
  });

  it("hands back the same library for an edit that says nothing", () => {
    const lib = library();
    expect(setLibraryField(lib, "heavylaser", "range", 300, 300)).toBe(lib);
    expect(clearLibraryField(lib, "heavylaser", "range")).toBe(lib);
    expect(setLibraryField(lib, "gone", "range", 1, 2)).toBe(lib);
    expect(removeLibraryWeapon(lib, "gone")).toBe(lib);
  });

  it("names a copy after its source, numbered from the second", () => {
    expect(suggestWeaponKey("ARM_COMLASER", {})).toBe("arm_comlaser_copy");
    const lib = addLibraryWeapon(
      {},
      copyGameWeapon("arm_comlaser_copy", "arm_comlaser", {}, ""),
    );
    expect(suggestWeaponKey("arm_comlaser", lib)).toBe("arm_comlaser_copy2");
    expect(suggestWeaponKey("Big Gun!", {})).toBe("big_gun_copy");
  });

  it("checks a name the way the compiler will", () => {
    expect(checkWeaponName("", {}).verdict).toBe("empty");
    expect(checkWeaponName("big gun", {}).verdict).toBe("invalid");
    expect(checkWeaponName("heavylaser", library()).verdict).toBe("taken");
    expect(checkWeaponName(" HeavyLaser2 ", library())).toEqual({
      key: "heavylaser2",
      verdict: "ok",
      ok: true,
    });
  });

  it("equips one weapon per slot and puts slots back", () => {
    let eq = equipWeapon({}, "armcom", "0", "heavylaser");
    eq = equipWeapon(eq, "armcom", "2", "heavylaser");
    eq = equipWeapon(eq, "corcom", "0", "heavylaser");
    eq = equipWeapon(eq, "corcom", "0", "other");
    expect(eq).toEqual({
      armcom: { "0": "heavylaser", "2": "heavylaser" },
      corcom: { "0": "other" },
    });
    expect(equippedCount(eq)).toBe(3);
    expect(mountsOf(eq, "heavylaser")).toEqual([
      { unit: "armcom", step: "0" },
      { unit: "armcom", step: "2" },
    ]);
    expect(equipWeapon(eq, "corcom", "0", "other")).toBe(eq);
    expect(unequipWeapon(eq, "corcom", "0")).toEqual({
      armcom: { "0": "heavylaser", "2": "heavylaser" },
    });
    expect(unequipEverywhere(eq, "heavylaser")).toEqual({
      corcom: { "0": "other" },
    });
    expect(unequipUnit(eq, "armcom")).toEqual({ corcom: { "0": "other" } });
    expect(unequipWeapon(eq, "armcom", "9")).toBe(eq);
  });

  it("refuses a name the unit already carries a definition under", () => {
    const def = { weapondefs: { ArmComLaser: {} } };
    expect(equipRefusal(def, "Commander", "armcomlaser")).toMatch(
      /already carries a weapon definition called armcomlaser/,
    );
    expect(equipRefusal(def, "Commander", "heavylaser")).toBeUndefined();
    expect(equipRefusal({}, "Commander", "heavylaser")).toBeUndefined();
  });

  it("reads both stores out of untrusted JSON, dropping what it cannot use", () => {
    expect(
      parseWeaponLibrary({
        heavylaser: {
          key: "heavylaser",
          source: "a",
          def: { range: 1 },
          changes: {},
        },
        mismatched: { key: "other", def: {} },
        "bad key": { key: "bad key", def: {} },
        nodef: { key: "nodef" },
      }),
    ).toEqual({
      heavylaser: { key: "heavylaser", source: "a", def: { range: 1 } },
    });
    expect(
      parseEquippedWeapons({
        armcom: { "0": "heavylaser", x: "y", "1": 5 },
        empty: {},
        junk: "no",
      }),
    ).toEqual({ armcom: { "0": "heavylaser" } });
    expect(parseWeaponLibrary(undefined)).toEqual({});
  });

  /** Issue #2642. A death explosion is equipped under its field's name. */
  it("equips a death explosion beside the slots and lists it after them", () => {
    let eq = equipWeapon({}, "armcom", "selfdestructas", "blast");
    eq = equipWeapon(eq, "armcom", "explodeas", "blast");
    eq = equipWeapon(eq, "armcom", "10", "blast");
    eq = equipWeapon(eq, "armcom", "2", "blast");
    expect(mountsOf(eq, "blast").map((m) => m.step)).toEqual([
      "2",
      "10",
      "explodeas",
      "selfdestructas",
    ]);
    expect(equippedCount(eq)).toBe(4);
    expect(deathExplosionCount(eq)).toBe(2);
    expect(
      parseEquippedWeapons({
        armcom: { explodeas: "blast", selfDestructAs: "blast", other: "x" },
      }),
    ).toEqual({ armcom: { explodeas: "blast" } });
  });
});
