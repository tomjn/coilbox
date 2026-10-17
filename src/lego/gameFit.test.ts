import { describe, expect, it } from "vitest";
import { type GameFitData, gameFit } from "./gameFit";

const GAME: GameFitData = {
  armorDefs: { tanks: ["tankone", "tanktwo"], buildings: ["wall"] },
  moveDefs: [{ name: "TANK2", speedmodclass: 0, footprintx: 2 }],
  units: {
    tankone: {
      category: "TANK MOBILE NOTAIR",
      movementclass: "TANK2",
      canmove: true,
      speed: 80,
    },
    tanktwo: {
      category: "TANK MOBILE",
      movementclass: "TANK2",
      canmove: true,
      speed: 90,
    },
    wall: { category: "BUILDING NOTAIR", canmove: false },
  },
};

const MOVER = {
  canmove: true,
  movementclass: "TANK2",
  speed: 80,
  category: "TANK MOBILE",
};

const row = (rows: ReturnType<typeof gameFit>, id: string) =>
  rows.find((r) => r.id === id);

describe("gameFit armour class", () => {
  it("warns that an unlisted unit takes default when the game has classes", () => {
    const r = row(gameFit(MOVER, "mine", GAME), "armour");
    expect(r?.status).toBe("warn");
    expect(r?.text).toContain("default");
  });

  it("reports the class a unit is listed in", () => {
    const r = row(gameFit(MOVER, "tankone", GAME), "armour");
    expect(r?.status).toBe("ok");
    expect(r?.text).toContain("tanks");
  });

  it("matches the unit key case blind", () => {
    const r = row(gameFit(MOVER, "TankOne", GAME), "armour");
    expect(r?.text).toContain("tanks");
  });

  it("is fine in default when the game declares no classes", () => {
    const r = row(gameFit(MOVER, "mine", { ...GAME, armorDefs: {} }), "armour");
    expect(r?.status).toBe("ok");
  });
});

describe("gameFit categories", () => {
  it("flags a unit with no category as one no weapon can target", () => {
    const r = row(
      gameFit({ ...MOVER, category: undefined }, "mine", GAME),
      "category",
    );
    expect(r?.status).toBe("warn");
    expect(r?.text).toContain("No category");
  });

  it("treats a blank category as none", () => {
    const r = row(
      gameFit({ ...MOVER, category: "  " }, "mine", GAME),
      "category",
    );
    expect(r?.status).toBe("warn");
  });

  it("offers the categories of units on the same movement class", () => {
    const r = row(
      gameFit({ ...MOVER, category: undefined }, "mine", GAME),
      "category",
    );
    expect(r?.suggested).toEqual(["mobile", "tank", "notair"]);
  });

  it("offers the categories of static units to a static unit", () => {
    const r = row(
      gameFit({ canmove: false, category: undefined }, "mine", GAME),
      "category",
    );
    expect(r?.suggested).toEqual(["building", "notair"]);
  });

  it("passes categories the game's units use", () => {
    const r = row(gameFit(MOVER, "mine", GAME), "category");
    expect(r?.status).toBe("ok");
    expect(r?.text).toContain("tank mobile");
  });

  it("warns about a category no unit in the game uses", () => {
    const r = row(
      gameFit({ ...MOVER, category: "TANK HOVERCRAFT" }, "mine", GAME),
      "category",
    );
    expect(r?.status).toBe("warn");
    expect(r?.text).toContain("hovercraft");
  });
});

describe("gameFit movement", () => {
  it("passes a class the game declares, case blind", () => {
    const r = row(
      gameFit({ ...MOVER, movementclass: "tank2" }, "mine", GAME),
      "movement",
    );
    expect(r?.status).toBe("ok");
  });

  it("warns when the game does not declare the class", () => {
    const r = row(
      gameFit({ ...MOVER, movementclass: "BOAT3" }, "mine", GAME),
      "movement",
    );
    expect(r?.status).toBe("warn");
    expect(r?.text).toContain("BOAT3");
  });

  it("warns when a unit moves and names no class", () => {
    const r = row(
      gameFit({ ...MOVER, movementclass: undefined }, "mine", GAME),
      "movement",
    );
    expect(r?.status).toBe("warn");
  });

  it("says a static unit does not move", () => {
    const r = row(
      gameFit({ canmove: false, category: "BUILDING" }, "mine", GAME),
      "movement",
    );
    expect(r?.status).toBe("ok");
    expect(r?.text).toContain("does not move");
  });

  it("checks against the units when the move definitions could not be read", () => {
    const r = row(
      gameFit(MOVER, "mine", { ...GAME, moveDefs: [] }),
      "movement",
    );
    expect(r?.status).toBe("ok");
  });

  it("leaves a flier out", () => {
    const rows = gameFit({ ...MOVER, canfly: true }, "mine", GAME);
    expect(row(rows, "movement")).toBeUndefined();
  });
});

describe("gameFit fliers", () => {
  const WITH_FLIERS: GameFitData = {
    ...GAME,
    armorDefs: { ...GAME.armorDefs, air: ["swift"] },
    units: {
      ...GAME.units,
      swift: {
        category: "AIR MOBILE",
        canfly: true,
        canmove: true,
        speed: 300,
      },
    },
  };
  const FLIER = { canfly: true, canmove: true, speed: 200 };

  it("checks a flier's armour class like any other unit", () => {
    const r = row(gameFit(FLIER, "swift", WITH_FLIERS), "armour");
    expect(r?.status).toBe("ok");
    expect(r?.text).toContain("air");
    expect(row(gameFit(FLIER, "mine", WITH_FLIERS), "armour")?.status).toBe(
      "warn",
    );
  });

  it("flags a flier with no category and offers the other fliers'", () => {
    const r = row(gameFit(FLIER, "mine", WITH_FLIERS), "category");
    expect(r?.status).toBe("warn");
    expect(r?.suggested).toEqual(["air", "mobile"]);
  });

  it("does not offer a static unit the categories of fliers", () => {
    const r = row(gameFit({ canmove: false }, "mine", WITH_FLIERS), "category");
    expect(r?.suggested).toEqual(["building", "notair"]);
  });
});
