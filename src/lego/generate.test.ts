import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { hashString } from "../conquest/rng";
import { BODY_PLANS, bodyPlanById } from "./bodyPlans";
import {
  GENERATOR_JOBS,
  GENERATOR_SIZES,
  type GeneratorInputs,
  type GeneratorJob,
  type GeneratorSize,
  generateUnit,
} from "./generate";
import {
  type LegoProject,
  parseLegoProjectJson,
  projectProblems,
} from "./model";
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

function loaded(): LoadedPack {
  const merged = mergePacks([
    {
      manifest: bundled,
      vertices: new Float32Array(),
      indices: new Uint16Array(),
    },
  ]);
  return {
    ...merged,
    library: { packs: [bundled], atlases: [], dir: "", problems: [] },
  };
}

const pack = loaded();
const modules = starterModules(pack);

function generate(
  seed: number,
  planId: string,
  job: GeneratorJob,
  size: GeneratorSize,
): LegoProject {
  const plan = bodyPlanById(planId);
  if (!plan) throw new Error(`no plan ${planId}`);
  const inputs: GeneratorInputs = { seed, plan, job, size };
  return generateUnit(inputs, {
    id: "unit",
    rootPieceId: "root",
    now: "2026-11-07T00:00:00.000Z",
    pack,
    modules,
  });
}

const JOBS = GENERATOR_JOBS.map((job) => job.id);
const EVERY = BODY_PLANS.flatMap((plan) =>
  JOBS.flatMap((job) =>
    (["small", "large"] as const).map((size) => ({ plan: plan.id, job, size })),
  ),
);

/** What a stored unit is compared on: enough to read a change off the diff,
 *  and a hash of the whole document so nothing else can move unseen. */
function summary(unit: LegoProject) {
  return {
    pieces: unit.pieces.length,
    modules: unit.generated?.modules.map((m) => `${m.slot}=${m.module}`),
    proportions: unit.skeleton?.proportions,
    hash: hashString(JSON.stringify(unit)),
  };
}

describe("generateUnit", () => {
  it("matches the stored units for every plan, job and two sizes", async () => {
    const table = Object.fromEntries(
      EVERY.map(({ plan, job, size }) => [
        `${plan} ${job} ${size}`,
        summary(generate(1, plan, job, size)),
      ]),
    );
    await expect(`${JSON.stringify(table, null, 2)}\n`).toMatchFileSnapshot(
      "fixtures/generated/summary.json",
    );
  });

  it("matches stored documents in full", async () => {
    for (const [seed, plan, job, size] of [
      [1, "biped", "assault", "medium"],
      [7, "wheeled", "builder", "small"],
      [3, "ship", "antiair", "large"],
    ] as const) {
      await expect(
        `${JSON.stringify(generate(seed, plan, job, size), null, 2)}\n`,
      ).toMatchFileSnapshot(
        `fixtures/generated/${plan}-${job}-${size}-${seed}.json`,
      );
    }
  });

  it("gives the same document for the same inputs", () => {
    for (const { plan, job, size } of EVERY) {
      expect(JSON.stringify(generate(42, plan, job, size))).toBe(
        JSON.stringify(generate(42, plan, job, size)),
      );
    }
  });

  it("gives a different unit for a different seed", () => {
    for (const { plan, job, size } of EVERY) {
      expect(JSON.stringify(generate(1, plan, job, size))).not.toBe(
        JSON.stringify(generate(2, plan, job, size)),
      );
    }
  });

  it("does not depend on the order the library lists modules in", () => {
    const plan = bodyPlanById("quadruped");
    if (!plan) throw new Error("no quadruped");
    const options = {
      id: "unit",
      rootPieceId: "root",
      now: "2026-11-07T00:00:00.000Z",
      pack,
    };
    const inputs: GeneratorInputs = {
      seed: 5,
      plan,
      job: "scout",
      size: "medium",
    };
    expect(
      generateUnit(inputs, { ...options, modules: [...modules].reverse() }),
    ).toEqual(generateUnit(inputs, { ...options, modules }));
  });

  it("makes units with no document problems", () => {
    for (const { plan, job, size } of EVERY) {
      for (const seed of [1, 2, 3]) {
        const unit = generate(seed, plan, job, size);
        expect(projectProblems(unit), `${plan} ${job} ${size} ${seed}`).toEqual(
          [],
        );
      }
    }
  });

  it("hangs every slot's module on the unit, and records its instance", () => {
    for (const { plan, job, size } of EVERY) {
      const unit = generate(1, plan, job, size);
      const record = unit.generated;
      expect(record).toMatchObject({ seed: 1, plan, job, size });
      expect(record?.modules[0]?.slot).toBe("chassis.1");
      for (const entry of record?.modules ?? []) {
        const pieces = unit.pieces.filter(
          (p) => p.module?.instance === entry.instance,
        );
        expect(pieces.length).toBeGreaterThan(0);
        expect(pieces.every((p) => p.module?.id === entry.module)).toBe(true);
      }
    }
  });

  it("gives a builder a build arm and an assault unit a turret", () => {
    const builder = generate(1, "biped", "builder", "medium");
    expect(builder.pieces.some((p) => p.role?.startsWith("buildarm."))).toBe(
      true,
    );
    const assault = generate(1, "wheeled", "assault", "medium");
    expect(assault.pieces.some((p) => p.role === "turret")).toBe(true);
  });

  it("makes a large unit bigger than a small one", () => {
    const small = generate(1, "biped", "assault", "small");
    const large = generate(1, "biped", "assault", "large");
    expect(large.skeleton?.proportions.legLength).toBeGreaterThan(
      small.skeleton?.proportions.legLength as number,
    );
  });

  it("says in the notes which inputs made it, and keeps them on a reload", () => {
    const unit = generate(9, "hexapod", "artillery", "large");
    expect(unit.notes).toBe(
      "Generated from seed 9, body plan Six legs, job Artillery, size Large.",
    );
    expect(parseLegoProjectJson(JSON.stringify(unit))?.generated).toEqual(
      unit.generated,
    );
  });

  it("refuses a job or size it does not know", () => {
    expect(() =>
      generate(1, "biped", "pirate" as GeneratorJob, "small"),
    ).toThrow();
    expect(() =>
      generate(1, "biped", "assault", "huge" as GeneratorSize),
    ).toThrow();
    expect(GENERATOR_SIZES.map((s) => s.id)).toEqual([
      "small",
      "medium",
      "large",
    ]);
  });
});
