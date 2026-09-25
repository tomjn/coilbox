import { describe, expect, it } from "vitest";
import { unitEffectiveDerivedStats, unitEffectiveWeapons } from "./unitWeapons";
import type { WeaponLibrary } from "./weaponLibrary";

const gameLaser = {
  weaponType: "Cannon",
  range: 300,
  reloadTime: 2,
  damage: { default: 50 },
};

function tank(overrides: Record<string, unknown> = {}) {
  return {
    health: 1000,
    metalCost: 200,
    weapons: [{ name: "armtank_laser" }],
    weapondefs: { laser: gameLaser },
    ...overrides,
  };
}

const LIBRARY: WeaponLibrary = {
  bigcannon: {
    key: "bigcannon",
    source: "bigcannon",
    def: {
      weaponType: "Cannon",
      range: 500,
      reloadTime: 1,
      damage: { default: 100 },
    },
  },
};

describe("unitEffectiveWeapons", () => {
  it("resolves a slot's own definition when nothing is equipped", () => {
    const weapons = unitEffectiveWeapons(
      tank(),
      {},
      ["armtank"],
      {},
      undefined,
    );
    expect(weapons).toHaveLength(1);
    expect(weapons[0].def).toBe(gameLaser);
  });

  it("stands an equipped library weapon in for the slot's own definition (issue #3081)", () => {
    const weapons = unitEffectiveWeapons(tank(), {}, ["armtank"], LIBRARY, {
      "0": "bigcannon",
    });
    expect(weapons).toHaveLength(1);
    expect(weapons[0].def.range).toBe(500);
  });

  it("fires nothing for a slot naming a definition nobody carries", () => {
    const weapons = unitEffectiveWeapons(
      { weapons: [{ name: "nothing" }] },
      {},
      ["armtank"],
      {},
      undefined,
    );
    expect(weapons).toEqual([]);
  });

  it("excludes a slaved weapon from the sum, the same as the unit editor", () => {
    const weapons = unitEffectiveWeapons(
      {
        weapons: [{ name: "armtank_laser", slaveTo: 1 }],
        weapondefs: { laser: gameLaser },
      },
      {},
      ["armtank"],
      {},
      undefined,
    );
    expect(weapons[0].excludeFromSum).toBe("slaved");
  });
});

describe("unitEffectiveDerivedStats", () => {
  it("changes DPS when a slot fires an equipped library weapon", () => {
    const unequipped = unitEffectiveDerivedStats(
      { def: tank() },
      {},
      ["armtank"],
      LIBRARY,
      undefined,
    );
    // 50 damage every 2 seconds.
    expect(unequipped.dps).toBe(25);

    const equipped = unitEffectiveDerivedStats(
      { def: tank() },
      {},
      ["armtank"],
      LIBRARY,
      { "0": "bigcannon" },
    );
    // 100 damage every second, off the equipped weapon instead.
    expect(equipped.dps).toBe(100);
  });
});
