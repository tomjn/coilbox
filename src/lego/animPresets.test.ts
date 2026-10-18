import * as THREE from "three";
import { describe, expect, it } from "vitest";

import {
  AIM_TRACK,
  BUILD_FACTORY,
  BUILDARM,
  countRoles,
  ENGINE_ROTATION_ORDER,
  HOVER_BOB,
  IDLE_SWAY,
  isRole,
  legPhase,
  OPEN_CLOSE,
  PRESETS,
  parseLegRole,
  pickerRoles,
  presetById,
  presetMovesRole,
  RECOIL,
  ROLES,
  restAngleWarnings,
  roleLabel,
  TURRET_TRACK,
  unmetRequirements,
  WAKE_WHILE_MOVING,
  WALK_BIPED,
  WALK_LEGS,
  WALK_QUAD,
  WHEELS_ROLL,
  WRECK_POSE,
  waveDuty,
  waveTouchdown,
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

function roll(
  preset: (typeof PRESETS)[number],
  t: number,
  role: string,
  params: Record<string, number> = {},
): number {
  const delta = preset.track(t, params, role);
  if (!delta?.rotation) throw new Error(`${role} is not moved at ${t}`);
  return Number(((delta.rotation[2] * 180) / Math.PI).toFixed(4));
}

function height(
  preset: (typeof PRESETS)[number],
  t: number,
  role: string,
  params: Record<string, number> = {},
): number {
  const delta = preset.track(t, params, role);
  if (!delta?.position) throw new Error(`${role} is not moved at ${t}`);
  return delta.position[1];
}

/** The z translation a preset gives a role: recoil's own axis. */
function depth(
  preset: (typeof PRESETS)[number],
  t: number,
  role: string,
  params: Record<string, number> = {},
): number {
  const delta = preset.track(t, params, role);
  if (!delta?.position) throw new Error(`${role} is not moved at ${t}`);
  return delta.position[2];
}

/**
 * `CQuaternion::FromEulerYPR`, transcribed from the engine, with pitch about
 * x, yaw about y and roll about z. This is what the engine turns a piece's
 * script rotation into, so it is what a delta has to agree with.
 */
function enginePieceRotation(
  rotation: readonly number[],
): [number, number, number, number] {
  const [sp, sy, sr] = rotation.map((angle) => Math.sin(angle * 0.5));
  const [cp, cy, cr] = rotation.map((angle) => Math.cos(angle * 0.5));
  return [
    cr * cy * sp + cp * sr * sy,
    cp * cr * sy - cy * sp * sr,
    cp * cy * sr - cr * sp * sy,
    cp * cr * cy + sp * sr * sy,
  ];
}

function composed(
  rotation: readonly number[],
  order: THREE.EulerOrder,
): [number, number, number, number] {
  const quaternion = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(rotation[0], rotation[1], rotation[2], order),
  );
  return [quaternion.x, quaternion.y, quaternion.z, quaternion.w];
}

describe("rotation order", () => {
  // A moment where the aim piece has both a heading and a pitch, which is the
  // only case the two orders disagree on and the reason this is pinned.
  const twoAxis = AIM_TRACK.track(1.4, {}, "aim")?.rotation ?? [];

  it("composes a delta the way the engine composes a script rotation", () => {
    expect(twoAxis[0]).not.toBeCloseTo(0, 3);
    expect(twoAxis[1]).not.toBeCloseTo(0, 3);

    const engine = enginePieceRotation(twoAxis);
    composed(twoAxis, ENGINE_ROTATION_ORDER).forEach((term, index) => {
      expect(term).toBeCloseTo(engine[index], 12);
    });
  });

  it("does not agree with three's default order", () => {
    // Not a curiosity: XYZ is what playback used before, and this is the
    // assertion that fails if it drifts back. Turning about x and y flips the
    // sign of z, which is the term the two orders part company on.
    const engine = enginePieceRotation(twoAxis);
    expect(composed(twoAxis, "XYZ")[2]).toBeCloseTo(-engine[2], 12);
    expect(composed(twoAxis, "XYZ")[2]).not.toBeCloseTo(engine[2], 6);
  });
});

describe("roles", () => {
  it("has no duplicate ids", () => {
    const ids = ROLES.map((role) => role.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("recognises only its own vocabulary", () => {
    expect(isRole("turret")).toBe(true);
    expect(isRole("leg.r2.foot")).toBe(true);
    // Any number of leg pairs (#3351), counted from 1.
    expect(isRole("leg.l3.thigh")).toBe(true);
    expect(isRole("leg.r12.shin")).toBe(true);
    expect(isRole("leg.l0.thigh")).toBe(false);
    expect(isRole("leg.l03.thigh")).toBe(false);
    expect(isRole("leg.l3.knee")).toBe(false);
    expect(isRole("whatever")).toBe(false);
  });

  it("reads a leg role of any pair", () => {
    expect(parseLegRole("leg.r4.foot")).toEqual({
      side: "r",
      pair: 4,
      segment: "foot",
    });
    expect(roleLabel("leg.l1.thigh")).toBe("Front left thigh");
    expect(roleLabel("leg.r3.shin")).toBe("Right shin, pair 3");
  });

  it("offers one leg pair past the unit's last in the picker", () => {
    const legs = (pieces: { role?: string }[]) =>
      pickerRoles(pieces).filter((role) => role.group === "Legs").length;
    expect(legs([])).toBe(12);
    expect(legs([{ role: "leg.l2.foot" }])).toBe(18);
    expect(legs([{ role: "leg.r4.thigh" }])).toBe(30);
    // The rest of the list is as it was, legs where they always were.
    const ids = pickerRoles([]).map((role) => role.id);
    expect(ids).toEqual(ROLES.map((role) => role.id));
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

  /**
   * A preset that asks for a role and then never moves it is asking for
   * nothing, which is a bug in a preset that animates.
   *
   * Not every preset animates. `build.nano` answers `QueryNanoPiece` with the
   * pieces carrying its role and moves none of them, so it claims an empty
   * `animates` honestly rather than naming roles it never touches. Playback
   * reads `animates` to know what to reset, and a role listed there that
   * nothing moves would have it reset a piece for no reason.
   */
  it("animates every role it requires, unless it animates nothing at all", () => {
    for (const preset of PRESETS) {
      if (preset.animates.length === 0) continue;
      for (const need of preset.requires) {
        expect(preset.animates).toContain(need.role);
      }
    }
  });

  it("gives a preset that animates nothing no parameters to animate with", () => {
    for (const preset of PRESETS) {
      if (preset.animates.length > 0) continue;
      // The wake's interval is how often it emits, not how far anything moves.
      if (preset !== WAKE_WHILE_MOVING) expect(preset.params).toEqual([]);
      expect(preset.track(0, {}, preset.requires[0].role)).toBeNull();
    }
  });

  it("moves nothing it does not claim to animate", () => {
    for (const preset of PRESETS) {
      for (const role of pickerRoles([{ role: "leg.l4.thigh" }])) {
        if (presetMovesRole(preset, role.id)) continue;
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

  it("names every leg a walk for any number of legs is missing, up to the last pair", () => {
    const counts = countRoles(
      ["l1", "r1", "l2", "l3", "r3"].flatMap((leg) => [
        { role: `leg.${leg}.thigh` },
        { role: `leg.${leg}.shin` },
      ]),
    );
    expect(unmetRequirements(WALK_LEGS, counts)).toEqual([
      "leg.r2.thigh",
      "leg.r2.shin",
    ]);
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

describe("walk.legs gaits (#3351)", () => {
  /** Each leg's touchdown as a share of the cycle, front left first. */
  const table = (pairs: number, duty: number) =>
    Array.from({ length: pairs }, (_, i) =>
      (["l", "r"] as const).map((side) =>
        Number(waveTouchdown({ side, pair: i + 1 }, duty).toFixed(6)),
      ),
    );

  it("is the tripod on six legs at half the time on the ground", () => {
    // Front and rear left with middle right, then the other three.
    expect(table(3, 0.5)).toEqual([
      [0, 0.5],
      [0.5, 0],
      [0, 0.5],
    ]);
  });

  it("is the alternating tetrapod on eight legs at half", () => {
    expect(table(4, 0.5)).toEqual([
      [0, 0.5],
      [0.5, 0],
      [0, 0.5],
      [0.5, 0],
    ]);
  });

  it("is the trot on four legs and opposition on two at half, as the fixed walks", () => {
    for (const [pairs, gait] of [
      [1, "biped"],
      [2, "quad"],
    ] as const) {
      for (let pair = 1; pair <= pairs; pair++) {
        for (const side of ["l", "r"] as const) {
          const leg = { side, pair, segment: "thigh" as const };
          expect(legPhase(leg, "wave", 0.5)).toBeCloseTo(
            legPhase(leg, gait),
            12,
          );
        }
      }
    }
  });

  it("is the crawl on four legs at three quarters, the rear leg first after the front on each side", () => {
    expect(table(2, 0.75)).toEqual([
      [0, 0.5],
      [0.75, 0.25],
    ]);
  });

  it("is the wave on six legs at five sixths, lifting rear to front", () => {
    const duty = 5 / 6;
    const lifts = table(3, duty).map(([left]) => (left + duty) % 1);
    // The rear left lifts first, then the middle, then the front, a sixth
    // apart.
    [5 / 6, 4 / 6, 3 / 6].forEach((lift, i) => {
      expect(lifts[i]).toBeCloseTo(lift, 5);
    });
  });

  it("starts at the least time on the ground that keeps three feet down", () => {
    expect([1, 2, 3, 4, 5].map(waveDuty)).toEqual([50, 75, 50, 50, 50]);
  });

  it("moves every pair it is given and not only the first", () => {
    expect(WALK_LEGS.track(0.2, {}, "leg.l7.shin")).not.toBeNull();
    expect(WALK_QUAD.track(0.2, {}, "leg.l3.shin")).toBeNull();
    expect(WALK_BIPED.track(0.2, {}, "leg.l2.shin")).toBeNull();
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

describe("hover.bob", () => {
  it("sits level at the start of the cycle", () => {
    expect(height(HOVER_BOB, 0, "base")).toBeCloseTo(0, 4);
    expect(roll(HOVER_BOB, 0, "base")).toBeCloseTo(0, 4);
  });

  it("bobs up and back down within one period", () => {
    const params = { period: 2, height: 0.4 };

    expect(height(HOVER_BOB, 0.5, "base", params)).toBeCloseTo(0.4, 4);
    expect(height(HOVER_BOB, 1, "base", params)).toBeCloseTo(0, 4);
    expect(height(HOVER_BOB, 1.5, "base", params)).toBeCloseTo(-0.4, 4);
  });

  it("rocks in phase with the bob", () => {
    const params = { period: 2, sway: 5 };

    expect(roll(HOVER_BOB, 0.5, "base", params)).toBeCloseTo(5, 3);
    expect(roll(HOVER_BOB, 1, "base", params)).toBeCloseTo(0, 4);
    expect(roll(HOVER_BOB, 1.5, "base", params)).toBeCloseTo(-5, 3);
  });
});

describe("aim.track", () => {
  it("sweeps both ways about its rest position", () => {
    expect(yaw(AIM_TRACK, 0, "aim")).toBe(0);
    expect(yaw(AIM_TRACK, 1, "aim")).toBe(60);
    expect(yaw(AIM_TRACK, 3, "aim")).toBe(-60);
  });

  it("only ever lifts, never dips below rest", () => {
    for (let t = 0; t < 4; t += 0.1) {
      expect(pitch(AIM_TRACK, t, "aim")).toBeLessThanOrEqual(0);
    }
  });
});

describe("recoil", () => {
  const params = { kick: 0.5, kickTime: 0.1, returnTime: 0.4 };

  it("sits at rest the instant the shot starts", () => {
    expect(depth(RECOIL, 0, "barrel", params)).toBeCloseTo(0, 4);
  });

  it("kicks back to its full distance at the end of the kick", () => {
    expect(depth(RECOIL, 0.1, "barrel", params)).toBeCloseTo(-0.5, 4);
  });

  it("eases back to rest once it has had time to return", () => {
    expect(depth(RECOIL, 0.1 + 0.4, "barrel", params)).toBeCloseTo(0, 4);
  });

  it("never kicks forward, only back", () => {
    for (let t = 0; t < 2; t += 0.05) {
      expect(depth(RECOIL, t, "barrel", params)).toBeLessThanOrEqual(0);
    }
  });

  it("repeats the kick after a rest, so a preview has something to watch", () => {
    const cycle = 0.1 + 0.4 + 0.6;
    expect(depth(RECOIL, cycle, "barrel", params)).toBeCloseTo(0, 4);
    expect(depth(RECOIL, cycle + 0.1, "barrel", params)).toBeCloseTo(-0.5, 4);
  });
});

describe("wreck.pose", () => {
  const params = { sink: 0.2, tilt: 15 };

  it("gives the same pose whatever moment it is asked for", () => {
    expect(height(WRECK_POSE, 0, "base", params)).toBeCloseTo(
      height(WRECK_POSE, 9.7, "base", params),
      6,
    );
    expect(roll(WRECK_POSE, 0, "base", params)).toBeCloseTo(
      roll(WRECK_POSE, 9.7, "base", params),
      6,
    );
  });

  it("sinks down and tilts by the given amount", () => {
    expect(height(WRECK_POSE, 0, "base", params)).toBeCloseTo(-0.2, 4);
    expect(roll(WRECK_POSE, 0, "base", params)).toBeCloseTo(15, 4);
  });

  it("leaves every other role alone", () => {
    expect(WRECK_POSE.track(0, params, "turret")).toBeNull();
  });
});

describe("build.factory", () => {
  it("opens a door saved at half a turn no wider than the slider allows", () => {
    // Half a turn is as short backwards as forwards, so the engine opened a
    // door asked for 180 degrees the wrong way round.
    const max = BUILD_FACTORY.params.find((p) => p.id === "open")?.max ?? 0;
    expect(max).toBeLessThan(180);
    expect(yaw(BUILD_FACTORY, 2.5, "door", { open: 180 })).toBe(max);
  });
});

describe("idle.sway", () => {
  it("starts at rest", () => {
    expect(yaw(IDLE_SWAY, 0, "base")).toBe(0);
  });

  it("turns one way then the other within a period", () => {
    const params = { period: 4, turn: 10 };

    expect(yaw(IDLE_SWAY, 1, "base", params)).toBeCloseTo(10, 4);
    expect(yaw(IDLE_SWAY, 3, "base", params)).toBeCloseTo(-10, 4);
  });
});

/** Degrees to radians, for readable rest rotations in the tests below. */
function rad(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

describe("restAngleWarnings", () => {
  it("says nothing about a piece with no role", () => {
    expect(restAngleWarnings({ rotation: [rad(37), 0, 0] })).toEqual([]);
  });

  it("says nothing about a role no preset ever turns", () => {
    expect(
      restAngleWarnings({ role: "flare", rotation: [rad(37), 0, 0] }),
    ).toEqual([]);
  });

  it("says nothing when the rotation on the turned axis is a right angle", () => {
    expect(
      restAngleWarnings({ role: "wheel", rotation: [rad(90), 0, 0] }),
    ).toEqual([]);
  });

  it("says nothing a fraction off a right angle", () => {
    expect(
      restAngleWarnings({ role: "wheel", rotation: [rad(91), 0, 0] }),
    ).toEqual([]);
  });

  it("names the axis, the angle and a clean value nearby when off-axis", () => {
    const warnings = restAngleWarnings({
      role: "wheel",
      rotation: [rad(37), 0, 0],
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("Wheel");
    expect(warnings[0]).toContain("X");
    expect(warnings[0]).toContain("37.0");
    expect(warnings[0]).toContain("0°");
  });

  it("checks the axis the role actually turns about, not just x", () => {
    // A turret turns about y, so a dirty x rotation is not its business.
    expect(
      restAngleWarnings({ role: "turret", rotation: [rad(37), 0, 0] }),
    ).toEqual([]);
    expect(
      restAngleWarnings({ role: "turret", rotation: [0, rad(37), 0] }),
    ).toHaveLength(1);
  });

  it("works for both sides of a mirrored leg role", () => {
    expect(
      restAngleWarnings({ role: "leg.l1.thigh", rotation: [rad(20), 0, 0] }),
    ).toHaveLength(1);
    expect(
      restAngleWarnings({ role: "leg.r1.thigh", rotation: [rad(20), 0, 0] }),
    ).toHaveLength(1);
    expect(
      restAngleWarnings({ role: "leg.r2.foot", rotation: [rad(180), 0, 0] }),
    ).toEqual([]);
  });

  it("checks every axis a role turns about, for a role that turns about more than one", () => {
    // aim turns about both x (pitch) and y (heading).
    expect(
      restAngleWarnings({ role: "aim", rotation: [rad(15), 0, 0] }),
    ).toHaveLength(1);
    expect(
      restAngleWarnings({ role: "aim", rotation: [rad(15), rad(15), 0] }),
    ).toHaveLength(2);
    expect(
      restAngleWarnings({ role: "aim", rotation: [0, 0, rad(15)] }),
    ).toEqual([]);
  });
});
