import { describe, expect, it } from "vitest";
import { hubFaction, hubPickUnitIds } from "./hubPlayedFactions";

const SIDES = [
  { name: "Armada", startUnit: "armcom" },
  { name: "Legion", startUnit: "LegCom" },
];
// In id order: id 1 is the first.
const UNITS = [{ name: "armcom" }, { name: "armpw" }, { name: "legcom" }];

describe("hubFaction, by the rows of the hub's table", () => {
  it("sends the start script's side when there is no counted pick", () => {
    expect(hubFaction({ side: "Armada" }, UNITS, SIDES)).toBe("Armada");
  });

  it("sends null with no pick and no side", () => {
    expect(hubFaction({}, UNITS, SIDES)).toBeNull();
  });

  it("sends a picked faction name exactly as sent", () => {
    const sides = [{ name: "Aven" }, { name: "Random" }];
    for (const name of ["aven", "random", "zaal"]) {
      const player = { side: "gear", pick: { frame: -1, name } };
      expect(hubFaction(player, null, sides)).toBe(name);
    }
  });

  it("says Legion for an Armada player who picked the Legion commander", () => {
    const player = {
      side: "Armada",
      pick: { frame: -1, unitDefId: 3, unit: "legcom" },
    };
    expect(hubFaction(player, null, SIDES)).toBe("Legion");
  });

  it("names a pick from the unit list when the replay carries none", () => {
    const player = { side: "Armada", pick: { frame: 41, unitDefId: 3 } };
    expect(hubFaction(player, UNITS, SIDES)).toBe("Legion");
  });

  it("sends null, not the script's side, for a start unit with no side", () => {
    const player = { side: "Armada", pick: { frame: 41, unitDefId: 2 } };
    expect(hubFaction(player, UNITS, SIDES)).toBeNull();
  });

  it("sends null for a start unit nothing names", () => {
    const player = { side: "Armada", pick: { frame: 41, unitDefId: 9 } };
    expect(hubFaction(player, UNITS, SIDES)).toBeNull();
    expect(hubFaction(player, null, SIDES)).toBeNull();
  });
});

describe("hubPickUnitIds", () => {
  it("lists the unit of each player's pick by id", () => {
    expect(
      hubPickUnitIds([
        { pick: { frame: 41, unitDefId: 19 } },
        { pick: { frame: -1, unitDefId: 3, unit: "legcom" } },
        { pick: { frame: -1, name: "aven" } },
        {},
        { spectator: true, pick: { frame: -1, unitDefId: 7 } },
      ]),
    ).toEqual([19, 3]);
  });
});
