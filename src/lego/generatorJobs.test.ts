import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { ROLES } from "./animPresets";
import { BODY_PLANS, bodyPlanById } from "./bodyPlans";
import { pieceOwnBox } from "./connectors";
import { type GeneratorInputs, generateUnit } from "./generate";
import {
  GENERATOR_JOBS,
  GENERATOR_SIZE_IDS,
  type GeneratorJobData,
  jobProblems,
} from "./generatorJobs";
import type { LegoProject } from "./model";
import { type LegoPackManifest, type LoadedPack, mergePacks } from "./pack";
import { starterModules } from "./starterModules";

const bundled = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL("../../src-tauri/legoparts/pack.json", import.meta.url),
    ),
    "utf8",
  ),
) as LegoPackManifest;

const merged = mergePacks([
  {
    manifest: bundled,
    vertices: new Float32Array(),
    indices: new Uint16Array(),
  },
]);
const pack: LoadedPack = {
  ...merged,
  library: { packs: [bundled], atlases: [], dir: "", problems: [] },
};
const library = starterModules(pack);

const ROLE_IDS = ROLES.map((role) => role.id);
const PLAN_PROPORTIONS = [
  ...new Set(BODY_PLANS.flatMap((plan) => plan.proportions.map((p) => p.id))),
];

function problems(job: GeneratorJobData): string[] {
  return jobProblems(job, library, ROLE_IDS, PLAN_PROPORTIONS);
}

function generate(
  seed: number,
  planId: string,
  job: string,
  size: "small" | "medium" | "large",
): LegoProject {
  const plan = bodyPlanById(planId);
  if (!plan) throw new Error(`no plan ${planId}`);
  const inputs: GeneratorInputs = { seed, plan, job, size };
  return generateUnit(inputs, {
    id: "unit",
    rootPieceId: "root",
    now: "2026-11-07T00:00:00.000Z",
    pack,
    modules: library,
  });
}

// The generator's own weapon, not a gun bone the body plan has (a ship does).
const barrel = (unit: LegoProject) =>
  unit.pieces.find((p) => p.role === "barrel" && p.module);
const turret = (unit: LegoProject) =>
  unit.pieces.find((p) => p.role === "turret" && p.module);

describe("the generator's jobs", () => {
  it("defines assault, artillery, scout, builder and anti-air", () => {
    expect(GENERATOR_JOBS.map((job) => job.id)).toEqual([
      "assault",
      "artillery",
      "scout",
      "builder",
      "antiair",
    ]);
  });

  it("names only module categories the library has, with every range min below max", () => {
    for (const job of GENERATOR_JOBS) {
      expect(problems(job), job.id).toEqual([]);
    }
  });

  it("reports a category no module has", () => {
    const [job] = GENERATOR_JOBS as [GeneratorJobData];
    const slots = [
      job.slots[0] as GeneratorJobData["slots"][number],
      { id: "gun", category: "Cannon", count: [1, 1] as [number, number] },
    ];
    expect(problems({ ...job, slots })).toEqual([
      "assault slot gun: no module has the category Cannon",
    ]);
  });

  it("reports a range whose minimum is not below its maximum", () => {
    const [job] = GENERATOR_JOBS as [GeneratorJobData];
    expect(problems({ ...job, bulk: [0.9, 0.9] })).toEqual([
      "assault bulk: a minimum below a maximum",
    ]);
    expect(
      problems({
        ...job,
        proportions: [{ id: "legLength", range: [1.2, 0.8] }],
      }),
    ).toEqual(["assault proportion legLength: a minimum below a maximum"]);
    expect(
      problems({ ...job, size: { small: 1, medium: 1, large: 2 } }),
    ).toEqual(["assault size: small below medium below large"]);
  });

  it("reports a tag, a proportion and a role nothing has", () => {
    const [job] = GENERATOR_JOBS as [GeneratorJobData];
    const [chassis, weapon] = job.slots as [
      GeneratorJobData["slots"][number],
      GeneratorJobData["slots"][number],
    ];
    expect(
      problems({
        ...job,
        proportions: [{ id: "wingspan", range: [0.9, 1.1] }],
        slots: [
          { ...chassis, tags: ["spiky"] },
          { ...weapon, roles: { tail: { stretch: [1, 2] } } },
        ],
      }),
    ).toEqual([
      "assault proportion wingspan: no body plan has it",
      "assault slot chassis: no Chassis module has the tag spiky",
      "assault slot weapon role tail: no such role",
    ]);
  });

  it("refuses a pitch limit on a role that only turns about the vertical", () => {
    const [job] = GENERATOR_JOBS as [GeneratorJobData];
    const weapon = job.slots[1] as GeneratorJobData["slots"][number];
    expect(
      problems({
        ...job,
        slots: [
          job.slots[0] as GeneratorJobData["slots"][number],
          { ...weapon, roles: { turret: { pitch: { min: 0, max: 80 } } } },
        ],
      }),
    ).toEqual([
      "assault slot weapon role turret: a piece with this role cannot be limited in pitch",
    ]);
  });

  it("scales a larger size up in every job", () => {
    for (const job of GENERATOR_JOBS) {
      const [small, medium, large] = GENERATOR_SIZE_IDS.map((s) => job.size[s]);
      expect(small).toBeLessThan(medium as number);
      expect(medium).toBeLessThan(large as number);
    }
  });
});

describe("what each job makes", () => {
  it("gives an assault unit a weapon on a hull section", () => {
    const unit = generate(1, "biped", "assault", "medium");
    expect(turret(unit)).toBeDefined();
    expect(unit.generated?.modules[0]?.module).toMatch(/^builtin\.hull/);
  });

  it("gives an artillery unit one barrel, longer than an assault unit's", () => {
    for (const seed of [1, 2, 3, 4]) {
      const artillery = generate(seed, "wheeled", "artillery", "medium");
      const assault = generate(seed, "wheeled", "assault", "medium");
      expect(
        artillery.pieces.filter((p) => p.role === "barrel" && p.module),
      ).toHaveLength(1);
      expect(barrel(assault)?.scale[1]).toBe(1);
      expect(barrel(artillery)?.scale[1]).toBeGreaterThanOrEqual(2);
      expect(barrel(artillery)?.scale[1]).toBeLessThanOrEqual(3);
    }
  });

  it("keeps the end of a stretched barrel against its turret", () => {
    // In the turret's own space the barrel's near end is its centre less half
    // its length. A stretch moves the centre out by the added half, so the end
    // stays where an unstretched barrel's is.
    const near = (unit: LegoProject) => {
      const b = barrel(unit);
      const box = b && pieceOwnBox(pack, b);
      if (!b || !box) throw new Error("no barrel");
      const length = (box.max[1] - box.min[1]) * b.scale[1];
      return b.position[2] - length / 2;
    };
    const plain = generate(1, "wheeled", "assault", "medium");
    const long = generate(1, "wheeled", "artillery", "medium");
    expect(near(long)).toBeCloseTo(near(plain), 6);
    expect(barrel(long)?.position[2]).toBeGreaterThan(
      barrel(plain)?.position[2] as number,
    );
  });

  it("gives a scout a lighter weapon than an assault unit, or none", () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const scout = generate(seed, "wheeled", "scout", "medium");
      const assault = generate(seed, "wheeled", "assault", "medium");
      const gun = turret(scout);
      if (gun) {
        expect(gun.scale[0]).toBeLessThan(
          (turret(assault)?.scale[0] as number) * 0.7,
        );
      }
    }
  });

  it("makes a scout smaller than an assault unit at the same size", () => {
    const size = (unit: LegoProject) =>
      Object.values(unit.skeleton?.proportions ?? {}).reduce((a, b) => a + b);
    for (const size_ of ["small", "medium", "large"] as const) {
      expect(size(generate(1, "biped", "scout", size_))).toBeLessThan(
        size(generate(1, "biped", "assault", size_)),
      );
    }
  });

  it("gives a builder a build arm with nano emit points", () => {
    const unit = generate(1, "tracked", "builder", "medium");
    expect(unit.pieces.some((p) => p.role === "buildarm.arm")).toBe(true);
    expect(unit.pieces.some((p) => p.role === "buildarm.nano")).toBe(true);
  });

  it("gives an anti-air unit a barrel held to aim from level upward", () => {
    for (const plan of ["biped", "wheeled", "ship"]) {
      const unit = generate(1, plan, "antiair", "medium");
      expect(turret(unit)).toBeDefined();
      expect(barrel(unit)?.limits?.pitch).toEqual({ min: 0, max: 85 });
    }
    expect(
      barrel(generate(1, "wheeled", "assault", "medium"))?.limits,
    ).toBeUndefined();
  });

  it("holds an artillery quadruped's body long against its legs", () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const { bodyLength, legLength } = generate(
        seed,
        "quadruped",
        "artillery",
        "medium",
      ).skeleton?.proportions as Record<string, number>;
      const ratio = (bodyLength as number) / (legLength as number);
      expect(ratio).toBeGreaterThanOrEqual(1.6);
      expect(ratio).toBeLessThanOrEqual(2.2);
    }
  });
});
