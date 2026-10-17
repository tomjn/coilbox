import { describe, expect, it } from "vitest";
import { type LegoProject, newProject, parseLegoProjectJson } from "./model";
import {
  type GameMovementData,
  movementKinds,
  movementState,
  movesInGame,
  offerMoveClasses,
  slopeVerdict,
  suggestMotion,
  unitGame,
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

describe("suggestMotion reverse speed", () => {
  const game: GameMovementData = {
    moveDefs: [{ name: "TANK2" }],
    units: {
      a: { canmove: true, movementclass: "TANK2", speed: 60, rspeed: 30 },
      b: {
        canmove: true,
        movementclass: "TANK2",
        speed: 60,
        maxreversevelocity: -1,
      },
      c: { canmove: true, movementclass: "TANK2", speed: 60 },
    },
  };

  it("takes the median of the units that can reverse", () => {
    const movement = suggestMotion(game, "BA", "TANK2");
    expect(movement.reverseSpeed).toBe(30);
    expect(movement.reverseSpeedFrom).toBe("Median of 2 BA units on TANK2");
  });

  it("leaves it out when no unit reverses", () => {
    const movement = suggestMotion(
      {
        moveDefs: [{ name: "TANK2" }],
        units: { a: { canmove: true, movementclass: "TANK2", speed: 60 } },
      },
      "BA",
      "TANK2",
    );
    expect(movement).not.toHaveProperty("reverseSpeed");
  });
});

describe("suggestMotion acceleration and brake rate", () => {
  // BA writes `acceleration` and `brakerate` in elmos a frame squared, and the
  // values are small: 0.026 would be 0 if rounded to a tenth. Splinter Faction
  // writes `acceleration` and `brakeRate`, and a few older units `maxAcc`.
  const game: GameMovementData = {
    moveDefs: [{ name: "TANK2" }, { name: "TANK3" }],
    units: {
      a: {
        canmove: true,
        movementclass: "TANK2",
        speed: 60,
        acceleration: 0.026,
        brakerate: 0.057,
      },
      b: {
        canmove: true,
        movementclass: "TANK2",
        speed: 60,
        maxacc: 0.096,
        maxdec: 0.075,
      },
      c: {
        canmove: true,
        movementclass: "TANK2",
        speed: 60,
        acceleration: 0.5,
      },
    },
  };

  it("takes the median of the class's units and says where it came from", () => {
    const movement = suggestMotion(game, "BA", "TANK2");
    expect(movement.acceleration).toBe(0.096);
    expect(movement.accelerationFrom).toBe("Median of 3 BA units on TANK2");
    // Only two units state a brake rate. The third would brake at its acceleration.
    expect(movement.brakeRate).toBe(0.066);
    expect(movement.brakeRateFrom).toBe("Median of 2 BA units on TANK2");
  });

  it("falls back on the same kind of class", () => {
    const movement = suggestMotion(game, "BA", "TANK3");
    expect(movement.acceleration).toBe(0.096);
    expect(movement.accelerationFrom).toBe(
      "Median of 3 BA units on vehicle classes",
    );
  });

  it("leaves both out when no unit states them", () => {
    const movement = suggestMotion(
      {
        moveDefs: [{ name: "TANK2" }],
        units: { a: { canmove: true, movementclass: "TANK2", speed: 60 } },
      },
      "BA",
      "TANK2",
    );
    expect(movement).not.toHaveProperty("acceleration");
    expect(movement).not.toHaveProperty("brakeRate");
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
        reverseSpeed: 45,
        reverseSpeedFrom: "Median of 2 Splinter Faction units on WHEELEDTANK2",
        acceleration: 0.5,
        brakeRate: 1,
        speedFrom: "Median of 3 Splinter Faction units on WHEELEDTANK2",
        accelerationFrom: "Median of 2 Splinter Faction units on WHEELEDTANK2",
        brakeRateFrom: "Median of 2 Splinter Faction units on WHEELEDTANK2",
      },
    };
    expect(parseLegoProjectJson(JSON.stringify(saved))?.movement).toEqual(
      saved.movement,
    );
  });
});

describe("slopeVerdict", () => {
  const moveDefs = [
    { name: "HOVER2", maxslope: 15 },
    { name: "TANK2" },
    { name: "TANK3", maxslope: 20 },
    { name: "BOAT2" },
  ];

  it("compares the angle with 1.5 times maxSlope", () => {
    const movement = { moveClass: "HOVER2" };
    expect(slopeVerdict(movement, { moveDefs }, 22.5)).toBe(
      "HOVER2 can climb this: it climbs up to 22.5\u00b0 (maxSlope 15).",
    );
    expect(slopeVerdict(movement, { moveDefs }, 22.6)).toBe(
      "HOVER2 cannot climb this: it climbs up to 22.5\u00b0 (maxSlope 15).",
    );
    expect(slopeVerdict(movement, { moveDefs }, 15)).toContain("can climb");
  });

  it("clamps maxSlope at 60, so the most a class climbs is 90", () => {
    const hill = [{ name: "TANK9", maxslope: 200 }];
    expect(
      slopeVerdict({ moveClass: "TANK9" }, { moveDefs: hill }, 89),
    ).toContain("can climb this: it climbs up to 90\u00b0");
  });

  it("says when the maxSlope is the kind's default", () => {
    expect(slopeVerdict({ moveClass: "tank2" }, { moveDefs }, 45)).toBe(
      "tank2 can climb this: it climbs up to 90\u00b0 (default maxSlope 60).",
    );
  });

  it("does not assume the default when the class cannot be read", () => {
    const unknown = "Climbing limit unknown";
    expect(
      slopeVerdict({ moveClass: "TANK2" }, { moveDefs: [] }, 30),
    ).toContain(unknown);
    expect(slopeVerdict({ moveClass: "NOPE" }, { moveDefs }, 30)).toContain(
      unknown,
    );
    expect(slopeVerdict({ moveClass: "TANK2" }, null, 30)).toContain(unknown);
  });

  it("says nothing about climbing for a static unit", () => {
    expect(slopeVerdict(undefined, { moveDefs }, 30)).toBeNull();
    expect(slopeVerdict({ moveClass: " " }, { moveDefs }, 30)).toBeNull();
  });

  it("says a ship has no maxSlope", () => {
    expect(slopeVerdict({ moveClass: "BOAT2" }, { moveDefs }, 10)).toBe(
      "BOAT2 is a ship class, which has no maxSlope.",
    );
  });
});

describe("unitGame", () => {
  const exported = {
    dir: "/games/SplinterFaction.sdd",
    at: "2026-10-16T00:00:00Z",
    unitName: "rover",
    def: {},
    files: [],
  };

  it("is null for a unit that belongs to no game", () => {
    expect(unitGame(project(["wheel"]))).toBeNull();
  });

  it("is the game a unit was imported from", () => {
    const imported = {
      source: "x.s3o",
      game: {
        name: "Splinter Faction 0.1.89",
        archive: "SplinterFaction_0.1.89.sdz",
        member: "objects3d/a.s3o",
      },
    } as LegoProject["imported"];
    expect(unitGame({ ...project(["wheel"]), imported })).toEqual({
      name: "Splinter Faction 0.1.89",
      archive: "SplinterFaction_0.1.89.sdz",
    });
  });

  it("does not count the folder a unit was exported into", () => {
    expect(unitGame({ ...project(["wheel"]), exported })).toBeNull();
  });
});
