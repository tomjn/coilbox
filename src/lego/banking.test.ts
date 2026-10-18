import { describe, expect, it } from "vitest";
import {
  bankingKeys,
  ENGINE_BANKING,
  flightOf,
  hoverBankStep,
  strafeRollStep,
  withEngineBanking,
} from "./banking";
import { type DriveMotion, driveAlong, driveMotion, pathPoints } from "./drive";
import { newProject } from "./model";
import { PREVIEW_FRAMES } from "./scriptPlayback";

describe("the engine's banking defaults", () => {
  /** `UnitDef.cpp:522,559,560,564-566`. */
  it("match the numbers in UnitDef.cpp", () => {
    expect(ENGINE_BANKING).toEqual({
      bankingAllowed: true,
      maxBank: 0.8,
      maxPitch: 0.45,
      maxAileron: 0.015,
      maxElevator: 0.01,
      maxRudder: 0.004,
    });
  });

  it("gives a gunship one key and a plane five", () => {
    expect(bankingKeys("gunship").map((k) => k.key)).toEqual([
      "bankingAllowed",
    ]);
    expect(bankingKeys("plane").map((k) => k.key)).toEqual([
      "maxBank",
      "maxPitch",
      "maxAileron",
      "maxElevator",
      "maxRudder",
    ]);
    for (const style of ["gunship", "plane"] as const)
      for (const key of bankingKeys(style))
        expect(key.engineDefault).toBe(ENGINE_BANKING[key.key]);
  });

  it("fills only the keys a style reads, and keeps what is set", () => {
    const plane = withEngineBanking({
      moveClass: "",
      flies: "plane",
      maxBank: 0.5,
    });
    expect(plane).toMatchObject({
      maxBank: 0.5,
      maxPitch: 0.45,
      maxAileron: 0.015,
      maxElevator: 0.01,
      maxRudder: 0.004,
      maxPitchFrom: "Engine default",
    });
    expect(plane).not.toHaveProperty("bankingAllowed");
    expect(plane).not.toHaveProperty("maxBankFrom");
    const gunship = withEngineBanking({ moveClass: "", flies: "gunship" });
    expect(gunship.bankingAllowed).toBe(true);
    expect(gunship).not.toHaveProperty("maxBank");
  });

  it("leaves a ground unit's movement alone", () => {
    const movement = { moveClass: "TANK2", speed: 60 };
    expect(withEngineBanking(movement)).toBe(movement);
    expect(flightOf(movement)).toBeNull();
  });
});

describe("hoverBankStep", () => {
  const far = { accRate: 0.5, goalDistance: 1000, banking: true };

  /** `wantedBank = lateral / accRate * 0.5` (`HoverAirMoveType.cpp:716`), and
   *  the bank moves by at most 0.03 a frame (lines 721-725). */
  it("moves towards lateral / accRate * 0.5, 0.03 a frame", () => {
    expect(hoverBankStep({ ...far, bank: 0, lateral: 0.2 })).toBeCloseTo(0.03);
    expect(hoverBankStep({ ...far, bank: 0.19, lateral: 0.2 })).toBeCloseTo(
      0.2,
    );
    expect(hoverBankStep({ ...far, bank: 0.2, lateral: 0.2 })).toBeCloseTo(0.2);
    expect(hoverBankStep({ ...far, bank: 0, lateral: -0.2 })).toBeCloseTo(
      -0.03,
    );
  });

  it("levels out when banking is off", () => {
    expect(
      hoverBankStep({ ...far, bank: 0.1, lateral: 0.2, banking: false }),
    ).toBeCloseTo(0.07);
  });

  /** `bankLimit = min(1, distance^2 * 0.15^2)`, applied to the square with
   *  the positive root as the replacement (lines 689,717,718). */
  it("limits the bank near the goal, as the engine does", () => {
    const near = { ...far, goalDistance: 1 };
    // 0.2^2 = 0.04 is over the limit 0.0225, so the wanted bank is 0.15.
    expect(hoverBankStep({ ...near, bank: 0.14, lateral: 0.2 })).toBeCloseTo(
      0.15,
    );
    // The engine replaces a left bank over the limit with a right one.
    expect(hoverBankStep({ ...near, bank: 0.14, lateral: -0.2 })).toBeCloseTo(
      0.15,
    );
  });

  it("never banks past a radian", () => {
    expect(hoverBankStep({ ...far, bank: 0.99, lateral: 100 })).toBeCloseTo(1);
  });
});

describe("strafeRollStep", () => {
  const base = { maxBank: 0.8, maxAileron: 0.015 };

  /** The ailerons settle `goalDotRight + rightdir.y * 0.5` at zero
   *  (`StrafeAirMoveType.cpp:187`), so sin(roll) = 2 * goalDotRight, and the
   *  roll moves `maxAileron * speed` a frame (line 1097). */
  it("rolls at maxAileron * speed towards 2 * goalDotRight", () => {
    expect(
      strafeRollStep({ ...base, roll: 0, goalDotRight: 0.2, speed: 4 }),
    ).toBeCloseTo(0.06);
    expect(
      strafeRollStep({ ...base, roll: 0.38, goalDotRight: 0.2, speed: 4 }),
    ).toBeCloseTo(0.4);
    expect(
      strafeRollStep({ ...base, roll: 0, goalDotRight: -0.2, speed: 4 }),
    ).toBeCloseTo(-0.06);
  });

  it("stops at maxBank", () => {
    expect(
      strafeRollStep({ ...base, roll: 0.79, goalDotRight: 0.6, speed: 4 }),
    ).toBeCloseTo(0.8);
    expect(
      strafeRollStep({
        ...base,
        maxBank: 0.3,
        roll: 0.29,
        goalDotRight: 0.6,
        speed: 4,
      }),
    ).toBeCloseTo(0.3);
  });

  /** `spd.w > 1.5f` (line 190). */
  it("only levels the wings at or under 1.5 elmos a frame", () => {
    expect(
      strafeRollStep({ ...base, roll: 0.1, goalDotRight: 0.6, speed: 1.5 }),
    ).toBeCloseTo(0.1 - 0.015 * 1.5);
  });
});

describe("banking in a drive", () => {
  const options = {
    start: 15,
    frames: PREVIEW_FRAMES,
    ground: null,
    tilts: false,
    minScriptChangeHeading: 1,
  };
  const flier = (movement: object) => ({
    ...newProject({
      id: "p",
      rootPieceId: "root",
      name: "Flier",
      packId: "lego",
      packVersion: "1",
      now: "2026-10-18T00:00:00Z",
    }),
    movement: { moveClass: "", speed: 150, turnRate: 600, ...movement },
  });

  function run(motion: DriveMotion, path: "bend" | "circle" | "straight") {
    return driveAlong(pathPoints(path, motion, []), motion, options);
  }

  it("rolls a plane into a right turn and not on a straight line", () => {
    const { motion } = driveMotion(
      flier({ flies: "plane", speed: 240 }) as never,
    );
    const bend = run(motion, "bend").frames.map((f) => f.bank ?? 0);
    expect(Math.max(...bend)).toBeGreaterThan(0.1);
    expect(Math.min(...bend)).toBeGreaterThan(-1e-9);
    // Never past maxBank, as the sine of the angle.
    expect(Math.max(...bend)).toBeLessThanOrEqual(Math.asin(0.8) + 1e-9);
    expect(
      run(motion, "straight").frames.every((f) => (f.bank ?? 0) === 0),
    ).toBe(true);
  });

  it("rolls a plane left on a circle to the left", () => {
    const { motion } = driveMotion(
      flier({ flies: "plane", speed: 240 }) as never,
    );
    const circle = run(motion, "circle").frames.map((f) => f.bank ?? 0);
    expect(Math.min(...circle)).toBeLessThan(-0.05);
  });

  it("uses a plane's maxBank", () => {
    const { motion } = driveMotion(
      flier({ flies: "plane", speed: 240, maxBank: 0.1 }) as never,
    );
    const peak = Math.max(
      ...run(motion, "bend").frames.map((f) => f.bank ?? 0),
    );
    expect(peak).toBeLessThanOrEqual(Math.asin(0.1) + 1e-9);
    expect(peak).toBeGreaterThan(0.05);
  });

  it("banks a gunship into a turn, and not with banking off", () => {
    const on = driveMotion(
      flier({ flies: "gunship", acceleration: 0.2 }) as never,
    ).motion;
    const off = driveMotion(
      flier({
        flies: "gunship",
        acceleration: 0.2,
        bankingAllowed: false,
      }) as never,
    ).motion;
    const banked = run(on, "bend").frames.map((f) => f.bank ?? 0);
    expect(Math.max(...banked)).toBeGreaterThan(0.01);
    expect(run(off, "bend").frames.every((f) => (f.bank ?? 0) === 0)).toBe(
      true,
    );
  });

  /** Ground units are left exactly as they were: frames carry no `bank`. */
  it("adds nothing to a ground unit's frames", () => {
    const ground = {
      ...flier({ moveClass: "TANK2" }),
      movement: { moveClass: "TANK2", speed: 60, turnRate: 600 },
    };
    const { motion } = driveMotion(ground as never);
    expect(motion).not.toHaveProperty("flight");
    for (const frame of run(motion, "bend").frames)
      expect(frame).not.toHaveProperty("bank");
  });
});
