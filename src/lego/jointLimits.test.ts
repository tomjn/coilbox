import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";
import { mirrorLimits, withLimits, yawArc } from "./jointLimits";
import { buildLuaScript } from "./luaScript";
import { mirrorPiece } from "./mirror";
import {
  type LegoPiece,
  type LegoPieceLimits,
  type LegoProject,
  newProject,
  parseLegoProjectJson,
} from "./model";
import { arcFields, weaponExportPlan } from "./weaponModule";

function unit(
  pieces: Partial<LegoPiece>[],
  animations: LegoProject["animations"] = [],
): LegoProject {
  const base = newProject({
    id: "p",
    rootPieceId: "root",
    name: "cakebot",
    packId: "lego",
    packVersion: "1",
    now: "2026-10-18T00:00:00Z",
  });
  return {
    ...base,
    animations,
    pieces: [
      ...base.pieces,
      ...pieces.map((piece, i) => ({
        id: `piece${i}`,
        name: `piece${i}`,
        parentId: "root",
        partId: "x",
        position: [0, 0, 0] as [number, number, number],
        rotation: [0, 0, 0] as [number, number, number],
        scale: [1, 1, 1] as [number, number, number],
        ...piece,
      })),
    ],
  };
}

const TURRET_PRESET = [{ presetId: "turret.track", params: {} }];
const AIM_PRESET = [{ presetId: "aim.track", params: {} }];

function turretUnit(limits?: {
  turret?: LegoPieceLimits;
  barrel?: LegoPieceLimits;
}): LegoProject {
  return unit(
    [
      {
        id: "t",
        name: "turret",
        role: "turret",
        ...(limits?.turret ? { limits: limits.turret } : {}),
        weapon: { fires: { from: "game", name: "armpw_emg" } },
      },
      {
        id: "b",
        name: "barrel",
        role: "barrel",
        parentId: "t",
        ...(limits?.barrel ? { limits: limits.barrel } : {}),
      },
      { id: "f", name: "flare", role: "flare", parentId: "b" },
    ],
    TURRET_PRESET,
  );
}

/** What the unit script did when `AimWeapon1` was called, run in luajit with
 *  the engine's calls stubbed out. */
interface Aimed {
  returned: string;
  turns: string[];
}

function aim(script: string, calls: [string, string][]): Aimed[] {
  const driver = calls
    .map(
      ([heading, pitch]) =>
        `turns = {} print(tostring(script.AimWeapon1(${heading}, ${pitch})) .. "|" .. table.concat(turns, ","))`,
    )
    .join("\n");
  const harness = `
script = {}
turns = {}
x_axis, y_axis, z_axis = 1, 2, 3
function piece(name) return name end
function Signal() end
function SetSignalMask() end
function WaitForTurn() end
function Turn(p, axis, angle) turns[#turns + 1] = p .. ":" .. axis end
function StartThread() end
${script}
${driver}
`;
  const result = spawnSync("luajit", ["-"], { input: harness });
  if (result.status !== 0) {
    throw new Error(`luajit failed: ${result.stderr.toString()}\n${harness}`);
  }
  return result.stdout
    .toString()
    .trim()
    .split("\n")
    .map((line) => {
      const [returned, turns] = line.split("|");
      return { returned, turns: turns ? turns.split(",") : [] };
    });
}

const R = (degrees: number) => `math.rad(${degrees})`;

describe("a yaw range in the generated AimWeapon", () => {
  // 30 degrees to the left to 90 to the right. AimWeapon is handed headings
  // that are positive to the left (Weapon.cpp:424), so that is headings from
  // -90 to 30 degrees.
  const script = buildLuaScript(
    turretUnit({ turret: { yaw: { min: -30, max: 90 } } }),
  );

  it("turns to a target inside the range", () => {
    expect(
      aim(script, [
        [R(0), R(0)],
        [R(-60), R(0)],
        [R(20), R(0)],
      ]),
    ).toEqual([
      { returned: "true", turns: ["turret:2", "barrel:1"] },
      { returned: "true", turns: ["turret:2", "barrel:1"] },
      { returned: "true", turns: ["turret:2", "barrel:1"] },
    ]);
  });

  it("turns to a target exactly on either edge", () => {
    const [low, high] = aim(script, [
      [R(-90), R(0)],
      [R(30), R(0)],
    ]);
    expect(low.returned).toBe("true");
    expect(high.returned).toBe("true");
  });

  it("returns false without turning for a target outside the range", () => {
    const outside = aim(script, [
      [R(-91), R(0)],
      [R(31), R(0)],
      [R(180), R(0)],
    ]);
    for (const result of outside) {
      expect(result).toEqual({ returned: "false", turns: [] });
    }
  });

  it("holds a range through the back, past 180 degrees", () => {
    // 135 to 225 degrees to the right: the arc behind the unit.
    const rear = buildLuaScript(
      turretUnit({ turret: { yaw: { min: 135, max: 225 } } }),
    );
    const results = aim(rear, [
      [R(180), R(0)],
      [R(-135), R(0)],
      [R(135), R(0)],
      [R(0), R(0)],
      [R(-90), R(0)],
    ]).map((result) => result.returned);
    // Right 135 is heading -135, right 225 is heading +135.
    expect(results).toEqual(["true", "true", "true", "false", "false"]);
  });

  it("leaves the pitch alone", () => {
    const [steep] = aim(script, [[R(0), R(80)]]);
    expect(steep.returned).toBe("true");
  });
});

describe("a pitch range in the generated AimWeapon", () => {
  const script = buildLuaScript(
    turretUnit({ barrel: { pitch: { min: -5, max: 60 } } }),
  );

  it("aims inside the range and on its edges", () => {
    const results = aim(script, [
      [R(0), R(10)],
      [R(0), R(-5)],
      [R(0), R(60)],
    ]).map((result) => result.returned);
    expect(results).toEqual(["true", "true", "true"]);
  });

  it("returns false without turning for a pitch outside the range", () => {
    for (const result of aim(script, [
      [R(0), R(61)],
      [R(0), R(-6)],
    ])) {
      expect(result).toEqual({ returned: "false", turns: [] });
    }
  });
});

describe("a range on an aim point", () => {
  it("holds both the heading and the pitch", () => {
    const script = buildLuaScript(
      unit(
        [
          {
            id: "a",
            name: "gimbal",
            role: "aim",
            limits: { yaw: { min: -45, max: 45 }, pitch: { min: 0, max: 30 } },
          },
        ],
        AIM_PRESET,
      ),
    );
    const results = aim(script, [
      [R(0), R(10)],
      [R(-45), R(30)],
      [R(46), R(10)],
      [R(0), R(31)],
      [R(0), R(-1)],
    ]).map((result) => result.returned);
    expect(results).toEqual(["true", "true", "false", "false", "false"]);
  });
});

describe("a range on a build arm", () => {
  const arm = (limits: boolean) =>
    buildLuaScript(
      unit(
        [
          {
            id: "ab",
            name: "armbase",
            role: "buildarm.base",
            ...(limits ? { limits: { yaw: { min: -30, max: 90 } } } : {}),
          },
          {
            id: "ar",
            name: "arm",
            role: "buildarm.arm",
            ...(limits ? { limits: { pitch: { min: 0, max: 40 } } } : {}),
          },
        ],
        [{ presetId: "build.aim", params: {} }],
      ),
    );

  /** The angles `StartBuilding(heading, pitch)` turns each piece to. */
  function started(script: string, heading: string, pitch: string) {
    const harness = `
script = {}
x_axis, y_axis, z_axis = 1, 2, 3
function piece(name) return name end
function Turn(p, axis, angle) print(p .. " " .. math.deg(angle)) end
function WaitForTurn() end
function SetUnitValue() end
COB = {}
${script}
script.StartBuilding(${heading}, ${pitch})
`;
    const result = spawnSync("luajit", ["-"], { input: harness });
    if (result.status !== 0) throw new Error(result.stderr.toString());
    return Object.fromEntries(
      result.stdout
        .toString()
        .trim()
        .split("\n")
        .map((line) => {
          const [name, degrees] = line.split(" ");
          return [name, Math.round(Number(degrees) * 1000) / 1000 + 0];
        }),
    );
  }

  it("turns to an angle inside the range as told", () => {
    expect(started(arm(true), R(-45), R(20))).toEqual({
      armbase: -45,
      arm: -20,
    });
  });

  it("holds an angle outside the range to its nearest edge", () => {
    // Headings are positive to the left: -90 is the 90 degree right edge,
    // 30 is the 30 degree left edge. Pitch is turned about x as -pitch.
    expect(started(arm(true), R(-120), R(70))).toEqual({
      armbase: -90,
      arm: -40,
    });
    expect(started(arm(true), R(120), R(-10))).toEqual({ armbase: 30, arm: 0 });
  });

  it("turns to any angle with no range", () => {
    expect(started(arm(false), R(-120), R(70))).toEqual({
      armbase: -120,
      arm: -70,
    });
  });
});

describe("a unit whose joints have no range", () => {
  it("writes the script it always did", () => {
    const script = buildLuaScript(turretUnit());
    expect(script).toContain("function script.AimWeapon1(heading, pitch)");
    expect(script).not.toContain("math.rad");
    expect(script).not.toContain("return false");
    expect(script).toBe(buildLuaScript(turretUnit({})));
  });

  it("reads a range that is not a range as none", () => {
    const flat = buildLuaScript(
      turretUnit({
        turret: { yaw: { min: 10, max: 10 } },
        barrel: { pitch: { min: 20, max: 5 } },
      }),
    );
    expect(flat).toBe(buildLuaScript(turretUnit()));
  });

  it("reads a yaw range of a full turn as none", () => {
    const full = buildLuaScript(
      turretUnit({ turret: { yaw: { min: -180, max: 180 } } }),
    );
    expect(full).toBe(buildLuaScript(turretUnit()));
  });

  it("writes the weapon slot it always did", () => {
    const plan = weaponExportPlan(turretUnit(), []);
    expect(plan.slots).toEqual([{ def: "armpw_emg", name: "armpw_emg" }]);
  });
});

describe("the weapon definition a yaw range gives", () => {
  it("is a cone about the front for a symmetric range", () => {
    expect(yawArc({ min: -60, max: 60 })).toEqual({ arc: 120, heading: 0 });
    const plan = weaponExportPlan(
      turretUnit({ turret: { yaw: { min: -60, max: 60 } } }),
      [],
    );
    expect(plan.slots).toEqual([
      {
        def: "armpw_emg",
        name: "armpw_emg",
        maxangledif: 120,
        maindir: "0 0 1",
      },
    ]);
  });

  it("is a cone about the middle of an asymmetric range", () => {
    // 30 degrees left to 90 right: 120 wide, centred 30 degrees to the right.
    const plan = weaponExportPlan(
      turretUnit({ turret: { yaw: { min: -30, max: 90 } } }),
      [],
    );
    expect(plan.slots).toEqual([
      {
        def: "armpw_emg",
        name: "armpw_emg",
        maxangledif: 120,
        maindir: "0.5 0 0.866",
      },
    ]);
  });

  it("replaces the arc the weapon panel set", () => {
    const limited = {
      yaw: { min: -30, max: 90 },
    };
    expect(arcFields({ arc: 40, heading: 10 }, limited)).toEqual(
      arcFields({}, limited),
    );
  });

  it("leaves the weapon's own arc in force for a range of a full turn", () => {
    expect(arcFields({ arc: 100 }, { yaw: { min: -180, max: 180 } })).toEqual({
      maxangledif: 100,
      maindir: "0 0 1",
    });
  });

  it("is not changed by a pitch range, which the definition has no key for", () => {
    const plan = weaponExportPlan(
      turretUnit({ barrel: { pitch: { min: 0, max: 45 } } }),
      [],
    );
    expect(plan.slots).toEqual([{ def: "armpw_emg", name: "armpw_emg" }]);
  });
});

describe("mirrored ranges", () => {
  it("swaps and negates the yaw and keeps the pitch", () => {
    expect(
      mirrorLimits({
        yaw: { min: -30, max: 90 },
        pitch: { min: -5, max: 60 },
      }),
    ).toEqual({ yaw: { min: -90, max: 30 }, pitch: { min: -5, max: 60 } });
  });

  it("mirrors twice back to the start", () => {
    const limits = { yaw: { min: -30, max: 90 } };
    expect(mirrorLimits(mirrorLimits(limits))).toEqual(limits);
  });

  it("is what a mirrored piece carries", () => {
    const project = turretUnit({ turret: { yaw: { min: -30, max: 90 } } });
    const mirrored = mirrorPiece(project, "t");
    const turret = mirrored.pieces.find((piece) => piece.id === "t");
    expect(turret?.limits).toEqual({ yaw: { min: -90, max: 30 } });
  });
});

describe("limits in a saved document", () => {
  it("survive a save and a load", () => {
    const project = turretUnit({
      turret: { yaw: { min: -30, max: 90 } },
      barrel: { pitch: { min: -5, max: 60 } },
    });
    const loaded = parseLegoProjectJson(JSON.stringify(project));
    expect(loaded?.pieces.find((piece) => piece.id === "t")?.limits).toEqual({
      yaw: { min: -30, max: 90 },
    });
    expect(loaded?.pieces.find((piece) => piece.id === "b")?.limits).toEqual({
      pitch: { min: -5, max: 60 },
    });
  });

  it("drop a range that is backwards or not a number", () => {
    const project = turretUnit();
    const doc = JSON.parse(JSON.stringify(project));
    doc.pieces.find((p: { id: string }) => p.id === "t").limits = {
      yaw: { min: 90, max: -30 },
      pitch: { min: "a", max: 3 },
    };
    const loaded = parseLegoProjectJson(JSON.stringify(doc));
    expect(
      loaded?.pieces.find((piece) => piece.id === "t")?.limits,
    ).toBeUndefined();
  });
});

describe("withLimits", () => {
  it("sets the mirrored range on a twin in the same edit", () => {
    const base = turretUnit();
    const project: LegoProject = {
      ...base,
      pieces: [
        ...base.pieces,
        {
          ...(base.pieces.find((p) => p.id === "t") as LegoPiece),
          id: "t2",
          name: "turret2",
          twin: "t",
        },
      ].map((p) => (p.id === "t" ? { ...p, twin: "t2" } : p)),
    };
    const set = withLimits(project, "t", { yaw: { min: -30, max: 90 } });
    expect(set.pieces.find((p) => p.id === "t")?.limits).toEqual({
      yaw: { min: -30, max: 90 },
    });
    expect(set.pieces.find((p) => p.id === "t2")?.limits).toEqual({
      yaw: { min: -90, max: 30 },
    });
    const cleared = withLimits(set, "t", undefined);
    expect(cleared.pieces.find((p) => p.id === "t")).not.toHaveProperty(
      "limits",
    );
    expect(cleared.pieces.find((p) => p.id === "t2")).not.toHaveProperty(
      "limits",
    );
  });
});
