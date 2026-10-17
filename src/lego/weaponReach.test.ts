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

  it("keeps the stated range for a cannon and says it is ballistic", () => {
    const cannon = reach({ weaponType: "Cannon", range: 600, turret: true });
    expect(cannon.rangeKind).toBe("ballistic");
    expect(cannon.heightMod).toBe(0.8);
    expect(rangeAt(cannon, -50)).toBe(600);
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
