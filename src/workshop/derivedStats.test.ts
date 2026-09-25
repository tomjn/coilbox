import { describe, expect, it } from "vitest";
import { unitDerivedStats, weaponStats } from "./derivedStats";
import BA from "./fixtures/ba-units-slice.json";

type Defs = Record<string, Record<string, unknown>>;
const UNITS = BA.units as unknown as Defs;
const WEAPONS = BA.weaponDefs as unknown as Defs;

describe("weaponStats", () => {
  /**
   * Worked example: Balanced Annihilation V15.9.8's `armcom_armcomlaser`, a
   * plain BeamLaser (`beamburst` unset), `damage.default` 75, `reloadTime`
   * 0.4, no `burst`/`burstRate` of its own. Cycle is `reloadTime` alone
   * (0.4s) because a plain BeamLaser's `burst` is 1 regardless of the field,
   * so DPS is 75 / 0.4 = 187.5 and alpha damage is one full 75.
   */
  it("reads a plain BeamLaser's cycle off reloadTime alone", () => {
    const stats = weaponStats({ def: WEAPONS.armcom_armcomlaser });
    expect(stats.weaponType).toBe("BeamLaser");
    expect(stats.effectiveBurst).toBe(1);
    expect(stats.cycleSeconds).toBeCloseTo(0.4);
    expect(stats.damage).toBe(75);
    expect(stats.alphaDamage).toBe(75);
    expect(stats.dps).toBeCloseTo(187.5);
  });

  /**
   * The same weapon with a `burst` a modder added, to prove the engine's
   * override still applies (`BeamLaser.cpp`'s `Init` sets `salvoSize` and
   * `salvoDelay` itself when `beamburst` is off): a naive reader would
   * multiply damage by `burst` and be wrong.
   */
  it("ignores a plain BeamLaser's own burst field", () => {
    const stats = weaponStats({
      def: { ...WEAPONS.armcom_armcomlaser, burst: 5, burstRate: 0.2 },
    });
    expect(stats.effectiveBurst).toBe(1);
    expect(stats.cycleSeconds).toBeCloseTo(0.4);
    expect(stats.alphaDamage).toBe(75);
  });

  it("honours burst and burstRate once beamburst turns them back on", () => {
    const stats = weaponStats({
      def: {
        ...WEAPONS.armcom_armcomlaser,
        beamburst: true,
        burst: 3,
        burstRate: 0.2,
      },
    });
    expect(stats.effectiveBurst).toBe(3);
    // max(reloadTime 0.4, 3 * 0.2) = 0.6
    expect(stats.cycleSeconds).toBeCloseTo(0.6);
    expect(stats.alphaDamage).toBe(75 * 3);
    expect(stats.dps).toBeCloseTo((75 * 3) / 0.6);
  });

  it("multiplies damage by projectiles and burst for an ordinary weapon", () => {
    const stats = weaponStats({
      def: {
        weaponType: "Cannon",
        damage: { default: 20 },
        reloadTime: 2,
        burst: 3,
        burstRate: 0.1,
        projectiles: 2,
      },
    });
    // cycle = max(2, 3*0.1) = 2
    expect(stats.cycleSeconds).toBe(2);
    expect(stats.alphaDamage).toBe(20 * 2 * 3);
    expect(stats.dps).toBeCloseTo((20 * 2 * 3) / 2);
  });

  it("uses the burst duration as the cycle when it outlasts reloadTime", () => {
    const stats = weaponStats({
      def: {
        weaponType: "Cannon",
        damage: { default: 10 },
        reloadTime: 0.5,
        burst: 10,
        burstRate: 0.2,
      },
    });
    // cycle = max(0.5, 10*0.2=2) = 2
    expect(stats.cycleSeconds).toBe(2);
    expect(stats.dps).toBeCloseTo((10 * 10) / 2);
  });

  it("defaults damage to 1 for a weapon with no damage table", () => {
    const stats = weaponStats({ def: { weaponType: "Cannon" } });
    expect(stats.damage).toBe(1);
  });

  /** RecoilEngine's own words: paralyzer damage is stun, not lost hit points. */
  it("states nothing for a paralyzer's DPS or alpha damage", () => {
    const stats = weaponStats({
      def: { weaponType: "Cannon", paralyzer: true, damage: { default: 500 } },
    });
    expect(stats.omitted).toBe("paralyzer");
    expect(stats.dps).toBeNull();
    expect(stats.alphaDamage).toBeNull();
  });

  it("states nothing for a stockpile weapon's DPS or alpha damage", () => {
    const stats = weaponStats({
      def: {
        weaponType: "Missile",
        stockpile: true,
        damage: { default: 9000 },
      },
    });
    expect(stats.omitted).toBe("stockpile");
    expect(stats.dps).toBeNull();
  });

  it("states nothing for a shield's DPS or alpha damage", () => {
    const stats = weaponStats({ def: { weaponType: "Shield" } });
    expect(stats.omitted).toBe("shield");
    expect(stats.dps).toBeNull();
  });

  /** The commander's D-Gun: `commandfire` is the Lua spelling of `manualfire`. */
  it("marks a manual-fire weapon excluded from a unit's sum, but still states its own DPS", () => {
    const stats = weaponStats({ def: WEAPONS.armcom_arm_disintegrator });
    expect(stats.excludedFromSum).toBe("manual");
    expect(stats.dps).not.toBeNull();
  });

  it("lets the caller mark a weapon slaved to another mount", () => {
    const stats = weaponStats({
      def: { weaponType: "Cannon", damage: { default: 10 } },
      excludeFromSum: "slaved",
    });
    expect(stats.excludedFromSum).toBe("slaved");
    expect(stats.dps).not.toBeNull();
  });

  it("defaults range to 10 the way the engine does", () => {
    expect(weaponStats({ def: { weaponType: "Cannon" } }).range).toBe(10);
  });
});

describe("unitDerivedStats", () => {
  /**
   * Worked example: the whole commander, `armcom`. Its three weapon slots
   * are `armcom_armcomlaser` (BeamLaser, damage 75, reload 0.4), and
   * `armcom_armcomsealaser` (BeamLaser, damage 125, reload 1), which both
   * fire automatically, and `armcom_arm_disintegrator` (the D-Gun,
   * `commandfire` true), which is manual and excluded from the sum.
   *
   * `health` falls back to `maxDamage` (3000), and `metalCost` falls back to
   * `buildCostMetal` (2667). `buildTime` is 75000.
   */
  it("derives a real commander's numbers by hand", () => {
    const result = unitDerivedStats(
      { def: UNITS.armcom },
      [
        WEAPONS.armcom_armcomlaser,
        WEAPONS.armcom_armcomsealaser,
        WEAPONS.armcom_arm_disintegrator,
      ].map((def) => ({ def })),
    );

    expect(result.weaponsSummed).toBe(2);
    // 75/0.4 + 125/1 = 187.5 + 125 = 312.5
    expect(result.dps).toBeCloseTo(312.5);
    // 75 + 125 = 200
    expect(result.alphaDamage).toBe(200);
    // 2667 / 3000
    expect(result.costPerHitPoint).toBeCloseTo(2667 / 3000);
    // 312.5 / 2667 * 100
    expect(result.dpsPer100Metal).toBeCloseTo((312.5 / 2667) * 100);
    // 3000 / 75000
    expect(result.hitPointsPerBuildSecond).toBeCloseTo(3000 / 75000);
    // longest range among all three weapons (300, 260, 250) / 2667
    expect(result.rangePerCost).toBeCloseTo(300 / 2667);
  });

  it("states nothing where the unit sets no weapon at all", () => {
    const result = unitDerivedStats(
      { def: { health: 100, metalCost: 50 } },
      [],
    );
    expect(result.dps).toBeNull();
    expect(result.alphaDamage).toBeNull();
    expect(result.rangePerCost).toBeNull();
    expect(result.costPerHitPoint).toBeCloseTo(0.5);
  });

  it("states nothing for cost per hit point when health is unknown", () => {
    const result = unitDerivedStats({ def: { metalCost: 50 } }, []);
    expect(result.costPerHitPoint).toBeNull();
  });

  it("states nothing for hit points per build second when buildTime is 0", () => {
    const result = unitDerivedStats({ def: { health: 100, buildTime: 0 } }, []);
    expect(result.hitPointsPerBuildSecond).toBeNull();
  });

  it("leaves a shield out of DPS and out of the range figure entirely", () => {
    const result = unitDerivedStats({ def: { health: 100, metalCost: 100 } }, [
      { def: { weaponType: "Shield", range: 200 } },
      { def: { weaponType: "Cannon", damage: { default: 10 }, range: 50 } },
    ]);
    expect(result.weaponsSummed).toBe(1);
    expect(result.rangePerCost).toBeCloseTo(50 / 100);
  });
});
