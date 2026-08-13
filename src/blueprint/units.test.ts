import { describe, expect, it } from "vitest";
import { knownUnits, unknownBuildings, unknownUnitsWarning } from "./units";

/** What the game being imported into has. Everything else in these tests is a
 *  name from some other game. */
const UNITS = [{ name: "armsolar" }, { name: "armmex" }, { name: "corllt" }];

const at = (def: string) => ({ def });

describe("knownUnits", () => {
  it("knows a unit the game has, in whatever case it is written", () => {
    const known = knownUnits(UNITS);
    expect(known("armsolar")).toBe(true);
    expect(known("ArmSolar")).toBe(true);
  });

  it("does not know a name the game has never heard of", () => {
    expect(knownUnits(UNITS)("factorycloak")).toBe(false);
  });
});

describe("unknownBuildings", () => {
  it("names each building the game has no unit for, by its place", () => {
    expect(
      unknownBuildings(
        [at("corllt"), at("legsolar"), at("armsolar"), at("legsolar")],
        knownUnits(UNITS),
      ),
    ).toEqual([
      { index: 1, def: "legsolar" },
      { index: 3, def: "legsolar" },
    ]);
  });

  it("says nothing about a layout the game has every unit of", () => {
    expect(
      unknownBuildings([at("armsolar"), at("armmex")], knownUnits(UNITS)),
    ).toEqual([]);
  });

  it("checks nothing when there is no dataset to check against", () => {
    expect(unknownBuildings([at("factorycloak")], undefined)).toEqual([]);
  });
});

describe("unknownUnitsWarning", () => {
  it("says nothing about a layout every unit of which the game has", () => {
    expect(unknownUnitsWarning([], 3)).toBeNull();
  });

  it("counts the buildings and names the one unit that is missing", () => {
    expect(unknownUnitsWarning([{ index: 3, def: "legsolar" }], 4)).toBe(
      "1 of its 4 buildings cannot be placed here: this game has no legsolar. The other 3 are fine.",
    );
  });

  it("reads as a whole layout lost when the game has none of its units", () => {
    expect(
      unknownUnitsWarning(
        [
          { index: 0, def: "energysolar" },
          { index: 1, def: "turretlaser" },
          { index: 2, def: "factorycloak" },
        ],
        3,
      ),
    ).toBe(
      "This game has none of its units: energysolar, turretlaser or factorycloak. Nothing in it can be placed here, so it belongs to another game or another version of this one.",
    );
  });

  it("names a unit once however many buildings use it", () => {
    expect(
      unknownUnitsWarning(
        [
          { index: 1, def: "legsolar" },
          { index: 2, def: "legsolar" },
        ],
        6,
      ),
    ).toBe(
      "2 of its 6 buildings cannot be placed here: this game has no legsolar. The other 4 are fine.",
    );
  });

  it("counts the names it does not list rather than running on", () => {
    expect(
      unknownUnitsWarning(
        ["a", "b", "c", "d", "e"].map((def, index) => ({ index, def })),
        9,
      ),
    ).toBe(
      "5 of its 9 buildings cannot be placed here: this game has no a, b, c and 2 more. The other 4 are fine.",
    );
  });

  it("keeps the one building case readable", () => {
    expect(
      unknownUnitsWarning(
        [
          { index: 0, def: "legsolar" },
          { index: 1, def: "legcom" },
        ],
        3,
      ),
    ).toBe(
      "2 of its 3 buildings cannot be placed here: this game has no legsolar or legcom. The other one is fine.",
    );
  });
});
