import { describe, expect, it } from "vitest";
import { arrivingGame, blueprintArrival, gameToCheckAgainst } from "./arrival";
import type { BlueprintPayload } from "./payload";
import { knownUnits } from "./units";

const INSTALLED = [
  { name: "Balanced Antihilation 12.34", info: { shortname: "BA" } },
  { name: "Beyond All Reason test-1", info: { shortname: "BAR" } },
];

const UNITS = [{ name: "armsolar" }, { name: "armmex" }];

function payload(over: Partial<BlueprintPayload> = {}): BlueprintPayload {
  return {
    name: "Opening solars",
    buildings: [
      { def: "armsolar", offset: { x: 0, z: 0 }, facing: 0 },
      { def: "armmex", offset: { x: 32, z: 0 }, facing: 0 },
    ],
    footprints: {},
    ...over,
  };
}

describe("arrivingGame", () => {
  it("has nothing to say when the layout names a game that is installed", () => {
    expect(
      arrivingGame({ name: "Balanced Antihilation 12.34" }, INSTALLED),
    ).toEqual({ state: "installed", here: "Balanced Antihilation 12.34" });
  });

  it("names the game when this machine has not got it", () => {
    expect(arrivingGame({ name: "Zero-K 1.2.3" }, INSTALLED)).toEqual({
      state: "missing",
      wanted: "Zero-K 1.2.3",
    });
  });

  it("finds another build of the same game by its shortname", () => {
    expect(
      arrivingGame(
        { name: "Balanced Antihilation 12.00", shortname: "BA" },
        INSTALLED,
      ),
    ).toEqual({
      state: "other-version",
      wanted: "Balanced Antihilation 12.00",
      here: "Balanced Antihilation 12.34",
    });
  });

  it("falls back to the shortname when the layout pins no build", () => {
    expect(arrivingGame({ shortname: "ZK" }, INSTALLED)).toEqual({
      state: "missing",
      wanted: "ZK",
    });
  });

  it("says a layout naming no game names none", () => {
    expect(arrivingGame(undefined, INSTALLED)).toEqual({ state: "unnamed" });
  });

  it("waits rather than guessing while the games are still being read", () => {
    expect(arrivingGame({ name: "Zero-K 1.2.3" }, null)).toEqual({
      state: "unread",
      wanted: "Zero-K 1.2.3",
    });
  });
});

describe("gameToCheckAgainst", () => {
  it("is the installed build for a layout that names one", () => {
    expect(
      gameToCheckAgainst({ state: "installed", here: "Balanced Antihilation" }),
    ).toBe("Balanced Antihilation");
  });

  it("is the build that is here for a layout from another version", () => {
    expect(
      gameToCheckAgainst({
        state: "other-version",
        wanted: "BA 12.00",
        here: "BA 12.34",
      }),
    ).toBe("BA 12.34");
  });

  it("is nothing at all when there is no game here to check against", () => {
    expect(gameToCheckAgainst({ state: "missing", wanted: "Zero-K" })).toBe("");
    expect(gameToCheckAgainst({ state: "unnamed" })).toBe("");
  });
});

describe("blueprintArrival", () => {
  it("keeps the name it came with when nothing else has it", () => {
    const arrival = blueprintArrival({
      payload: payload({ game: { name: "Balanced Antihilation 12.34" } }),
      taken: ["Something else"],
      installed: INSTALLED,
      known: knownUnits(UNITS),
    });
    expect(arrival.name).toBe("Opening solars");
    expect(arrival.wasCalled).toBeUndefined();
    expect(arrival.notes).toEqual([]);
  });

  it("counts the name up when the library already has one, and says so", () => {
    const arrival = blueprintArrival({
      payload: payload({ game: { name: "Balanced Antihilation 12.34" } }),
      taken: ["Opening solars"],
      installed: INSTALLED,
      known: knownUnits(UNITS),
    });
    expect(arrival.name).toBe("Opening solars 2");
    expect(arrival.wasCalled).toBe("Opening solars");
    expect(arrival.notes.map((note) => note.text).join(" ")).toContain(
      "Opening solars 2",
    );
  });

  it("names the game a layout is for when it is not installed here", () => {
    const arrival = blueprintArrival({
      payload: payload({ game: { name: "Zero-K 1.2.3" } }),
      taken: [],
      installed: INSTALLED,
    });
    expect(arrival.notes[0].text).toContain("Zero-K 1.2.3");
    expect(arrival.notes[0].tone).toBe("warn");
    // Nothing to check the units against, so nothing pretends to have checked.
    expect(arrival.notes).toHaveLength(1);
  });

  it("says which units this game has not got", () => {
    const arrival = blueprintArrival({
      payload: payload({
        game: { name: "Balanced Antihilation 12.34" },
        buildings: [
          { def: "armsolar", offset: { x: 0, z: 0 }, facing: 0 },
          { def: "legsolar", offset: { x: 32, z: 0 }, facing: 0 },
        ],
      }),
      taken: [],
      installed: INSTALLED,
      known: knownUnits(UNITS),
    });
    expect(arrival.notes[0].text).toContain("legsolar");
    expect(arrival.notes[0].tone).toBe("warn");
    expect(arrival.foreign).toBe(false);
  });

  it("marks a layout whose every unit is somebody else's as foreign", () => {
    const arrival = blueprintArrival({
      payload: payload({
        game: { name: "Balanced Antihilation 12.34" },
        buildings: [
          { def: "legsolar", offset: { x: 0, z: 0 }, facing: 0 },
          { def: "legmex", offset: { x: 32, z: 0 }, facing: 0 },
        ],
      }),
      taken: [],
      installed: INSTALLED,
      known: knownUnits(UNITS),
    });
    expect(arrival.foreign).toBe(true);
    expect(arrival.notes[0].text).toContain("none of its units");
  });

  it("says the units were not checked rather than that they are fine", () => {
    const arrival = blueprintArrival({
      payload: payload({ game: { name: "Balanced Antihilation 12.34" } }),
      taken: [],
      installed: INSTALLED,
    });
    expect(arrival.notes).toHaveLength(1);
    expect(arrival.notes[0].text).toContain("not read");
  });

  it("says a layout naming no game cannot be checked at all", () => {
    const arrival = blueprintArrival({
      payload: payload(),
      taken: [],
      installed: INSTALLED,
      known: knownUnits(UNITS),
    });
    expect(arrival.notes).toHaveLength(1);
    expect(arrival.notes[0].text).toContain("does not say which game");
  });

  it("warns that another version's units may have moved, and still checks them", () => {
    const arrival = blueprintArrival({
      payload: payload({
        game: { name: "Balanced Antihilation 12.00", shortname: "BA" },
        buildings: [{ def: "legsolar", offset: { x: 0, z: 0 }, facing: 0 }],
      }),
      taken: [],
      installed: INSTALLED,
      known: knownUnits(UNITS),
    });
    const text = arrival.notes.map((note) => note.text).join(" ");
    expect(text).toContain("Balanced Antihilation 12.00");
    expect(text).toContain("Balanced Antihilation 12.34");
    expect(text).toContain("legsolar");
  });
});

/**
 * A layout going into a mission rather than into the library (issue #1327).
 *
 * The library holds every game's layouts at once, so what matters there is
 * whether this machine has the game. A mission is for one game, so a layout for
 * a different one is wrong for it even when the machine has both, and saying
 * "not installed here" about it would be false.
 */
describe("a layout going into a mission", () => {
  it("has nothing to say when the layout is for the mission's game", () => {
    const arrival = blueprintArrival({
      payload: payload({ game: { name: "Balanced Antihilation 12.34" } }),
      taken: [],
      installed: INSTALLED,
      known: knownUnits(UNITS),
      into: "Balanced Antihilation 12.34",
    });
    expect(arrival.notes).toEqual([]);
  });

  it("names both games when the layout is for another one this machine has", () => {
    const arrival = blueprintArrival({
      payload: payload({ game: { name: "Beyond All Reason test-1" } }),
      taken: [],
      installed: INSTALLED,
      into: "Balanced Antihilation 12.34",
    });
    expect(arrival.notes[0].tone).toBe("warn");
    expect(arrival.notes[0].text).toContain("Beyond All Reason test-1");
    expect(arrival.notes[0].text).toContain("Balanced Antihilation 12.34");
    expect(arrival.notes[0].text).not.toContain("not installed");
  });

  it("still spots another build of the mission's own game", () => {
    const arrival = blueprintArrival({
      payload: payload({
        game: { name: "Balanced Antihilation 12.00", shortname: "BA" },
      }),
      taken: [],
      installed: INSTALLED,
      into: "Balanced Antihilation 12.34",
    });
    expect(arrival.notes[0].text).toContain("another version");
    expect(arrival.notes[0].tone).toBe("note");
  });

  it("checks the units against the mission's game", () => {
    const arrival = blueprintArrival({
      payload: payload({
        game: { name: "Balanced Antihilation 12.34" },
        buildings: [{ def: "legsolar", offset: { x: 0, z: 0 }, facing: 0 }],
      }),
      taken: [],
      installed: INSTALLED,
      known: knownUnits(UNITS),
      into: "Balanced Antihilation 12.34",
    });
    expect(arrival.foreign).toBe(true);
    expect(arrival.notes[0].text).toContain("none of its units");
  });

  /** The mission's game is the yardstick, so it is always the thing to check
   *  against, whatever game the layout claims. */
  it("checks the units even when the layout claims another game", () => {
    const arrival = blueprintArrival({
      payload: payload({
        game: { name: "Zero-K 1.2.3" },
        buildings: [{ def: "zkfusion", offset: { x: 0, z: 0 }, facing: 0 }],
      }),
      taken: [],
      installed: INSTALLED,
      known: knownUnits(UNITS),
      into: "Balanced Antihilation 12.34",
    });
    expect(arrival.foreign).toBe(true);
    expect(arrival.notes[0].text).toContain("none of its units");
    expect(arrival.notes[1].text).toContain("Zero-K 1.2.3");
  });

  it("says nothing about units when the mission has not picked a game", () => {
    const arrival = blueprintArrival({
      payload: payload({ game: { name: "Zero-K 1.2.3" } }),
      taken: [],
      installed: INSTALLED,
      into: "",
    });
    expect(arrival.notes.map((note) => note.text).join(" ")).not.toContain(
      "not read",
    );
  });

  it("works for a mission whose game is not installed here", () => {
    const arrival = blueprintArrival({
      payload: payload({ game: { name: "Zero-K 1.2.3" } }),
      taken: [],
      installed: INSTALLED,
      into: "Zero-K 1.2.3",
    });
    expect(arrival.notes.map((note) => note.text).join(" ")).not.toContain(
      "not installed",
    );
  });

  it("counts a second copy up against the scenario, not the library", () => {
    const arrival = blueprintArrival({
      payload: payload({ game: { name: "Balanced Antihilation 12.34" } }),
      taken: ["Opening solars"],
      installed: INSTALLED,
      known: knownUnits(UNITS),
      into: "Balanced Antihilation 12.34",
    });
    expect(arrival.name).toBe("Opening solars 2");
    expect(arrival.notes[0].text).toContain("in this scenario");
  });
});
