import { describe, expect, it } from "vitest";
import { moveClassesOf, moveClassOf, moveClassProblem } from "./moveClasses";

/** A game's table as the worker hands it over: every key lowercased. */
const GAME: Record<string, Record<string, unknown>> = {
  armpw: { canmove: true, movementclass: "ARMCOMKBOT" },
  armrock: { canmove: true, movementclass: "ARMCOMKBOT" },
  armham: { canmove: true, movementclass: "ARMCOMKBOT" },
  armstump: { canmove: true, movementclass: "ARMSTUMPTANK" },
  armcv: { canmove: true, movementclass: "ARMCVVEHICLE" },
  armsolar: { maxdamage: 400 },
  armfig: { canmove: true, canfly: true },
};

describe("moveClassOf", () => {
  it("reads the class whatever case the game wrote the key in", () => {
    expect(moveClassOf({ movementClass: "TANK3" })).toBe("TANK3");
    expect(moveClassOf({ MOVEMENTCLASS: "TANK3" })).toBe("TANK3");
  });

  it("treats a blank or missing class as no class", () => {
    expect(moveClassOf({ movementclass: "  " })).toBe("");
    expect(moveClassOf({})).toBe("");
    expect(moveClassOf(undefined)).toBe("");
  });
});

describe("moveClassesOf", () => {
  it("offers every class the game's units name, commonest first", () => {
    expect(moveClassesOf(GAME)).toEqual([
      { name: "ARMCOMKBOT", units: 3 },
      { name: "ARMCVVEHICLE", units: 1 },
      { name: "ARMSTUMPTANK", units: 1 },
    ]);
  });

  /**
   * The name goes through untouched. It is matched against the game's move
   * definitions by whatever the game wrote, so a folded case would offer a
   * spelling the engine may not accept.
   */
  it("keeps the game's own spelling", () => {
    expect(moveClassesOf({ a: { movementclass: "HoverBig" } })).toEqual([
      { name: "HoverBig", units: 1 },
    ]);
  });

  it("has nothing to offer for a game whose units all stand still", () => {
    expect(moveClassesOf({ armsolar: { maxdamage: 400 } })).toEqual([]);
  });
});

describe("moveClassProblem", () => {
  /** The failure issue #663 recorded: the engine drops the unit at load. */
  it("says a moving unit with no class will be dropped", () => {
    expect(moveClassProblem({ canmove: true })).toMatch(/drops it at load/);
  });

  it("says a class on a unit that does not move has no effect", () => {
    expect(moveClassProblem({ movementclass: "TANK3" })).toMatch(
      /no effect until Can move is on/,
    );
  });

  it("is quiet when both agree", () => {
    expect(
      moveClassProblem({ canmove: true, movementclass: "TANK3" }),
    ).toBeUndefined();
    expect(moveClassProblem({ maxdamage: 400 })).toBeUndefined();
  });

  /** A flier resolves nothing against the move definitions. */
  it("asks a flier for neither", () => {
    expect(moveClassProblem({ canmove: true, canfly: true })).toBeUndefined();
  });

  /** A game that inherited its numbers from a `.fbi` writes 1 rather than true. */
  it("reads a flag written as a number", () => {
    expect(moveClassProblem({ canmove: 1 })).toMatch(/drops it at load/);
    expect(moveClassProblem({ canmove: 0 })).toBeUndefined();
  });

  it("is quiet about a unit that is not there", () => {
    expect(moveClassProblem(undefined)).toBeUndefined();
  });
});
