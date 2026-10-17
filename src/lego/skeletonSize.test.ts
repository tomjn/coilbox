import { describe, expect, it } from "vitest";
import {
  BIPED,
  BODY_PLANS,
  type BodyPlan,
  planProportions,
  QUADRUPED,
} from "./bodyPlans";
import { BUILDING, TURRET_BUILDING } from "./buildingPlans";
import type { LegoProject, SkeletonTarget } from "./model";
import {
  applyTarget,
  currentTarget,
  defaultTarget,
  describeSize,
  fitProportions,
  overTarget,
  projectFromTarget,
  skeletonSize,
} from "./skeletonSize";
import { ELMOS_PER_FOOTPRINT } from "./unitDef";
import { TRACKED, WHEELED } from "./vehiclePlans";

const STEP = ELMOS_PER_FOOTPRINT;

function target(x: number, z: number, height: number): SkeletonTarget {
  return { footprint: { x, z }, height };
}

function options() {
  let n = 0;
  return {
    id: "u",
    rootPieceId: "root",
    name: "Unit",
    packId: "p",
    packVersion: "1",
    now: "2026-01-01T00:00:00.000Z",
    newId: () => `piece-${++n}`,
  };
}

function fitted(plan: BodyPlan, goal: SkeletonTarget) {
  const values = fitProportions(plan, planProportions(plan), goal);
  return { values, size: skeletonSize(plan, values, goal) };
}

describe("skeletonSize", () => {
  it("measures a biped by stance and leg plus body height, square on the ground", () => {
    const size = skeletonSize(BIPED, {
      stance: 30,
      legLength: 20,
      bodyHeight: 5,
    });
    expect(size).toEqual({ x: 30, z: 30, height: 25 });
  });

  it("measures a quadruped by stance and body length", () => {
    const size = skeletonSize(QUADRUPED, {
      stance: 30,
      bodyLength: 50,
      legLength: 20,
      bodyHeight: 5,
    });
    expect(size).toEqual({ x: 30, z: 50, height: 25 });
  });

  it("measures a wheeled unit by track width, the axles' span and wheel height", () => {
    const size = skeletonSize(WHEELED, {
      axles: 3,
      axleSpacing: 20,
      trackWidth: 28,
      wheelHeight: 5,
    });
    expect(size).toEqual({ x: 28, z: 40, height: 5 });
  });

  it("measures a tracked unit by track width, length and height", () => {
    const size = skeletonSize(TRACKED, {
      trackLength: 47,
      trackWidth: 18,
      trackHeight: 9,
      roadWheels: 6,
    });
    expect(size).toEqual({ x: 18, z: 47, height: 9 });
  });

  it("takes a building's width and depth from the target, since no joint places them", () => {
    const goal = target(4, 3, 40);
    expect(
      skeletonSize(TURRET_BUILDING, planProportions(TURRET_BUILDING), goal),
    ).toMatchObject({ x: 4 * STEP, z: 3 * STEP });
    expect(skeletonSize(BUILDING, {}, goal)).toEqual({
      x: 4 * STEP,
      z: 3 * STEP,
      height: 40,
    });
  });

  it("leaves a building's axes unknown without a target", () => {
    expect(skeletonSize(BUILDING, {})).toEqual({
      x: null,
      z: null,
      height: null,
    });
  });
});

describe("fitProportions", () => {
  it("fits a quadruped's stance and body length to the footprint and splits the height", () => {
    const { size } = fitted(QUADRUPED, target(3, 4, 40));
    expect(size.x).toBeCloseTo(3 * STEP);
    expect(size.z).toBeCloseTo(4 * STEP);
    expect(size.height).toBeCloseTo(40);
  });

  it("keeps the leg to body proportion when it splits the height", () => {
    const before = planProportions(BIPED);
    const { values } = fitted(BIPED, target(2, 2, 40));
    expect(values.legLength / values.bodyHeight).toBeCloseTo(
      before.legLength / before.bodyHeight,
    );
  });

  it("fits a square footprint inside the smaller axis for a plan that is square", () => {
    const { size } = fitted(BIPED, target(3, 2, 30));
    expect(size.x).toBeCloseTo(2 * STEP);
    expect(size.z).toBeCloseTo(2 * STEP);
  });

  it("spreads the length over the axles and keeps their number", () => {
    const { values, size } = fitted(WHEELED, target(2, 4, 6));
    expect(values.axles).toBe(planProportions(WHEELED).axles);
    expect(size.z).toBeCloseTo(4 * STEP);
    expect(size.x).toBeCloseTo(2 * STEP);
    expect(size.height).toBeCloseTo(6);
  });

  it("fits a tracked unit", () => {
    const { size } = fitted(TRACKED, target(1, 3, 10));
    expect(size.x).toBeCloseTo(STEP);
    expect(size.z).toBeCloseTo(3 * STEP);
    expect(size.height).toBeCloseTo(10);
  });

  it("splits a turret building's height between the base and the turret", () => {
    const { values, size } = fitted(TURRET_BUILDING, target(4, 4, 80));
    expect(size.height).toBeCloseTo(80);
    expect(values.baseHeight).toBeGreaterThan(
      planProportions(TURRET_BUILDING).baseHeight,
    );
  });

  it("holds to each proportion's range and reports the size that results", () => {
    const { values, size } = fitted(BIPED, target(30, 30, 500));
    const range = BIPED.proportions.find((p) => p.id === "stance");
    expect(values.stance).toBe(range?.max);
    expect(size.x).toBe(range?.max);
    expect(size.height).toBeLessThan(500);
  });

  it("gives the leftover height to the part that has room when one is held", () => {
    // A body height of 0 to 25 and a leg of 5 to 40 cannot hold 65 together
    // in the usual proportion without one passing its range.
    const { values, size } = fitted(BIPED, target(2, 2, 64));
    const bodyMax =
      BIPED.proportions.find((p) => p.id === "bodyHeight")?.max ?? 0;
    expect(values.bodyHeight).toBeLessThanOrEqual(bodyMax);
    expect(size.height).toBeCloseTo(64);
  });

  it("leaves a plan with no proportion alone", () => {
    expect(fitProportions(BUILDING, {}, target(9, 9, 30))).toEqual({});
  });
});

describe("defaultTarget", () => {
  it("is the footprint and height of the plan's default proportions", () => {
    const biped = defaultTarget(BIPED);
    const size = skeletonSize(BIPED, planProportions(BIPED));
    expect(biped.footprint.x).toBe(Math.ceil((size.x as number) / STEP));
    expect(biped.height).toBeCloseTo(size.height as number, 0);
  });

  it("uses the measured medians for the buildings: 4 by 4 and 9 by 9", () => {
    expect(defaultTarget(TURRET_BUILDING).footprint).toEqual({ x: 4, z: 4 });
    expect(defaultTarget(BUILDING).footprint).toEqual({ x: 9, z: 9 });
  });

  it("is whole footprint steps and a positive height for every plan", () => {
    for (const plan of BODY_PLANS) {
      const { footprint, height } = defaultTarget(plan);
      expect(Number.isInteger(footprint.x)).toBe(true);
      expect(Number.isInteger(footprint.z)).toBe(true);
      expect(footprint.x).toBeGreaterThanOrEqual(1);
      expect(footprint.z).toBeGreaterThanOrEqual(1);
      expect(height).toBeGreaterThan(0);
    }
  });

  it("fits every plan to its own default target without moving it past the target", () => {
    for (const plan of BODY_PLANS) {
      const goal = defaultTarget(plan);
      const { size } = fitted(plan, goal);
      expect(overTarget(size, goal)).toEqual([]);
    }
  });
});

describe("currentTarget", () => {
  it("is the steps and height the skeleton measures now", () => {
    expect(
      currentTarget(WHEELED, {
        axles: 3,
        axleSpacing: 20,
        trackWidth: 28,
        wheelHeight: 5,
      }),
    ).toEqual(target(2, 3, 5));
  });

  it("takes the plan's default for an axis it cannot measure", () => {
    expect(currentTarget(BUILDING, {})).toEqual(defaultTarget(BUILDING));
  });
});

describe("describeSize", () => {
  it("states steps, elmos and height", () => {
    expect(describeSize({ x: 48, z: 80, height: 40 })).toBe(
      "3 by 5 steps (48 by 80 elmos), 40 elmos tall",
    );
  });

  it("rounds a measure to a tenth of an elmo", () => {
    expect(describeSize({ x: 47.96, z: 16, height: 12.34 })).toBe(
      "3 by 1 steps (48 by 16 elmos), 12.3 elmos tall",
    );
  });

  it("says only what it knows", () => {
    expect(describeSize({ x: null, z: null, height: 20 })).toBe(
      "20 elmos tall",
    );
    expect(describeSize({ x: null, z: null, height: null })).toBe("");
  });
});

describe("overTarget", () => {
  const goal = target(3, 5, 40);

  it("is empty inside the target, and on its edge", () => {
    expect(overTarget({ x: 48, z: 80, height: 40 }, goal)).toEqual([]);
  });

  it("names each axis past the target", () => {
    expect(overTarget({ x: 49, z: 81, height: 41 }, goal)).toEqual([
      "x",
      "z",
      "height",
    ]);
  });

  it("ignores a float error at the edge", () => {
    expect(overTarget({ x: 48 + 1e-9, z: 80, height: 40 }, goal)).toEqual([]);
  });
});

describe("projectFromTarget", () => {
  it("makes the unit at the fitted size and stores the target", () => {
    const goal = target(3, 4, 40);
    const project = projectFromTarget(QUADRUPED, goal, options());
    expect(project.skeleton?.target).toEqual(goal);
    const size = skeletonSize(
      QUADRUPED,
      project.skeleton?.proportions ?? {},
      goal,
    );
    expect(size.x).toBeCloseTo(3 * STEP);
    expect(size.z).toBeCloseTo(4 * STEP);
    expect(size.height).toBeCloseTo(40);
  });

  it("places the bones with the fitted proportions", () => {
    const project = projectFromTarget(BIPED, target(2, 2, 40), options());
    const thigh = project.pieces.find((p) => p.bone === "thigh.l1");
    expect(thigh?.position[0]).toBeCloseTo(STEP);
  });
});

describe("applyTarget", () => {
  function unit(plan: BodyPlan): LegoProject {
    return projectFromTarget(plan, defaultTarget(plan), options());
  }

  it("refits the proportions and stores the new target in one step", () => {
    let n = 0;
    const next = applyTarget(
      unit(WHEELED),
      WHEELED,
      target(3, 4, 8),
      () => `n${++n}`,
    );
    expect(next.skeleton?.target).toEqual(target(3, 4, 8));
    const size = skeletonSize(WHEELED, next.skeleton?.proportions ?? {});
    expect(size.z).toBeCloseTo(4 * STEP);
    const wheel = next.pieces.find((p) => p.bone === "wheel.l1");
    expect(wheel?.position[0]).toBeCloseTo((3 * STEP) / 2);
  });

  it("stores the target of a plan with no proportion to move", () => {
    const next = applyTarget(
      unit(BUILDING),
      BUILDING,
      target(6, 7, 33),
      () => "x",
    );
    expect(next.skeleton?.target).toEqual(target(6, 7, 33));
  });

  it("returns a unit with no skeleton as it was", () => {
    const bare: LegoProject = { ...unit(BIPED), skeleton: undefined };
    expect(applyTarget(bare, BIPED, target(2, 2, 30), () => "x")).toBe(bare);
  });
});
