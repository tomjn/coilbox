import { describe, expect, it } from "vitest";
import {
  addToBuildMenu,
  applyBuildMenu,
  type BuildMenus,
  builderFlagOf,
  buildMenuOpCount,
  buildOptionsOf,
  clearBuildMenu,
  isBuilder,
  moveBeforeInBuildMenu,
  removeFromBuildMenu,
  resolvedBuildMenu,
} from "./buildMenus";
import { setOverride, type UnitOverrides } from "./overrides";

const LAB: Record<string, unknown> = {
  builder: true,
  buildoptions: ["armpw", "armrock", "armham"],
};

describe("buildOptionsOf", () => {
  it("reads the lowercased key the def data actually carries", () => {
    expect(buildOptionsOf(LAB)).toEqual(["armpw", "armrock", "armham"]);
  });

  it("reads the engine's spelling too, since only case separates them", () => {
    expect(buildOptionsOf({ buildOptions: ["armpw"] })).toEqual(["armpw"]);
  });

  it("lowercases the entries, because a def may name a unit in any case", () => {
    expect(buildOptionsOf({ buildoptions: ["ARMPW", " armrock "] })).toEqual([
      "armpw",
      "armrock",
    ]);
  });

  it("reads an empty Lua table, which arrives as an object rather than a list", () => {
    expect(buildOptionsOf({ buildoptions: {} })).toEqual([]);
  });

  it("keeps a repeated entry once", () => {
    expect(buildOptionsOf({ buildoptions: ["armpw", "armpw"] })).toEqual([
      "armpw",
    ]);
  });

  it("is empty for a unit that builds nothing", () => {
    expect(buildOptionsOf({ health: 10 })).toEqual([]);
    expect(buildOptionsOf(undefined)).toEqual([]);
  });
});

describe("isBuilder", () => {
  it("is true for a unit that declares a build list", () => {
    expect(isBuilder(LAB)).toBe(true);
    expect(isBuilder({ buildoptions: {} })).toBe(true);
  });

  it("is true for a builder whose list is still to be written", () => {
    expect(isBuilder({ builder: true })).toBe(true);
  });

  it("is false for a unit that neither builds nor lists", () => {
    expect(isBuilder({ builder: false, health: 10 })).toBe(false);
    expect(isBuilder(undefined)).toBe(false);
  });
});

describe("builderFlagOf", () => {
  /** The case the panel warns about: a full roster the engine will ignore. */
  it("is false for a def with a build list and the flag off", () => {
    expect(isBuilder({ buildoptions: ["armpw"], builder: false })).toBe(true);
    expect(builderFlagOf({ buildoptions: ["armpw"], builder: false })).toBe(
      false,
    );
  });

  it("is false for a def that never mentions it, which is the engine default", () => {
    expect(builderFlagOf({ buildoptions: ["armpw"] })).toBe(false);
    expect(builderFlagOf(undefined)).toBe(false);
  });

  it("reads the key in whatever case the def wrote it", () => {
    expect(builderFlagOf(LAB)).toBe(true);
    expect(builderFlagOf({ Builder: true })).toBe(true);
  });
});

describe("editing a build menu", () => {
  const inherited = buildOptionsOf(LAB);

  it("adds a unit on the end", () => {
    const menus = addToBuildMenu({}, "armlab", "armpw2", inherited);
    expect(applyBuildMenu(inherited, menus.armlab)).toEqual([
      "armpw",
      "armrock",
      "armham",
      "armpw2",
    ]);
  });

  it("adds another faction's unit exactly like its own", () => {
    const menus = addToBuildMenu({}, "armlab", "corak", inherited);
    expect(resolvedBuildMenu(menus, "armlab", LAB)).toContain("corak");
  });

  it("records nothing for a unit the builder already builds", () => {
    expect(addToBuildMenu({}, "armlab", "armpw", inherited)).toEqual({});
  });

  it("removes a unit", () => {
    const menus = removeFromBuildMenu({}, "armlab", "armrock", inherited);
    expect(applyBuildMenu(inherited, menus.armlab)).toEqual([
      "armpw",
      "armham",
    ]);
  });

  it("records nothing for a unit that is not in the menu", () => {
    expect(removeFromBuildMenu({}, "armlab", "corak", inherited)).toEqual({});
  });

  it("moves a unit up", () => {
    const menus = moveBeforeInBuildMenu(
      {},
      "armlab",
      "armham",
      "armrock",
      inherited,
    );
    expect(applyBuildMenu(inherited, menus.armlab)).toEqual([
      "armpw",
      "armham",
      "armrock",
    ]);
  });

  it("moves a unit down", () => {
    const menus = moveBeforeInBuildMenu(
      {},
      "armlab",
      "armpw",
      "armham",
      inherited,
    );
    expect(applyBuildMenu(inherited, menus.armlab)).toEqual([
      "armrock",
      "armpw",
      "armham",
    ]);
  });

  it("moves a unit to the end", () => {
    const menus = moveBeforeInBuildMenu({}, "armlab", "armpw", null, inherited);
    expect(applyBuildMenu(inherited, menus.armlab)).toEqual([
      "armrock",
      "armham",
      "armpw",
    ]);
  });

  /** The anchor a drop lands on is the row it was dropped before, and dropping
   *  a row on itself is where it already was. */
  it("records nothing for a move that changes nothing", () => {
    expect(
      moveBeforeInBuildMenu({}, "armlab", "armpw", "armrock", inherited),
    ).toEqual({});
    expect(
      moveBeforeInBuildMenu({}, "armlab", "armham", null, inherited),
    ).toEqual({});
    expect(
      moveBeforeInBuildMenu({}, "armlab", "armpw", "armpw", inherited),
    ).toEqual({});
  });

  it("records nothing for a unit that is not on the menu", () => {
    expect(
      moveBeforeInBuildMenu({}, "armlab", "corak", "armpw", inherited),
    ).toEqual({});
  });

  /** The reason the anchor is stored rather than an index: a unit the game adds
   *  to this factory later must not be shoved by somebody's old reorder. */
  it("keeps its meaning when the game grows the list", () => {
    const menus = moveBeforeInBuildMenu(
      {},
      "armlab",
      "armham",
      "armpw",
      inherited,
    );
    expect(applyBuildMenu(["armnewunit", ...inherited], menus.armlab)).toEqual([
      "armnewunit",
      "armham",
      "armpw",
      "armrock",
    ]);
  });

  it("forgets an add that was taken back out again", () => {
    let menus: BuildMenus = addToBuildMenu({}, "armlab", "corak", inherited);
    menus = removeFromBuildMenu(menus, "armlab", "corak", inherited);
    expect(menus).toEqual({});
  });

  it("forgets a move that put a unit back where it started", () => {
    let menus: BuildMenus = moveBeforeInBuildMenu(
      {},
      "armlab",
      "armpw",
      "armham",
      inherited,
    );
    menus = moveBeforeInBuildMenu(
      menus,
      "armlab",
      "armpw",
      "armrock",
      inherited,
    );
    expect(menus).toEqual({});
  });

  it("puts a removed unit back on the end, not back where it was", () => {
    let menus: BuildMenus = removeFromBuildMenu(
      {},
      "armlab",
      "armpw",
      inherited,
    );
    menus = addToBuildMenu(menus, "armlab", "armpw", inherited);
    expect(applyBuildMenu(inherited, menus.armlab)).toEqual([
      "armrock",
      "armham",
      "armpw",
    ]);
  });

  it("drops a builder once the menu is back to what the game says", () => {
    let menus: BuildMenus = removeFromBuildMenu(
      {},
      "armlab",
      "armpw",
      inherited,
    );
    expect(Object.keys(menus)).toEqual(["armlab"]);
    menus = addToBuildMenu(menus, "armlab", "armpw", inherited);
    menus = moveBeforeInBuildMenu(
      menus,
      "armlab",
      "armpw",
      "armrock",
      inherited,
    );
    expect(menus).toEqual({});
    expect(buildMenuOpCount(menus)).toBe(0);
  });

  it("clears one builder and leaves the others alone", () => {
    const menus = {
      armlab: addToBuildMenu({}, "armlab", "corak", inherited).armlab,
      corlab: addToBuildMenu({}, "corlab", "armpw", []).corlab,
    };
    expect(Object.keys(clearBuildMenu(menus, "armlab"))).toEqual(["corlab"]);
  });
});

describe("an op set outlives a change to the game underneath it", () => {
  /**
   * The reason these are operations rather than the whole new order. The next
   * patch gives the lab a fourth unit, and the project's own edits still mean
   * what they meant, with the new unit still on the menu.
   */
  it("keeps a unit the game added after the edit was made", () => {
    const before = buildOptionsOf(LAB);
    const menus = moveBeforeInBuildMenu(
      addToBuildMenu({}, "armlab", "corak", before),
      "armlab",
      "corak",
      "armpw",
      before,
    );
    expect(applyBuildMenu(before, menus.armlab)).toEqual([
      "corak",
      "armpw",
      "armrock",
      "armham",
    ]);

    const after = ["armpw", "armrock", "armham", "armfark"];
    expect(applyBuildMenu(after, menus.armlab)).toEqual([
      "corak",
      "armpw",
      "armrock",
      "armham",
      "armfark",
    ]);
  });
});

describe("build menu edits stay out of the sparse override set", () => {
  /**
   * The whole reason this lives in its own store. An edit to a build menu is an
   * edit to a list the game still owns, so writing it into the override set
   * would pin the list and stop the game's own additions ever arriving. Nothing
   * in this module can reach the override set, and this is the test that says
   * so.
   */
  const inherited = buildOptionsOf(LAB);

  it("writes no override for an add, a remove or a move", () => {
    const overrides: UnitOverrides = {};
    let menus: BuildMenus = addToBuildMenu({}, "armlab", "corak", inherited);
    menus = removeFromBuildMenu(menus, "armlab", "armrock", inherited);
    menus = moveBeforeInBuildMenu(menus, "armlab", "corak", "armpw", inherited);

    expect(buildMenuOpCount(menus)).toBeGreaterThan(0);
    expect(overrides).toEqual({});
    expect(Object.keys(overrides)).toHaveLength(0);
  });

  it("leaves an existing override on the same unit untouched", () => {
    const overrides = setOverride({}, "armlab", "health", 5000, 3000);
    const menus = addToBuildMenu({}, "armlab", "corak", inherited);
    expect(overrides).toEqual({ armlab: { health: 5000 } });
    expect(menus.armlab).toEqual([{ op: "add", unit: "corak" }]);
  });

  it("holds no buildoptions path anywhere in the stored shape", () => {
    let menus: BuildMenus = addToBuildMenu({}, "armlab", "corak", inherited);
    menus = moveBeforeInBuildMenu(
      menus,
      "armlab",
      "corak",
      "armham",
      inherited,
    );
    expect(JSON.stringify(menus)).not.toContain("buildoptions");
  });
});
