import { describe, expect, it } from "vitest";

import { BODY_PLANS, bodyPlanById } from "./bodyPlans";
import { hasFlatFloor, sortedSizes } from "./covering";
import { GENERATOR_JOBS, generateUnit } from "./generate";
import { generatorFaults, repairCandidate } from "./generateChecked";
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
  // 2.82, 2.08, 2.96 and 2.91. The lowest of every other plan and job is 2.80
  // (ship artillery), so 2 is over the old scouts and under every unit now.
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

describe("a scout's deck", () => {
  it("has a flat floor only where the part has one", () => {
    // The 6.5x3x0.5 plate's underside is a ramp, the 4x4x0.5 plate's a wedge.
    const flat = (id: string) => {
      const part = pack.byId.get(id);
      if (!part) throw new Error(`no part ${id}`);
      return hasFlatFloor(pack, part, 1, -1);
    };
    expect(flat("8b08e679beaa")).toBe(false);
    expect(flat("1b4e92ac3e9a")).toBe(false);
    expect(
      pack.parts.some(
        (p) =>
          p.shape === "plate" &&
          ([1, -1] as const).some((down) =>
            hasFlatFloor(pack, p, sortedSizes(p)[2]?.axis ?? 1, down),
          ),
      ),
    ).toBe(true);
  });

  for (const planId of ["turret.building", "building", "aircraft", "ship"]) {
    it(`leaves a scout on the ${planId} plan balanced at every size`, () => {
      const plan = bodyPlanById(planId);
      if (!plan) throw new Error(`no plan ${planId}`);
      for (const size of ["small", "medium", "large"] as const) {
        for (let seed = 1; seed <= 20; seed++) {
          const unit = repairCandidate(
            generateUnit(
              { seed, plan, job: "scout", size },
              {
                id: "unit",
                rootPieceId: "root",
                now: "2026-11-08T00:00:00.000Z",
                pack,
                modules,
              },
            ),
            pack,
          );
          expect(
            generatorFaults(unit, pack).map((f) => f.check),
            `${size} ${seed}`,
          ).toEqual([]);
        }
      }
    });
  }
});
