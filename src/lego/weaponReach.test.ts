import { describe, expect, it } from "vitest";
import { type LegoPiece, type LegoProject, newProject } from "./model";
import type { Vec3 } from "./snapping";
import {
  aimFromPosition,
  levelArc,
  outOfReach,
  rangeAt,
  type UnitAxes,
  unitReaches,
  type WeaponReach,
  weaponArc,
  weaponReach,
} from "./weaponReach";

const TURRET = { weaponType: "LaserCannon", turret: true, range: 400 };

function reach(
  def: Record<string, unknown>,
  slot?: Record<string, unknown>,
): WeaponReach {
  return weaponReach({ number: 1, name: "gun", def, slot, aimFrom: "turret" });
}

function unit(pieces: Partial<LegoPiece>[]): LegoProject {
  const base = newProject({
    id: "p",
    rootPieceId: "root",
    name: "Rover",
    packId: "lego",
    packVersion: "1",
    now: "2026-10-17T00:00:00Z",
  });
  return {
    ...base,
    unitName: "rover",
    pieces: [
      base.pieces[0],
      ...pieces.map((over, i) => ({
        ...base.pieces[0],
        id: `p${i}`,
        name: `piece${i}`,
        parentId: "root",
        ...over,
      })),
    ],
  };
}

describe("weaponArc", () => {
  it("is a full circle by default, maxAngleDif being 360", () => {
    expect(weaponArc(TURRET, undefined)).toEqual({ kind: "full" });
    expect(weaponArc(TURRET, { maxangledif: 360 })).toEqual({ kind: "full" });
  });

  it("holds the target to the cosine of half maxAngleDif about mainDir", () => {
    const arc = weaponArc(TURRET, { maxAngleDif: 90, mainDir: "2 0 0" });
    expect(arc.kind).toBe("mainDir");
    if (arc.kind !== "mainDir") return;
    expect(arc.minDot).toBeCloseTo(Math.cos(Math.PI / 4), 12);
    // Normalised, as `SafeNormalize` does.
    expect(arc.dir).toEqual([1, 0, 0]);
  });

  it("reads mainDir as a table of three numbers too", () => {
    const arc = weaponArc(TURRET, { maxangledif: 180, maindir: [0, 0, -1] });
    expect(arc).toMatchObject({ kind: "mainDir", dir: [0, 0, -1] });
  });

  it("keeps the rear gap a width past 360 leaves, as the engine does", () => {
    const arc = weaponArc(TURRET, { maxangledif: 400 });
    expect(arc.kind).toBe("mainDir");
    if (arc.kind === "mainDir")
      expect(arc.minDot).toBeCloseTo(Math.cos((200 * Math.PI) / 180), 12);
  });

  it("uses the unit's front and tolerance for a weapon that is no turret", () => {
    const arc = weaponArc({ weaponType: "LaserCannon" }, { maxangledif: 90 });
    expect(arc.kind).toBe("forward");
    if (arc.kind === "forward")
      expect(arc.minDot).toBeCloseTo(Math.cos((3000 * Math.PI) / 32768), 12);
    const wide = weaponArc(
      { weaponType: "LaserCannon", tolerance: 8192 },
      undefined,
    );
    if (wide.kind === "forward")
      expect(wide.minDot).toBeCloseTo(Math.cos(Math.PI / 4), 12);
  });

  it("treats a starburst launcher as a turret whatever turret says", () => {
    expect(weaponArc({ weaponType: "StarburstLauncher" }, undefined)).toEqual({
      kind: "full",
    });
  });
});

describe("rangeAt", () => {
  it("is the stated range for a target level with the aim-from piece", () => {
    expect(rangeAt(reach(TURRET), 0)).toBe(400);
  });

  it("shrinks with height in a sphere, scaled by heightMod", () => {
    // heightMod defaults to 0.2 for a laser cannon.
    expect(rangeAt(reach(TURRET), -1000)).toBeCloseTo(
      Math.sqrt(400 * 400 - 200 * 200),
      9,
    );
    expect(rangeAt(reach({ ...TURRET, heightMod: 1 }), 500)).toBe(0);
  });

  it("reaches a unit at full range inside a cylinder and not past it", () => {
    const melee = reach({ weaponType: "Melee", range: 50, turret: true });
    expect(melee.cylinderTargeting).toBe(1);
    expect(rangeAt(melee, 40)).toBe(50);
    // 0.2 * 300 is past 1 * 50.
    expect(rangeAt(melee, 300)).toBe(0);
    // A place on the ground is always the sphere.
    expect(rangeAt(melee, 40, "ground")).toBeCloseTo(
      Math.sqrt(50 * 50 - 8 * 8),
      9,
    );
  });

  it("grows with height for a starburst launcher", () => {
    const starburst = reach({ weaponType: "StarburstLauncher", range: 1000 });
    expect(rangeAt(starburst, 100)).toBeCloseTo(1000 + 100 * 0.2 * 0.2, 9);
  });

  it("says a cannon is ballistic and gives it the cannon heightMod", () => {
    const cannon = reach({ weaponType: "Cannon", range: 600, turret: true });
    expect(cannon.rangeKind).toBe("ballistic");
    expect(cannon.heightMod).toBe(0.8);
  });

  // Worked by hand from `CCannon::GetStaticRange2D` (`Cannon.cpp:226-269`).
  // Map gravity is 130 elmo/s^2, stored per frame squared as -130 / 30^2
  // = -0.144444 (`MapInfo.cpp:101-103`). `weaponVelocity` is elmo/s, stored
  // per frame as /30 (`WeaponDef.cpp:76`).
  describe("a cannon, by its shell speed and gravity", () => {
    // weaponVelocity 900 is 30 elmo/frame. speed2D = 30 * 0.7071067 = 21.2132,
    // its square 450. Level ground reaches (450 + 21.2132 * sqrt(450)) /
    // 0.144444 = 900 / 0.144444 = 6230.77. Range 600 is below that, so
    // rangeBoostFactor = 600 / 6230.77 = 0.096296 and level ground reaches
    // 0.096296 * 6230.77 = 600.
    const fast = { weaponType: "Cannon", range: 600, weaponVelocity: 900 };
    // weaponVelocity 300 is 10 elmo/frame: speed2D squared 50, so the shell
    // reaches 100 / 0.144444 = 692.31, short of the stated 1000. The
    // rangeBoostFactor is capped at 1.
    const slow = { weaponType: "Cannon", range: 1000, weaponVelocity: 300 };

    it("reaches the stated range on level ground when the shell is fast enough", () => {
      expect(rangeAt(reach(fast), 0)).toBeCloseTo(600, 3);
    });

    it("falls short of the stated range when the shell is too slow", () => {
      expect(rangeAt(reach(slow), 0)).toBeCloseTo(692.3075, 3);
    });

    it("reaches past the range firing downhill", () => {
      // heightMod 0.8 turns a target 50 below into ydiff = -40. The
      // heightBoostFactor is (2 - 0.096296) / sqrt(0.096296) = 6.13472, and
      // -40 is within 100 of the weapon, so it is scaled by
      // 1 + (6.13472 - 1) * 40 / 100 = 3.05389 to -122.156. The root is
      // 450 + 2 * 0.144444 * 122.156 = 485.29, its square root 22.0293, and
      // the range 0.096296 * (450 + 21.2132 * 22.0293) / 0.144444 = 611.54.
      expect(rangeAt(reach(fast), -50)).toBeCloseTo(611.5411, 3);
      // For the slow shell rangeBoostFactor and heightBoostFactor are both 1,
      // so ydiff stays -40: root 50 + 11.5556 = 61.5556, square root 7.84574,
      // range (50 + 7.07107 * 7.84574) / 0.144444 = 730.23.
      expect(rangeAt(reach(slow), -50)).toBeCloseTo(730.2302, 3);
    });

    it("applies the whole heightBoostFactor past 100 below", () => {
      // 200 below is ydiff -160, past `smoothHeight`, so it is scaled by
      // 6.13472 to -981.55: root 450 + 283.6 = 733.6, square root 27.085,
      // range 0.096296 * (450 + 21.2132 * 27.085) / 0.144444 = 683.03.
      expect(rangeAt(reach(fast), -200)).toBeCloseTo(683.0301, 3);
    });

    it("reaches less far uphill", () => {
      // 100 above is ydiff 80, with no boost: root 450 - 23.1111 = 426.889,
      // square root 20.6614, range 0.096296 * (450 + 21.2132 * 20.6614) /
      // 0.144444 = 592.19.
      expect(rangeAt(reach(fast), 100)).toBeCloseTo(592.1948, 3);
    });

    it("takes a heightBoostFactor from the def instead of working it out", () => {
      // With 2 in place of 6.13472: 1 + (2 - 1) * 0.4 = 1.4, ydiff -56, root
      // 450 + 16.1778 and the range is 605.34.
      expect(
        rangeAt(reach({ ...fast, heightBoostFactor: 2 }), -50),
      ).toBeCloseTo(605.345, 3);
    });

    it("lets myGravity replace the map's", () => {
      // myGravity 0.1 is gravity -0.1 per frame squared. Level ground now
      // reaches 900 / 0.1 = 9000, still above 600, so 600. The slow shell
      // reaches 100 / 0.1 = 1000, which is its stated range.
      expect(rangeAt(reach({ ...fast, myGravity: 0.1 }), 0)).toBeCloseTo(
        600,
        3,
      );
      expect(rangeAt(reach({ ...slow, myGravity: 0.1 }), 0)).toBeCloseTo(
        1000,
        3,
      );
      // Heavier gravity shortens the slow shell: 100 / 0.2 = 500.
      expect(rangeAt(reach({ ...slow, myGravity: 0.2 }), 0)).toBeCloseTo(
        500,
        3,
      );
    });

    it("reads weaponVelocity under its fallback name maxVelocity", () => {
      expect(
        rangeAt(
          reach({ weaponType: "Cannon", range: 1000, maxVelocity: 300 }),
          0,
        ),
      ).toBeCloseTo(692.3075, 3);
    });

    it("is out of reach by the same range", () => {
      const cannon = reach({ ...slow, turret: true });
      expect(outOfReach(cannon, [0, 0, 0], [0, 0, 690])).toBeNull();
      expect(outOfReach(cannon, [0, 0, 0], [0, 0, 695])).toBe("range");
    });
  });

  it("defaults the range to 10, as WeaponDef does", () => {
    expect(reach({ turret: true }).range).toBe(10);
  });
});

describe("outOfReach", () => {
  const front90 = reach(TURRET, { maxangledif: 90 });

  it("refuses a target past the range", () => {
    expect(outOfReach(front90, [0, 0, 0], [0, 0, 399])).toBeNull();
    expect(outOfReach(front90, [0, 0, 0], [0, 0, 401])).toBe("range");
  });

  it("refuses a target outside the arc", () => {
    expect(outOfReach(front90, [0, 0, 0], [99, 0, 101])).toBeNull();
    expect(outOfReach(front90, [0, 0, 0], [101, 0, 99])).toBe("arc");
    expect(outOfReach(front90, [0, 0, 0], [0, 0, -100])).toBe("arc");
  });

  it("measures the 3D direction, so a target far below can leave the arc", () => {
    const narrow = reach(TURRET, { maxangledif: 60 });
    expect(outOfReach(narrow, [0, 0, 0], [0, -100, 100])).toBe("arc");
  });

  it("turns mainDir's x onto rightdir, which is the model's -x", () => {
    const right = reach(TURRET, { maxangledif: 90, maindir: "1 0 0" });
    expect(outOfReach(right, [0, 0, 0], [-100, 0, 0])).toBeNull();
    expect(outOfReach(right, [0, 0, 0], [100, 0, 0])).toBe("arc");
  });

  it("follows the unit's own axes when it has turned", () => {
    // Turned to face +x: frontdir (1,0,0), rightdir frontdir x updir.
    const turned: UnitAxes = {
      front: [1, 0, 0],
      up: [0, 1, 0],
      right: [0, 0, 1],
    };
    expect(outOfReach(front90, [0, 0, 0], [100, 0, 0], "unit", turned)).toBe(
      null,
    );
    expect(outOfReach(front90, [0, 0, 0], [0, 0, 100], "unit", turned)).toBe(
      "arc",
    );
  });

  it("passes a target sitting on the aim-from point", () => {
    expect(outOfReach(front90, [1, 2, 3], [1, 2, 3])).toBeNull();
  });
});

describe("levelArc", () => {
  it("is null for a full circle", () => {
    expect(levelArc(reach(TURRET).arc)).toBeNull();
  });

  it("centres on the facing and spans half maxAngleDif each way", () => {
    const arc = levelArc(reach(TURRET, { maxangledif: 90 }).arc);
    expect(arc?.centre).toBeCloseTo(0, 12);
    expect(arc?.half).toBeCloseTo(Math.PI / 4, 12);
  });

  it("puts a weapon facing the unit's right on the model's -x", () => {
    const arc = levelArc(
      reach(TURRET, { maxangledif: 120, maindir: "1 0 0" }).arc,
    );
    expect(arc?.centre).toBeCloseTo(-Math.PI / 2, 12);
    expect(arc?.half).toBeCloseTo(Math.PI / 3, 12);
  });

  it("widens on the level for a mainDir tilted up", () => {
    const tilted = reach(TURRET, {
      maxangledif: 90,
      maindir: `0 ${Math.sin(Math.PI / 6)} ${Math.cos(Math.PI / 6)}`,
    });
    const arc = levelArc(tilted.arc);
    expect(arc?.half).toBeCloseTo(
      Math.acos(Math.cos(Math.PI / 4) / Math.cos(Math.PI / 6)),
      12,
    );
  });

  it("draws the forward cone of a weapon that is no turret", () => {
    const arc = levelArc(reach({ weaponType: "LaserCannon" }).arc);
    expect(arc?.centre).toBeCloseTo(0, 12);
    expect(arc?.half).toBeCloseTo((3000 * Math.PI) / 32768, 12);
  });
});

describe("aimFromPosition", () => {
  const rest = new Map<string, Vec3>([
    ["turret", [3, 12, -4]],
    ["popup", [0, -5, 0]],
  ]);

  it("is where the aim-from piece rests", () => {
    expect(aimFromPosition(reach(TURRET), rest)).toEqual([3, 12, -4]);
  });

  it("is the unit's origin when the script names no piece", () => {
    const none = { ...reach(TURRET), aimFrom: null };
    expect(aimFromPosition(none, rest)).toEqual([0, 0, 0]);
  });

  it("lifts a piece below the ground to 10 above the origin", () => {
    const popup = { ...reach(TURRET), aimFrom: "popup" };
    expect(aimFromPosition(popup, rest)).toEqual([0, 10, 0]);
  });
});

describe("unitReaches", () => {
  const defs: Record<string, Record<string, unknown>> = {
    laser: { weaponType: "BeamLaser", turret: true, range: 300 },
    rocket: { weaponType: "MissileLauncher", turret: true, range: 700 },
  };

  it("reads the picked weapons in slot order, measured from their carriers", () => {
    const project = unit([
      { role: "turret", weapon: { fires: { from: "game", name: "laser" } } },
      { role: "turret", weapon: {} },
      {
        role: "aim",
        weapon: {
          fires: { from: "game", name: "Rocket" },
          arc: 90,
          heading: 180,
        },
      },
    ]);
    const reaches = unitReaches(
      project,
      (fires) =>
        fires.from === "game" ? defs[fires.name.toLowerCase()] : null,
      {},
      (_number, on) => on,
    );
    expect(reaches.map((r) => [r.number, r.name, r.range, r.aimFrom])).toEqual([
      [1, "laser", 300, "piece0"],
      [2, "rocket", 700, "piece2"],
    ]);
    expect(reaches[0].arc).toEqual({ kind: "full" });
    const arc = levelArc(reaches[1].arc);
    expect(Math.abs(arc?.centre ?? 0)).toBeCloseTo(Math.PI, 2);
    expect(arc?.half).toBeCloseTo(Math.PI / 4, 12);
  });

  it("falls back to the game definition's weapons table", () => {
    const project: LegoProject = {
      ...unit([]),
      gameUnitDef: {
        weapons: [
          { name: "laser", maxangledif: 180, maindir: "0 0 -1" },
          { name: "gone" },
          { name: "rocket" },
        ],
      },
    };
    const reaches = unitReaches(
      project,
      () => null,
      defs,
      (n) => `aim${n}`,
    );
    expect(reaches.map((r) => [r.number, r.name, r.aimFrom])).toEqual([
      [1, "laser", "aim1"],
      [3, "rocket", "aim3"],
    ]);
    expect(reaches[0].arc).toMatchObject({ kind: "mainDir", dir: [0, 0, -1] });
  });
});
