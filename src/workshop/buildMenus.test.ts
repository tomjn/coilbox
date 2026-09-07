import { describe, expect, it } from "vitest";
import {
  addToBuildMenu,
  applyBuildMenu,
  type BuildMenus,
  buildMenuOpCount,
  buildOptionsOf,
  clearBuildMenu,
  isBuilder,
  moveInBuildMenu,
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
    const menus = moveInBuildMenu({}, "armlab", "armham", -1, inherited);
    expect(applyBuildMenu(inherited, menus.armlab)).toEqual([
      "armpw",
      "armham",
      "armrock",
    ]);
  });

  it("moves a unit down", () => {
    const menus = moveInBuildMenu({}, "armlab", "armpw", 1, inherited);
    expect(applyBuildMenu(inherited, menus.armlab)).toEqual([
      "armrock",
      "armpw",
      "armham",
    ]);
  });

  it("moves a unit to the end", () => {
    const menus = moveInBuildMenu({}, "armlab", "armpw", 2, inherited);
    expect(applyBuildMenu(inherited, menus.armlab)).toEqual([
      "armrock",
      "armham",
      "armpw",
    ]);
  });

  it("does nothing at either end of the list", () => {
    expect(moveInBuildMenu({}, "armlab", "armpw", -1, inherited)).toEqual({});
    expect(moveInBuildMenu({}, "armlab", "armham", 1, inherited)).toEqual({});
  });

  it("forgets an add that was taken back out again", () => {
    let menus: BuildMenus = addToBuildMenu({}, "armlab", "corak", inherited);
    menus = removeFromBuildMenu(menus, "armlab", "corak", inherited);
    expect(menus).toEqual({});
  });

  it("forgets a move that put a unit back where it started", () => {
    let menus: BuildMenus = moveInBuildMenu(
      {},
      "armlab",
      "armpw",
      1,
      inherited,
    );
    menus = moveInBuildMenu(menus, "armlab", "armpw", -1, inherited);
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
    menus = moveInBuildMenu(menus, "armlab", "armpw", -2, inherited);
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
    const menus = moveInBuildMenu(
      addToBuildMenu({}, "armlab", "corak", before),
      "armlab",
      "corak",
      -3,
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
    menus = moveInBuildMenu(menus, "armlab", "corak", -2, inherited);

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
    menus = moveInBuildMenu(menus, "armlab", "corak", -1, inherited);
    expect(JSON.stringify(menus)).not.toContain("buildoptions");
  });
});
