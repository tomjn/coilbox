import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  SHIPPED_TABLE_LUA,
  shippedEquivalents,
  shippedGroups,
} from "./shippedEquivalents";
import { gameSides } from "./substitution";

/**
 * What Beyond All Reason's own `blueprint_substitution/definitions.lua` really
 * came back as, run through the unitsync Lua parser against the installed game
 * (issue #1526). Kept as it arrived, quoting and all, because the quoting is
 * half of what this reader has to cope with.
 */
const BAR = JSON.parse(
  readFileSync(
    join(__dirname, "fixtures", "bar-substitution-lua.json"),
    "utf8",
  ),
) as { result?: string };

/** The four sides unitsync reports for that same install. `Random` is a real
 *  side of the game and has no buildings of its own, which is exactly the sort
 *  of thing a reader must not trip over. */
const SIDES = gameSides([
  { name: "Armada", startUnit: "armcom" },
  { name: "Cortex", startUnit: "corcom" },
  { name: "Random", startUnit: "dummycom" },
  { name: "Legion", startUnit: "legcom" },
]);

describe("SHIPPED_TABLE_LUA", () => {
  it("reads the file the game keeps its table in", () => {
    expect(SHIPPED_TABLE_LUA).toContain(
      "luaui/Include/blueprint_substitution/definitions.lua",
    );
  });
});

describe("shippedGroups", () => {
  /** 87 categories in the file, one of which it lists twice. */
  it("reads every category out of what the game really returned", () => {
    expect(shippedGroups(BAR.result)).toHaveLength(86);
  });

  it("reads a category as the game's own side keys", () => {
    expect(
      shippedGroups("SOLAR:arm=armsolar|cor=corsolar|leg=legsolar"),
    ).toEqual([{ arm: "armsolar", cor: "corsolar", leg: "legsolar" }]);
  });

  it("drops the quotes the Lua parser wraps a string in", () => {
    expect(shippedGroups('"SOLAR:arm=armsolar|cor=corsolar"')).toEqual([
      { arm: "armsolar", cor: "corsolar" },
    ]);
  });

  it("says nothing about a game that returned nothing", () => {
    expect(shippedGroups(undefined)).toEqual([]);
    expect(shippedGroups("")).toEqual([]);
    expect(shippedGroups('""')).toEqual([]);
  });

  it("drops a category naming one side and one that names none", () => {
    expect(shippedGroups("SOLAR:arm=armsolar;WIND:;GEO")).toEqual([]);
  });

  it("keeps one copy of a category the game lists twice", () => {
    expect(
      shippedGroups("RADAR:arm=armrad|cor=corrad;ADV:arm=armrad|cor=corrad"),
    ).toHaveLength(1);
  });
});

describe("shippedEquivalents", () => {
  it("files the game's side keys under the side names unitsync reports", () => {
    expect(
      shippedEquivalents("SOLAR:arm=armsolar|cor=corsolar|leg=legsolar", SIDES)
        .groups,
    ).toEqual([{ Armada: "armsolar", Cortex: "corsolar", Legion: "legsolar" }]);
  });

  /** The whole point of reading it: `armanni` is Cortex's `cordoom`, and no
   *  amount of swapping `arm` for `cor` ever reaches that. */
  it("answers the pairs the naming route gets wrong", () => {
    const table = shippedEquivalents(BAR.result, SIDES);
    expect(
      table.groups.find((group) => group.Armada === "armanni")?.Cortex,
    ).toBe("cordoom");
    expect(
      table.groups.find((group) => group.Armada === "armbeamer")?.Cortex,
    ).toBe("corhllt");
  });

  it("says nothing when the sides cannot be matched to the game's own keys", () => {
    expect(
      shippedEquivalents(
        "SOLAR:arm=armsolar|cor=corsolar",
        gameSides([
          { name: "Empire", startUnit: "empire_commander" },
          { name: "Rebels", startUnit: "rebel_hq" },
        ]),
      ).groups,
    ).toEqual([]);
  });

  it("drops a side key no side of the game claims", () => {
    expect(
      shippedEquivalents("SOLAR:arm=armsolar|zzz=zzzsolar", SIDES).groups,
    ).toEqual([]);
    expect(
      shippedEquivalents("SOLAR:arm=armsolar|cor=corsolar|zzz=x", SIDES).groups,
    ).toEqual([{ Armada: "armsolar", Cortex: "corsolar" }]);
  });
});
