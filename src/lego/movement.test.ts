import { describe, expect, it } from "vitest";
import { type LegoProject, newProject, parseLegoProjectJson } from "./model";
import {
  type GameMovementData,
  movementKinds,
  movementState,
  movesInGame,
  offerMoveClasses,
  suggestMotion,
} from "./movement";

function project(roles: string[]): LegoProject {
  const base = newProject({
    id: "p",
    rootPieceId: "root",
    name: "Rover",
    packId: "lego",
    packVersion: "1",
    now: "2026-10-16T00:00:00Z",
  });
  return {
    ...base,
    pieces: [
      ...base.pieces,
      ...roles.map((role, i) => ({
        ...base.pieces[0],
        id: `p${i}`,
        name: `p${i}`,
        parentId: base.rootPieceId,
        role,
      })),
    ],
  };
}

/**
 * Splinter Faction 0.1.89's classes as the unit-defs read gives them, cut down:
 * no `speedmodclass` anywhere, so every kind comes off the name, and every
 * ground class has "tank" in it.
 */
const SPLINTER: GameMovementData = {
  moveDefs: [
    { name: "SHIP3", footprintx: 3 },
    { name: "WHEELEDTANK2", footprintx: 2 },
    { name: "WHEELEDTANK5", footprintx: 5 },
    { name: "WALKERTANK3", footprintx: 3 },
  ],
  units: {
    lozdiamondback: {
      canmove: true,
      movementclass: "WHEELEDTANK2",
      speed: 120,
      turnrate: 600,
    },
    lozengineer: {
      canmove: true,
      movementclass: "WHEELEDTANK2",
      maxvelocity: 2.5,
      turnrate: 600,
    },
    lozflashpoint: {
      canmove: true,
      movementclass: "wheeledtank2",
      speed: 157.5,
      turnrate: 600,
    },
    fedbear: {
      canmove: true,
      movementclass: "WALKERTANK3",
      speed: 72.000003,
      turnrate: 500,
    },
    lozmex: { canmove: false, movementclass: "WHEELEDTANK5", speed: 0 },
    fedpiranha: { canmove: true, movementclass: "SHIP3", speed: 126 },
  },
};

describe("movementKinds", () => {
  it("reads wheels as a vehicle and legs as a walker", () => {
    expect(movementKinds(project(["wheel"]))).toEqual(["tank"]);
    expect(movementKinds(project(["leg.l1.thigh"]))).toEqual(["kbot"]);
    expect(movementKinds(project(["wheel", "leg.r1.foot"]))).toEqual([
      "kbot",
      "tank",
    ]);
  });

  it("is nothing for a unit with neither", () => {
    expect(movementKinds(project(["turret"]))).toEqual([]);
  });
});

describe("offerMoveClasses", () => {
  it("offers a wheeled build the game's vehicle classes, nearest footprint first", () => {
    const offer = offerMoveClasses(SPLINTER, ["tank"], 4);
    expect(offer.source).toBe("movedefs");
    // Three and five steps are both one from four, so the name breaks the tie.
    expect(offer.classes.map((c) => c.name)).toEqual([
      "WALKERTANK3",
      "WHEELEDTANK5",
      "WHEELEDTANK2",
    ]);
    // Counted case blind, the way the engine matches a class.
    expect(offer.classes.find((c) => c.name === "WHEELEDTANK2")?.units).toBe(3);
  });

  it("offers a build of no kind every class the game declares", () => {
    expect(offerMoveClasses(SPLINTER, [], 1).classes).toHaveLength(4);
  });

  it("falls back on the classes the game's units use when movedefs.lua gave nothing", () => {
    const offer = offerMoveClasses({ ...SPLINTER, moveDefs: [] }, ["kbot"], 2);
    expect(offer.source).toBe("units");
    expect(offer.classes.map((c) => c.name)).toContain("WHEELEDTANK2");
    expect(offer.classes[0].kind).toBeUndefined();
  });
});

describe("movementState", () => {
  const ready = {
    gameName: "Splinter Faction",
    noGame: "",
    status: "ready" as const,
    error: null,
    game: SPLINTER,
    footprint: 2,
  };

  it("says when the game is not known yet", () => {
    expect(
      movementState({
        ...ready,
        gameName: null,
        noGame: "No game is installed.",
        kinds: ["tank"],
      }),
    ).toEqual({ state: "no-game", reason: "No game is installed." });
  });

  // Splinter Faction names its walkers WALKERTANK, so the engine reads every
  // one of them as a tank and the game has no walker class at all.
  it("says when none of the game's classes fit the build", () => {
    expect(movementState({ ...ready, kinds: ["kbot"] })).toEqual({
      state: "none-fit",
      gameName: "Splinter Faction",
      kinds: ["kbot"],
    });
  });

  it("waits while the game is read and says when the read failed", () => {
    expect(
      movementState({ ...ready, status: "loading", kinds: ["tank"] }).state,
    ).toBe("loading");
    expect(
      movementState({
        ...ready,
        status: "error",
        error: "no unitsync",
        kinds: ["tank"],
      }),
    ).toEqual({
      state: "error",
      gameName: "Splinter Faction",
      message: "no unitsync",
    });
  });

  it("offers the classes once the game is read", () => {
    const state = movementState({ ...ready, kinds: ["tank"] });
    expect(state.state).toBe("offer");
  });
});

describe("suggestMotion", () => {
  it("takes the median of the game's moving units on the class", () => {
    expect(suggestMotion(SPLINTER, "Splinter Faction", "WHEELEDTANK2")).toEqual(
      {
        moveClass: "WHEELEDTANK2",
        speed: 120,
        turnRate: 600,
        speedFrom: "Median of 3 Splinter Faction units on WHEELEDTANK2",
        turnRateFrom: "Median of 3 Splinter Faction units on WHEELEDTANK2",
      },
    );
  });

  it("falls back on the units of the same kind when none uses the class", () => {
    const movement = suggestMotion(SPLINTER, "SF", "WHEELEDTANK5");
    // 72, 75, 120 and 157.5 elmos a second: the median is 97.5.
    expect(movement.speed).toBe(97.5);
    expect(movement.speedFrom).toBe("Median of 4 SF units on vehicle classes");
  });

  it("suggests nothing when no unit in the game moves that way", () => {
    const movement = suggestMotion(
      { moveDefs: [{ name: "HOVER2" }], units: {} },
      "SF",
      "HOVER2",
    );
    expect(movement).toEqual({ moveClass: "HOVER2" });
    expect(movesInGame(movement)).toBe(false);
  });
});

describe("a project's movement", () => {
  it("survives a save and a load", () => {
    const saved = {
      ...project(["wheel"]),
      movement: {
        moveClass: "WHEELEDTANK2",
        speed: 120,
        turnRate: 600,
        speedFrom: "Median of 3 Splinter Faction units on WHEELEDTANK2",
      },
    };
    expect(parseLegoProjectJson(JSON.stringify(saved))?.movement).toEqual(
      saved.movement,
    );
  });
});
