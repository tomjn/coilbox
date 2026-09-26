import { describe, expect, it } from "vitest";
import {
  armorClassesOf,
  armorClassOf,
  EMPTY_ARMOR_CLASSES,
  normaliseArmorDefs,
  parseArmorClasses,
  projectDamageClassProblems,
  rebaseArmorClasses,
  resolvedArmorDefs,
  setArmorClass,
  unknownDamageClasses,
} from "./armorClasses";
import type { UnitClones } from "./clones";
import type { UnitOverrides } from "./overrides";
import type { WeaponLibrary } from "./weaponLibrary";

const BA_ARMOR_DEFS: Record<string, string[]> = {
  commanders: ["armcom", "corcom"],
  vtol: ["armkam"],
};

describe("normaliseArmorDefs", () => {
  it("keeps every class the game declared as an array, even an empty one", () => {
    expect(
      normaliseArmorDefs({
        commanders: ["armcom", "corcom"],
        broken: "not an array",
        shields: [],
        mixed: ["armkam", 5, null],
      }),
    ).toEqual({
      commanders: ["armcom", "corcom"],
      shields: [],
      mixed: ["armkam"],
    });
  });

  it("is empty for undefined", () => {
    expect(normaliseArmorDefs(undefined)).toEqual({});
  });

  /** The worker's Lua-to-JSON encoder writes a truly empty table as `{}`,
   *  not `[]`, because an empty table has no `1..n` run to read as an array
   *  (`weaponSlots.ts`'s `mountNames` hits the same shape). Beyond All
   *  Reason's `shields` class is exactly this: real, and empty. */
  it("reads a table the encoder wrote as an empty object as an empty class", () => {
    expect(normaliseArmorDefs({ shields: {} })).toEqual({ shields: [] });
  });
});

describe("armorClassOf", () => {
  it("finds the class naming the unit, case insensitively", () => {
    expect(armorClassOf(BA_ARMOR_DEFS, undefined, "ARMCOM")).toBe("commanders");
  });

  it("falls back to default for a unit named nowhere", () => {
    expect(armorClassOf(BA_ARMOR_DEFS, undefined, "armsolar")).toBe("default");
  });

  it("prefers a project move over the game's own membership", () => {
    expect(
      armorClassOf(BA_ARMOR_DEFS, { armcom: "heavyunits" }, "armcom"),
    ).toBe("heavyunits");
  });
});

describe("resolvedArmorDefs", () => {
  it("returns the game's own table when nothing has moved", () => {
    expect(resolvedArmorDefs(BA_ARMOR_DEFS, undefined)).toBe(BA_ARMOR_DEFS);
    expect(resolvedArmorDefs(BA_ARMOR_DEFS, {})).toBe(BA_ARMOR_DEFS);
  });

  it("moves a unit out of its old class and into the new one", () => {
    expect(resolvedArmorDefs(BA_ARMOR_DEFS, { armcom: "heavyunits" })).toEqual({
      commanders: ["corcom"],
      vtol: ["armkam"],
      heavyunits: ["armcom"],
    });
  });

  it("moving to default only removes the unit, adding nowhere", () => {
    expect(resolvedArmorDefs(BA_ARMOR_DEFS, { armcom: "default" })).toEqual({
      commanders: ["corcom"],
      vtol: ["armkam"],
    });
  });

  it("keeps a class the game declares with nothing in it, even once something moves", () => {
    const withShields = { ...BA_ARMOR_DEFS, shields: [] };
    expect(
      resolvedArmorDefs(withShields, { armcom: "heavyunits" }).shields,
    ).toEqual([]);
  });
});

describe("armorClassesOf", () => {
  it("lists every class commonest first, always including default", () => {
    expect(armorClassesOf(BA_ARMOR_DEFS, undefined)).toEqual([
      { name: "commanders", units: 2 },
      { name: "vtol", units: 1 },
      { name: "default", units: 0 },
    ]);
  });

  it("counts a moved unit against its new class, keeping its old one at zero", () => {
    expect(armorClassesOf(BA_ARMOR_DEFS, { armkam: "commanders" })).toEqual([
      { name: "commanders", units: 3 },
      { name: "default", units: 0 },
      { name: "vtol", units: 0 },
    ]);
  });

  /** Beyond All Reason ships exactly this: a `shields` class with nobody in
   *  it yet. A weapon's damage table naming it is naming a real class, and
   *  {@link unknownDamageClasses} has to be given it as one (issue #2645). */
  it("lists a class the game declares with no members", () => {
    const withShields = { ...BA_ARMOR_DEFS, shields: [] };
    expect(armorClassesOf(withShields, undefined)).toContainEqual({
      name: "shields",
      units: 0,
    });
  });
});

describe("setArmorClass", () => {
  it("records a move and snapshots the game's own table the first time", () => {
    const next = setArmorClass(
      undefined,
      BA_ARMOR_DEFS,
      "armcom",
      "heavyunits",
      "commanders",
    );
    expect(next).toEqual({
      base: BA_ARMOR_DEFS,
      moves: { armcom: "heavyunits" },
    });
  });

  it("reuses the existing snapshot for a second move rather than the live game", () => {
    const first = setArmorClass(
      undefined,
      BA_ARMOR_DEFS,
      "armcom",
      "heavyunits",
      "commanders",
    );
    const liveNow: Record<string, string[]> = { commanders: ["someoneelse"] };
    const second = setArmorClass(first, liveNow, "armkam", "vtol2", "vtol");
    expect(second?.base).toBe(BA_ARMOR_DEFS);
    expect(second?.moves).toEqual({ armcom: "heavyunits", armkam: "vtol2" });
  });

  it("setting a unit back to its inherited class clears the move", () => {
    const moved = setArmorClass(
      undefined,
      BA_ARMOR_DEFS,
      "armcom",
      "heavyunits",
      "commanders",
    );
    const cleared = setArmorClass(
      moved,
      BA_ARMOR_DEFS,
      "armcom",
      "commanders",
      "commanders",
    );
    expect(cleared).toBeUndefined();
  });

  it("clearing one of several moves keeps the rest and the snapshot", () => {
    const first = setArmorClass(
      undefined,
      BA_ARMOR_DEFS,
      "armcom",
      "heavyunits",
      "commanders",
    );
    const both = setArmorClass(first, BA_ARMOR_DEFS, "armkam", "mines", "vtol");
    const clearedOne = setArmorClass(
      both,
      BA_ARMOR_DEFS,
      "armcom",
      "commanders",
      "commanders",
    );
    expect(clearedOne).toEqual({
      base: BA_ARMOR_DEFS,
      moves: { armkam: "mines" },
    });
  });

  it("a no-op against a project that has never moved anything stays empty", () => {
    expect(
      setArmorClass(
        undefined,
        BA_ARMOR_DEFS,
        "armcom",
        "commanders",
        "commanders",
      ),
    ).toBeUndefined();
  });
});

describe("rebaseArmorClasses", () => {
  const moved = setArmorClass(
    undefined,
    BA_ARMOR_DEFS,
    "armcom",
    "heavyunits",
    "commanders",
  );

  it("does nothing for a project that has never moved a unit", () => {
    expect(
      rebaseArmorClasses(undefined, { commanders: ["armcom", "corcom"] }),
    ).toBeNull();
  });

  it("does nothing once the snapshot already matches the live game", () => {
    expect(rebaseArmorClasses(moved, BA_ARMOR_DEFS)).toBeNull();
  });

  it("ignores member order and array-vs-object emptiness when comparing", () => {
    const reordered = { vtol: ["armkam"], commanders: ["corcom", "armcom"] };
    expect(rebaseArmorClasses(moved, reordered)).toBeNull();
  });

  it("refreshes the snapshot when the game's own membership has changed, keeping the moves", () => {
    const updated = { commanders: ["corcom"], vtol: ["armkam", "armseer"] };
    expect(rebaseArmorClasses(moved, updated)).toEqual({
      base: updated,
      moves: { armcom: "heavyunits" },
    });
  });

  it("picks up a class the game added since the snapshot was taken", () => {
    const withNewClass = { ...BA_ARMOR_DEFS, shields: [] };
    expect(rebaseArmorClasses(moved, withNewClass)).toEqual({
      base: withNewClass,
      moves: { armcom: "heavyunits" },
    });
  });

  it("picks up a class the game removed since the snapshot was taken", () => {
    const withoutVtol = { commanders: ["armcom", "corcom"] };
    expect(rebaseArmorClasses(moved, withoutVtol)).toEqual({
      base: withoutVtol,
      moves: { armcom: "heavyunits" },
    });
  });

  /** "heavyunits" above was never a real class: it is a name `setArmorClass`
   *  invented, and BA_ARMOR_DEFS never carried it, so those cases above are
   *  really testing that an invented class is left alone. This is the other
   *  case: a class that really was in the game when the project moved a unit
   *  into it. */
  it("keeps a class the game has since removed, but only while a move still targets it", () => {
    const movedToReal = setArmorClass(
      undefined,
      BA_ARMOR_DEFS,
      "armkam",
      "commanders",
      "vtol",
    );
    const withoutCommanders = { vtol: [] };
    expect(rebaseArmorClasses(movedToReal, withoutCommanders)).toEqual({
      base: { vtol: [], commanders: ["armcom", "corcom"] },
      moves: { armkam: "commanders" },
    });
  });

  it("drops a preserved class once no move targets it any more", () => {
    // As if "commanders" had already been preserved by an earlier rebase
    // while armkam targeted it, and the project has since moved armkam
    // somewhere else, leaving corak's own unrelated move as the only one left.
    const noLongerTargeted = {
      base: { vtol: [], commanders: ["armcom", "corcom"] },
      moves: { corak: "vtol" },
    };
    expect(rebaseArmorClasses(noLongerTargeted, { vtol: [] })).toEqual({
      base: { vtol: [] },
      moves: { corak: "vtol" },
    });
  });
});

describe("parseArmorClasses", () => {
  it("reads a project's own shape back", () => {
    const value = {
      base: { commanders: ["armcom"] },
      moves: { armcom: "heavyunits" },
    };
    expect(parseArmorClasses(value)).toEqual(value);
  });

  it("is empty for a project saved before this existed", () => {
    expect(parseArmorClasses(undefined)).toBe(EMPTY_ARMOR_CLASSES);
    expect(parseArmorClasses({})).toEqual(EMPTY_ARMOR_CLASSES);
  });

  it("drops a move whose value is not a usable string", () => {
    expect(
      parseArmorClasses({ moves: { armcom: 5, corcom: "  ", armkam: "vtol" } }),
    ).toEqual({ base: {}, moves: { armkam: "vtol" } });
  });
});

describe("unknownDamageClasses", () => {
  const known = ["commanders", "vtol"];

  it("says nothing about default or a known class", () => {
    expect(
      unknownDamageClasses(
        { damage: { default: 100, Commanders: 50, VTOL: 10 } },
        known,
        "armcomlaser",
      ),
    ).toEqual([]);
  });

  it("reports a class named in neither the game nor the project", () => {
    const problems = unknownDamageClasses(
      { damage: { default: 100, subs: 20 } },
      known,
      "armcomlaser",
    );
    expect(problems).toHaveLength(1);
    expect(problems[0].message).toContain("subs");
    expect(problems[0].message).toContain("armcomlaser");
    expect(problems[0].severity).toBe("warning");
  });

  it("groups several unknown classes on one weapon into one finding", () => {
    const problems = unknownDamageClasses(
      {
        damage: {
          default: 100,
          bombers: 10,
          fighters: 10,
          subs: 10,
          vtol2: 10,
        },
      },
      known,
      "gator_laser",
    );
    expect(problems).toHaveLength(1);
    expect(problems[0].message).toBe(
      "gator_laser's damage table names 4 armour classes this game does not have: bombers, fighters, subs, vtol2. The engine uses the default damage for them instead, so these rows have no effect.",
    );
  });

  it("says nothing about a weapon with no damage table", () => {
    expect(unknownDamageClasses({ range: 300 }, known, "armcomlaser")).toEqual(
      [],
    );
    expect(unknownDamageClasses(undefined, known, "armcomlaser")).toEqual([]);
  });
});

describe("projectDamageClassProblems", () => {
  const known = ["commanders", "vtol"];
  const gameUnits: Record<string, Record<string, unknown>> = {
    armcom: { weapondefs: { armcomlaser: { damage: { default: 100 } } } },
  };

  it("scans a unit's own weapondefs, with the project's overrides applied", () => {
    const overrides: UnitOverrides = {
      armcom: { "weapondefs.armcomlaser.damage.subs": 20 },
    };
    const problems = projectDamageClassProblems(
      overrides,
      {},
      gameUnits,
      {},
      known,
    );
    expect(problems).toHaveLength(1);
    expect(problems[0].id).toBe("armcom:armcomlaser:damage");
    expect(problems[0].message).toContain("subs");
  });

  it("scans a project clone's own weapondefs", () => {
    const clones: UnitClones = {
      armkam2: {
        key: "armkam2",
        replacesGameUnit: false,
        def: { weapondefs: { laser: { damage: { subs: 20 } } } },
      },
    };
    const problems = projectDamageClassProblems(
      {},
      clones,
      gameUnits,
      {},
      known,
    );
    expect(problems).toHaveLength(1);
    expect(problems[0].id).toBe("armkam2:laser:damage");
  });

  it("scans every weapon the project's library holds, not only ones a unit fires", () => {
    const library: WeaponLibrary = {
      mylaser: { key: "mylaser", source: "armcomlaser", def: {} },
    };
    library.mylaser.changes = { "damage.subs": 20 };
    const problems = projectDamageClassProblems(
      {},
      {},
      gameUnits,
      library,
      known,
    );
    expect(problems).toHaveLength(1);
    expect(problems[0].id).toBe("library:mylaser:damage");
  });

  it("is empty for a project that touches nothing and holds no weapons", () => {
    expect(projectDamageClassProblems({}, {}, gameUnits, {}, known)).toEqual(
      [],
    );
  });
});
