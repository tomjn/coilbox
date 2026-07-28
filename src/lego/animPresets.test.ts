import { describe, expect, it } from "vitest";

import {
  BUILDARM,
  countRoles,
  isRole,
  OPEN_CLOSE,
  PRESETS,
  presetById,
  ROLES,
  TURRET_TRACK,
  unmetRequirements,
  WALK_BIPED,
  WALK_QUAD,
  WHEELS_ROLL,
} from "./animPresets";

/** The x rotation a preset gives a role, in degrees, for readable assertions. */
function pitch(
  preset: (typeof PRESETS)[number],
  t: number,
  role: string,
  params: Record<string, number> = {},
): number {
  const delta = preset.track(t, params, role);
  if (!delta?.rotation) throw new Error(`${role} is not moved at ${t}`);
  return Number(((delta.rotation[0] * 180) / Math.PI).toFixed(4));
}

function yaw(
  preset: (typeof PRESETS)[number],
  t: number,
  role: string,
  params: Record<string, number> = {},
): number {
  const delta = preset.track(t, params, role);
  if (!delta?.rotation) throw new Error(`${role} is not moved at ${t}`);
  return Number(((delta.rotation[1] * 180) / Math.PI).toFixed(4));
}

describe("roles", () => {
  it("has no duplicate ids", () => {
    const ids = ROLES.map((role) => role.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("recognises only its own vocabulary", () => {
    expect(isRole("turret")).toBe(true);
    expect(isRole("leg.r2.foot")).toBe(true);
    expect(isRole("leg.l3.thigh")).toBe(false);
    expect(isRole("whatever")).toBe(false);
  });
});

describe("presets", () => {
  it("has no duplicate ids, and every one is findable", () => {
    const ids = PRESETS.map((preset) => preset.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(presetById(id)?.id).toBe(id);
  });

  it("only requires and animates roles that exist", () => {
    for (const preset of PRESETS) {
      for (const need of preset.requires) expect(isRole(need.role)).toBe(true);
      for (const role of preset.animates) expect(isRole(role)).toBe(true);
    }
  });

  it("animates every role it requires", () => {
    for (const preset of PRESETS) {
      for (const need of preset.requires) {
        expect(preset.animates).toContain(need.role);
      }
    }
  });

  it("moves nothing it does not claim to animate", () => {
    for (const preset of PRESETS) {
      for (const role of ROLES) {
        if (preset.animates.includes(role.id)) continue;
        expect(preset.track(0.37, {}, role.id)).toBeNull();
      }
    }
  });
});

describe("unmetRequirements", () => {
  it("names the roles a unit is missing", () => {
    const counts = countRoles([
      { role: "leg.l1.thigh" },
      { role: "leg.l1.shin" },
    ]);

    expect(unmetRequirements(WALK_BIPED, counts)).toEqual([
      "leg.r1.thigh",
      "leg.r1.shin",
    ]);
  });

  it("is empty once everything is filled", () => {
    const counts = countRoles([
      { role: "leg.l1.thigh" },
      { role: "leg.l1.shin" },
      { role: "leg.r1.thigh" },
      { role: "leg.r1.shin" },
    ]);

    expect(unmetRequirements(WALK_BIPED, counts)).toEqual([]);
  });

  it("ignores pieces with no role at all", () => {
    expect(countRoles([{}, { role: "wheel" }, {}]).get("wheel")).toBe(1);
  });
});

describe("walk.biped", () => {
  it("swings the two legs in opposition", () => {
    const quarter = 0.25;

    expect(pitch(WALK_BIPED, quarter, "leg.l1.thigh")).toBe(25);
    expect(pitch(WALK_BIPED, quarter, "leg.r1.thigh")).toBe(-25);
  });

  it("keeps the foot flat by undoing the thigh and the shin", () => {
    const t = 0.31;
    const thigh = pitch(WALK_BIPED, t, "leg.l1.thigh");
    const shin = pitch(WALK_BIPED, t, "leg.l1.shin");

    expect(pitch(WALK_BIPED, t, "leg.l1.foot")).toBeCloseTo(-(thigh + shin), 3);
  });

  it("never bends the knee backwards", () => {
    for (let t = 0; t < 1; t += 0.05) {
      expect(pitch(WALK_BIPED, t, "leg.l1.shin")).toBeGreaterThanOrEqual(0);
    }
  });

  it("repeats exactly one stride per period", () => {
    const params = { period: 1.4 };

    expect(pitch(WALK_BIPED, 0.3, "leg.l1.thigh", params)).toBeCloseTo(
      pitch(WALK_BIPED, 1.7, "leg.l1.thigh", params),
      4,
    );
  });

  it("leaves a second pair of legs alone", () => {
    expect(WALK_BIPED.track(0.4, {}, "leg.l2.thigh")).toBeNull();
  });

  it("survives a period of zero rather than dividing by it", () => {
    expect(
      Number.isFinite(pitch(WALK_BIPED, 0.5, "leg.l1.thigh", { period: 0 })),
    ).toBe(true);
  });
});

describe("walk.quad", () => {
  it("moves diagonal pairs together", () => {
    const t = 0.2;

    expect(pitch(WALK_QUAD, t, "leg.l1.thigh")).toBe(
      pitch(WALK_QUAD, t, "leg.r2.thigh"),
    );
    expect(pitch(WALK_QUAD, t, "leg.r1.thigh")).toBe(
      pitch(WALK_QUAD, t, "leg.l2.thigh"),
    );
  });

  it("puts the two diagonals against each other", () => {
    const t = 0.2;

    expect(pitch(WALK_QUAD, t, "leg.l1.thigh")).toBeCloseTo(
      -pitch(WALK_QUAD, t, "leg.r1.thigh"),
      4,
    );
  });
});

describe("turret.track", () => {
  it("sweeps the turret both ways about its rest position", () => {
    expect(yaw(TURRET_TRACK, 0, "turret")).toBe(0);
    expect(yaw(TURRET_TRACK, 1, "turret")).toBe(60);
    expect(yaw(TURRET_TRACK, 3, "turret")).toBe(-60);
  });

  it("only ever lifts the barrel, never drops it below rest", () => {
    for (let t = 0; t < 4; t += 0.1) {
      expect(pitch(TURRET_TRACK, t, "barrel")).toBeLessThanOrEqual(0);
    }
  });
});

describe("wheels.roll", () => {
  it("turns once per second at one turn per second", () => {
    const delta = WHEELS_ROLL.track(1, { rate: 1 }, "wheel");

    expect(delta?.rotation?.[0]).toBeCloseTo(Math.PI * 2, 6);
  });

  it("keeps turning rather than swinging back", () => {
    expect(pitch(WHEELS_ROLL, 4, "wheel")).toBeGreaterThan(
      pitch(WHEELS_ROLL, 2, "wheel"),
    );
  });
});

describe("buildarm", () => {
  it("has the nozzle cancel the arm's lift", () => {
    const t = 0.9;

    expect(pitch(BUILDARM, t, "buildarm.nozzle")).toBeCloseTo(
      -pitch(BUILDARM, t, "buildarm.arm"),
      4,
    );
  });
});

describe("open.close", () => {
  it("starts shut, so a unit at rest is not hanging open", () => {
    expect(yaw(OPEN_CLOSE, 0, "door")).toBe(0);
  });

  it("opens fully halfway through the cycle and shuts again", () => {
    const params = { period: 4, open: 80 };

    expect(yaw(OPEN_CLOSE, 2, "door", params)).toBeCloseTo(80, 3);
    expect(yaw(OPEN_CLOSE, 4, "door", params)).toBeCloseTo(0, 3);
  });
});
