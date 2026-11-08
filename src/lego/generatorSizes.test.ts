import { describe, expect, it } from "vitest";

import { BODY_PLANS, bodyPlanById } from "./bodyPlans";
import { GENERATOR_JOBS, generateUnit } from "./generate";
import { generateRoster, unitVolume } from "./roster";
import { starterModules } from "./starterModules";
import { bundledPack } from "./testPack";

const pack = bundledPack();
const modules = starterModules(pack);
const SEEDS = [1, 2, 3, 4];

function volume(
  planId: string,
  job: string,
  size: "small" | "large",
  seed: number,
): number {
  const plan = bodyPlanById(planId);
  if (!plan) throw new Error(`no plan ${planId}`);
  const unit = generateUnit(
    { seed, plan, job, size },
    {
      id: "unit",
      rootPieceId: "root",
      now: "2026-11-08T00:00:00.000Z",
      pack,
      modules,
    },
  );
  return unitVolume(unit, pack);
}

describe("a generated unit's size", () => {
  // Large over small, summed over seeds 1 to 4 so one seed's roll of the
  // chassis share does not decide it. Before #5136 a scout on the aircraft,
  // turret building, building and ship plans measured 0.79, 0.93, 0.98 and
  // 1.68, and every other plan and job 2.48 or more. Those four now measure
  // 2.55, 2.96, 3.50 and 3.43 and the lowest of all is 2.48 (ship artillery),
  // so 2 is over every unit that did not grow and under every one that does.
  const MIN_GROWTH = 2;

  for (const plan of BODY_PLANS) {
    for (const job of GENERATOR_JOBS) {
      it(`${plan.id} ${job.id}: large is over ${MIN_GROWTH} times small`, () => {
        let small = 0;
        let large = 0;
        for (const seed of SEEDS) {
          small += volume(plan.id, job.id, "small", seed);
          large += volume(plan.id, job.id, "large", seed);
        }
        expect(large / small).toBeGreaterThan(MIN_GROWTH);
      });
    }
  }
});

describe("a roster with a scout", () => {
  for (const planId of ["turret.building", "building", "aircraft", "ship"]) {
    it(`makes three bigger tiers from seed 1 on the ${planId} plan`, () => {
      const plan = bodyPlanById(planId);
      if (!plan) throw new Error(`no plan ${planId}`);
      let n = 0;
      const result = generateRoster(
        {
          id: "roster-1",
          name: "Scouts",
          seed: 1,
          plans: [plan],
          jobs: ["scout"],
          tiers: 3,
        },
        () => {
          n += 1;
          return {
            id: `unit-${n}`,
            rootPieceId: `root-${n}`,
            now: "2026-11-08T00:00:00.000Z",
            pack,
            modules,
          };
        },
      );
      if (result.status !== "ok") throw new Error(result.message);
      const volumes = result.units.map((u) => unitVolume(u, pack));
      expect(volumes[1]).toBeGreaterThan(volumes[0]);
      expect(volumes[2]).toBeGreaterThan(volumes[1]);
    });
  }
});
