import { describe, expect, it } from "vitest";
import {
  addToBuildMenu,
  type BuildMenus,
  buildOptionsOf,
  removeFromBuildMenu,
} from "./buildMenus";
import { addClone, deriveClone, type UnitClones } from "./clones";
import {
  type DisabledUnits,
  isUnitDisabled,
  setUnitDisabled,
} from "./disabled";
import { setOverride, type UnitOverrides } from "./overrides";

describe("switching a unit off", () => {
  it("starts with nothing switched off", () => {
    expect(isUnitDisabled([], "armcom")).toBe(false);
  });

  it("records the unit, and switching it back on forgets it", () => {
    const off = setUnitDisabled([], "armcom", true);
    expect(off).toEqual(["armcom"]);
    expect(isUnitDisabled(off, "armcom")).toBe(true);
    expect(setUnitDisabled(off, "armcom", false)).toEqual([]);
  });

  it("holds a unit once however many times it is switched off", () => {
    const off = setUnitDisabled(
      setUnitDisabled([], "armcom", true),
      "armcom",
      true,
    );
    expect(off).toEqual(["armcom"]);
  });

  it("reads and writes the lowercased def key, whatever case it is given", () => {
    const off = setUnitDisabled([], " ARMCOM ", true);
    expect(off).toEqual(["armcom"]);
    expect(isUnitDisabled(off, "ArmCom")).toBe(true);
  });

  it("is sorted, so the order things were switched off in says nothing", () => {
    const a = setUnitDisabled(
      setUnitDisabled([], "corcom", true),
      "armcom",
      true,
    );
    const b = setUnitDisabled(
      setUnitDisabled([], "armcom", true),
      "corcom",
      true,
    );
    expect(a).toEqual(b);
  });

  it("hands back the set it was given when nothing would change", () => {
    const off: DisabledUnits = ["armcom"];
    expect(setUnitDisabled(off, "corcom", false)).toBe(off);
    expect(setUnitDisabled(off, "armcom", true)).toBe(off);
    expect(setUnitDisabled(off, "  ", true)).toBe(off);
  });
});

/**
 * The guarantee the issue turns on: the mark is a mark. Disabling must not
 * reach into the sparse override set, the units the project adds, or the build
 * menu operations, because if it did, switching the unit back on could not put
 * every placement back exactly the way it was found.
 */
describe("switching a unit off touches nothing else the project holds", () => {
  const LAB: Record<string, unknown> = {
    name: "armlab",
    humanName: "Bot Lab",
    builder: true,
    buildoptions: ["armpw", "armrock", "armham"],
  };
  const inherited = buildOptionsOf(LAB);

  /** A project with a change of each other kind already made in it. */
  const project = () => {
    const overrides: UnitOverrides = setOverride(
      {},
      "armpw",
      "health",
      200,
      100,
    );
    const clones: UnitClones = addClone(
      {},
      deriveClone({
        key: "armpw2",
        source: "armpw",
        sourceDef: { name: "armpw", health: 100 },
        displayName: "Peewee II",
        replacesGameUnit: false,
      }),
    );
    const menus: BuildMenus = addToBuildMenu(
      removeFromBuildMenu({}, "armlab", "armrock", inherited),
      "armlab",
      "armpw2",
      inherited,
    );
    return { overrides, clones, menus };
  };

  it("writes nothing into the overrides, the clones or the build menus", () => {
    const before = project();
    const after = project();
    const off = setUnitDisabled([], "armpw", true);

    expect(off).toEqual(["armpw"]);
    expect(after.overrides).toEqual(before.overrides);
    expect(after.clones).toEqual(before.clones);
    expect(after.menus).toEqual(before.menus);
  });

  it("leaves all three exactly as they were when it is switched back on", () => {
    const { overrides, clones, menus } = project();
    // Snapshotted before, so an accidental mutation of the stored value shows
    // up rather than being compared against itself.
    const snapshot = structuredClone({ overrides, clones, menus });

    const off = setUnitDisabled([], "armpw", true);
    const on = setUnitDisabled(off, "armpw", false);

    expect(on).toEqual([]);
    expect({ overrides, clones, menus }).toEqual(snapshot);
    // And the build menu the unit sits in still says exactly what it said: the
    // disable never wrote a `remove` that switching back on would have to undo.
    expect(menus.armlab).toEqual([
      { op: "remove", unit: "armrock" },
      { op: "add", unit: "armpw2" },
    ]);
  });
});
