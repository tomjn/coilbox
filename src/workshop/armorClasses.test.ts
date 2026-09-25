import { describe, expect, it } from "vitest";
import {
  armorClassesOf,
  armorClassOf,
  EMPTY_ARMOR_CLASSES,
  normaliseArmorDefs,
  parseArmorClasses,
  resolvedArmorDefs,
  setArmorClass,
  unknownDamageClasses,
} from "./armorClasses";

const BA_ARMOR_DEFS: Record<string, string[]> = {
  commanders: ["armcom", "corcom"],
  vtol: ["armkam"],
};

describe("normaliseArmorDefs", () => {
  it("keeps only classes whose value is an array of strings", () => {
    expect(
      normaliseArmorDefs({
        commanders: ["armcom", "corcom"],
        broken: "not an array",
        empty: [],
        mixed: ["armkam", 5, null],
      }),
    ).toEqual({ commanders: ["armcom", "corcom"], mixed: ["armkam"] });
  });

  it("is empty for undefined", () => {
    expect(normaliseArmorDefs(undefined)).toEqual({});
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
});

describe("armorClassesOf", () => {
  it("lists every class commonest first, always including default", () => {
    expect(armorClassesOf(BA_ARMOR_DEFS, undefined)).toEqual([
      { name: "commanders", units: 2 },
      { name: "vtol", units: 1 },
      { name: "default", units: 0 },
    ]);
  });

  it("counts a moved unit against its new class", () => {
    expect(armorClassesOf(BA_ARMOR_DEFS, { armkam: "commanders" })).toEqual([
      { name: "commanders", units: 3 },
      { name: "default", units: 0 },
    ]);
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
  });

  it("says nothing about a weapon with no damage table", () => {
    expect(unknownDamageClasses({ range: 300 }, known, "armcomlaser")).toEqual(
      [],
    );
    expect(unknownDamageClasses(undefined, known, "armcomlaser")).toEqual([]);
  });
});
