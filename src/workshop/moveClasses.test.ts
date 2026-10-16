import { describe, expect, it } from "vitest";
import {
  climbableDegrees,
  moveClassesOf,
  moveClassOf,
  moveClassProblem,
  moveDefKind,
  moveDefsOf,
  requiresMoveDef,
  unitSpeedOf,
} from "./moveClasses";

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

// ParseSpeedModClass in RecoilEngine's MoveDefHandler.cpp (issue #3255).
describe("moveDefKind", () => {
  it("takes the speedModClass number when the class has one", () => {
    expect(moveDefKind({ name: "TANK2", speedmodclass: 1 })).toBe("kbot");
    expect(moveDefKind({ name: "x", speedModClass: 2 })).toBe("hover");
    expect(moveDefKind({ name: "x", speedmodclass: "3" })).toBe("ship");
  });

  it("clamps a number outside the four kinds the way the engine does", () => {
    expect(moveDefKind({ name: "x", speedmodclass: 9 })).toBe("ship");
    expect(moveDefKind({ name: "x", speedmodclass: -4 })).toBe("tank");
  });

  it("falls back on the lowercased name, ship before hover before tank", () => {
    expect(moveDefKind({ name: "BOAT4" })).toBe("ship");
    expect(moveDefKind({ name: "hovership" })).toBe("ship");
    expect(moveDefKind({ name: "HOVER3" })).toBe("hover");
    expect(moveDefKind({ name: "WALKERTANK3" })).toBe("tank");
    expect(moveDefKind({ name: "KBOT2", speedmodclass: -1 })).toBe("kbot");
  });
});

describe("moveDefsOf", () => {
  it("reads name, kind and footprint, and skips a class with no name", () => {
    expect(
      moveDefsOf([
        { name: "WHEELEDTANK2", footprintx: 2 },
        { name: "KBOT1" },
        { footprintx: 3 },
        "not a table",
      ]),
    ).toEqual([
      { name: "WHEELEDTANK2", kind: "tank", footprint: 2 },
      { name: "KBOT1", kind: "kbot", footprint: 1 },
    ]);
  });
});

describe("maxSlope", () => {
  it("is carried through when the class sets one, and absent when not", () => {
    expect(
      moveDefsOf([
        { name: "HOVER2", maxslope: 15 },
        { name: "TANK2", maxSlope: "30" },
        { name: "KBOT1" },
      ]).map((entry) => entry.maxSlope),
    ).toEqual([15, 30, undefined]);
  });

  it("climbs 1.5 times the maxSlope written", () => {
    expect(climbableDegrees({ kind: "hover", maxSlope: 15 })).toBe(22.5);
    expect(climbableDegrees({ kind: "tank", maxSlope: 20 })).toBe(30);
  });

  it("clamps the maxSlope to 0 to 60 before the factor", () => {
    expect(climbableDegrees({ kind: "tank", maxSlope: 80 })).toBe(90);
    expect(climbableDegrees({ kind: "tank", maxSlope: -5 })).toBe(0);
  });

  it("falls back to the kind's default, and a ship has none", () => {
    expect(climbableDegrees({ kind: "hover" })).toBe(22.5);
    expect(climbableDegrees({ kind: "tank" })).toBe(90);
    expect(climbableDegrees({ kind: "kbot" })).toBe(90);
    expect(climbableDegrees({ kind: "ship", maxSlope: 10 })).toBeNull();
  });
});

describe("unitSpeedOf and requiresMoveDef", () => {
  it("reads speed, or maxVelocity in elmos a frame", () => {
    expect(unitSpeedOf({ speed: 60 })).toBe(60);
    expect(unitSpeedOf({ maxvelocity: 2 })).toBe(60);
    expect(unitSpeedOf({})).toBe(0);
  });

  it("is canmove and a speed and not a flier", () => {
    expect(requiresMoveDef({ canmove: true, speed: 60 })).toBe(true);
    expect(requiresMoveDef({ canmove: true, speed: 0 })).toBe(false);
    expect(requiresMoveDef({ canmove: true, speed: 60, canfly: true })).toBe(
      false,
    );
  });
});
