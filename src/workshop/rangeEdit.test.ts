import { describe, expect, it } from "vitest";
import type { BatchOperation, BatchRounding } from "./batchEdit";
import {
  planRangeChanges,
  type RangeEditContext,
  rangeChangeCount,
  unitRangeWeapons,
} from "./rangeEdit";

const NONE: BatchRounding = { kind: "none" };
const PERCENT = (amount: number): BatchOperation => ({
  kind: "multiply",
  factor: 1 + amount / 100,
});
const SET = (value: number): BatchOperation => ({ kind: "set", value });

function context(overrides: Partial<RangeEditContext> = {}): RangeEditContext {
  return {
    units: {
      mecha: {
        weapons: [{ name: "mecha_laser" }, { name: "arm_rocket" }],
        weapondefs: { laser: { range: 300, weaponType: "Cannon" } },
      },
    },
    ownClones: {},
    weaponDefs: {
      arm_rocket: { range: 500, weaponType: "MissileLauncher" },
    },
    overrides: {},
    library: {},
    equipped: {},
    checksum: "abc123",
    beforePostOf: () => undefined,
    ...overrides,
  };
}

describe("unitRangeWeapons", () => {
  it("lists a unit's own weapon and the shared one it does not carry", () => {
    const weapons = unitRangeWeapons("mecha", context());
    expect(weapons.map((w) => [w.label, w.range, w.target.kind])).toEqual([
      ["Weapon 1 (mecha_laser)", 300, "override"],
      ["Weapon 2 (arm_rocket)", 500, "copy"],
    ]);
  });

  it("leaves out a shield, the same filter Range's own column applies", () => {
    const weapons = unitRangeWeapons(
      "mecha",
      context({
        units: {
          mecha: {
            weapons: [{ name: "mecha_shield" }],
            weapondefs: { shield: { range: 400, weaponType: "Shield" } },
          },
        },
      }),
    );
    expect(weapons).toEqual([]);
  });

  it("reads a library weapon's current changes, not its copied value", () => {
    const weapons = unitRangeWeapons(
      "mecha",
      context({
        units: {
          mecha: { weapons: [{ name: "arm_rocket" }] },
        },
        equipped: { mecha: { "0": "rocket_copy" } },
        library: {
          rocket_copy: {
            key: "rocket_copy",
            source: "arm_rocket",
            def: { range: 500, weaponType: "MissileLauncher" },
            changes: { range: 600 },
          },
        },
      }),
    );
    expect(weapons).toEqual([
      {
        label: "Weapon 1 (rocket_copy)",
        range: 600,
        target: {
          kind: "library",
          key: "rocket_copy",
          path: "range",
          inherited: 500,
        },
      },
    ]);
  });
});

describe("planRangeChanges", () => {
  it("raises every non-shield weapon by a percentage, each from its own range", () => {
    const plan = planRangeChanges(context(), ["mecha"], PERCENT(10), NONE);
    expect(plan.rows).toEqual([
      {
        unit: "mecha",
        weapons: [
          {
            label: "Weapon 1 (mecha_laser)",
            before: 300,
            after: 330,
            changed: true,
          },
          {
            label: "Weapon 2 (arm_rocket)",
            before: 500,
            after: 550,
            changed: true,
            copiedAs: "arm_rocket_copy",
          },
        ],
      },
    ]);
    // The unit's own weapon is a plain override.
    expect(plan.overrides).toEqual({
      mecha: { "weapondefs.laser.range": 330 },
    });
    // The shared weapon was copied into the library, equipped into its slot,
    // and given the new range as a change on the copy.
    expect(plan.equipped).toEqual({ mecha: { "1": "arm_rocket_copy" } });
    expect(plan.library.arm_rocket_copy).toMatchObject({
      key: "arm_rocket_copy",
      source: "arm_rocket",
      changes: { range: 550 },
    });
  });

  it("setting to a value touches only the weapon at the unit's longest range", () => {
    const plan = planRangeChanges(context(), ["mecha"], SET(1000), NONE);
    expect(plan.rows).toEqual([
      {
        unit: "mecha",
        weapons: [
          {
            label: "Weapon 2 (arm_rocket)",
            before: 500,
            after: 1000,
            changed: true,
            copiedAs: "arm_rocket_copy",
          },
        ],
      },
    ]);
    // The shorter-ranged own weapon is left alone entirely.
    expect(plan.overrides).toEqual({});
  });

  it("lists a unit with no non-shield weapon as skipped, and writes nothing", () => {
    const ctx = context({
      units: {
        mecha: {
          weapons: [{ name: "mecha_shield" }],
          weapondefs: { shield: { range: 400, weaponType: "Shield" } },
        },
      },
    });
    const plan = planRangeChanges(ctx, ["mecha"], PERCENT(10), NONE);
    expect(plan.rows).toEqual([{ unit: "mecha", weapons: [], skipped: true }]);
    expect(plan.overrides).toEqual({});
    expect(plan.library).toEqual({});
  });

  it("gives two units copying the same shared weapon two distinct copies", () => {
    const ctx = context({
      units: {
        a: { weapons: [{ name: "arm_rocket" }] },
        b: { weapons: [{ name: "arm_rocket" }] },
      },
    });
    const plan = planRangeChanges(ctx, ["a", "b"], PERCENT(10), NONE);
    expect(plan.equipped).toEqual({
      a: { "0": "arm_rocket_copy" },
      b: { "0": "arm_rocket_copy2" },
    });
    expect(Object.keys(plan.library).sort()).toEqual([
      "arm_rocket_copy",
      "arm_rocket_copy2",
    ]);
  });

  it("does not write or copy a weapon whose new value equals what it holds", () => {
    const plan = planRangeChanges(context(), ["mecha"], PERCENT(0), NONE);
    expect(plan.rows[0].weapons.every((w) => !w.changed)).toBe(true);
    expect(plan.rows[0].weapons.every((w) => w.copiedAs === undefined)).toBe(
      true,
    );
    expect(plan.overrides).toEqual({});
    expect(plan.library).toEqual({});
  });

  it("stays one undo step's worth of state: a bulk change across many units is one plan", () => {
    const ctx = context({
      units: {
        mecha: {
          weapons: [{ name: "mecha_laser" }, { name: "arm_rocket" }],
          weapondefs: { laser: { range: 300, weaponType: "Cannon" } },
        },
      },
    });
    const plan = planRangeChanges(ctx, ["mecha"], PERCENT(10), NONE);
    expect(rangeChangeCount(plan.rows)).toBe(1);
  });
});
