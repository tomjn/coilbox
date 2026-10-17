import { describe, expect, it } from "vitest";
import { statFields, unitStats, withKeptFields } from "./unitStats";

const LASER = { weapontype: "LaserCannon", range: 300, reloadtime: 2 } as const;
const laser = (damage: number) => ({ ...LASER, damage: { default: damage } });

describe("unitStats", () => {
  it("reads cost, health and speed off the definition", () => {
    const stats = unitStats(
      { buildcostmetal: 120, maxdamage: 900, speed: 55 },
      [],
    );
    expect(stats).toMatchObject({ cost: 120, health: 900, speed: 55 });
  });

  it("reads a game unit's own spellings", () => {
    const stats = unitStats({ metalcost: 90, health: 400, speed: 70 }, []);
    expect(stats).toMatchObject({ cost: 90, health: 400, speed: 70 });
  });

  it("marks a number the unit does not have as missing, not zero", () => {
    expect(unitStats({ buildcostmetal: 10 }, [])).toEqual({
      cost: 10,
      health: null,
      speed: null,
      range: null,
      dps: null,
    });
  });

  it("takes the longest range and the summed damage per second", () => {
    const stats = unitStats({}, [
      { def: laser(100) },
      { def: { ...laser(50), range: 450 } },
    ]);
    expect(stats.range).toBe(450);
    expect(stats.dps).toBe(75);
  });

  it("leaves a shield out of the range", () => {
    const stats = unitStats({}, [
      { def: { weapontype: "Shield", range: 900 } },
    ]);
    expect(stats.range).toBeNull();
    expect(stats.dps).toBeNull();
  });
});

const NEXT = {
  buildcostmetal: 200,
  maxdamage: 1000,
  speed: 60,
  weapons: [{ name: "laser" }],
};

describe("withKeptFields", () => {
  it("is the next definition when nothing is in the game yet", () => {
    expect(withKeptFields(NEXT, undefined, undefined)).toEqual({
      def: NEXT,
      kept: [],
    });
  });

  it("is the next definition while the file holds what the last export wrote", () => {
    const last = { ...NEXT, maxdamage: 800 };
    const file = { ...last };
    const out = withKeptFields(NEXT, file, last);
    expect(out.def).toEqual(NEXT);
    expect(out.kept).toEqual([]);
  });

  it("shows the file's value for a field changed by hand", () => {
    const last = { ...NEXT, maxdamage: 800 };
    const file = { ...last, maxdamage: 1500 };
    const out = withKeptFields(NEXT, file, last);
    expect(out.def.maxdamage).toBe(1500);
    expect(out.def.buildcostmetal).toBe(200);
    expect(out.kept).toEqual(["maxdamage"]);
  });

  it("reads the file's keys in any case", () => {
    const last = { ...NEXT, rSpeed: 10 };
    const file = { ...last, rspeed: 25 };
    delete (file as Record<string, unknown>).rSpeed;
    const out = withKeptFields({ ...NEXT, rSpeed: 12 }, file, last);
    expect(out.kept).toEqual(["rSpeed"]);
  });

  it("treats a field the player removed as kept, and so missing", () => {
    const last = { ...NEXT };
    const { speed: _gone, ...file } = last;
    const out = withKeptFields(NEXT, file, last);
    expect(out.def.speed).toBeUndefined();
    expect(out.kept).toEqual(["speed"]);
  });

  it("treats a weapons list the game reads as the same list as unchanged", () => {
    const last = { ...NEXT, weapons: [{ name: "laser" }, { name: "gun" }] };
    const file = {
      ...last,
      weapons: { "1": { name: "laser" }, "2": { name: "gun" } },
    };
    expect(withKeptFields(NEXT, file, last).kept).toEqual([]);
  });

  it("keeps the whole file when nothing records the builder writing it", () => {
    const file = { buildcostmetal: 5, maxdamage: 6, speed: 7 };
    const out = withKeptFields(NEXT, file, null);
    expect(out.def).toMatchObject(file);
    expect(out.def.weapons).toBeUndefined();
    expect(out.kept).toContain("buildcostmetal");
    expect(out.kept).toContain("weapons");
  });
});

describe("statFields", () => {
  const weaponDefs = {
    pea: { weapontype: "LaserCannon", range: 200, damage: { default: 5 } },
    big: { weapontype: "Cannon", range: 600, damage: { default: 50 } },
  };

  it("names the fields as the file spells them", () => {
    const fields = statFields(
      { buildcostmetal: 1, maxdamage: 2, speed: 3 },
      weaponDefs,
      "rover",
    );
    expect(fields).toMatchObject({
      cost: "buildcostmetal",
      health: "maxdamage",
      speed: "speed",
      range: null,
      dps: null,
    });
  });

  it("leaves out a stat the file has no field for", () => {
    expect(
      statFields({ buildcostmetal: 1 }, weaponDefs, "rover").speed,
    ).toBeNull();
  });

  it("opens the weapon slot that sets the range and the damage", () => {
    const fields = statFields(
      { weapons: [{ name: "pea" }, { name: "big" }] },
      weaponDefs,
      "rover",
    );
    expect(fields.range).toBe("weapons.1.name");
    expect(fields.dps).toBe("weapons.0.name");
  });

  it("opens a weapon the unit carries at its range", () => {
    const fields = statFields(
      {
        weapons: [{ name: "rover_gun" }],
        weapondefs: { gun: { range: 100, weapontype: "Cannon" } },
      },
      weaponDefs,
      "rover",
    );
    expect(fields.range).toBe("weapondefs.gun.range");
  });
});
