import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";

import { BODY_PLANS, bodyPlanById } from "./bodyPlans";
import {
  GENERATOR_JOBS,
  type GeneratorInputs,
  type GeneratorJob,
  type GeneratorSize,
  generateUnit,
} from "./generate";
import {
  generateCheckedUnit,
  generatorFaults,
  nextSeed,
  repairCandidate,
} from "./generateChecked";
import { type LegoPackManifest, type LoadedPack, mergePacks } from "./pack";
import { starterModules } from "./starterModules";

/** The bundled parts with their geometry, which every check measures. */
function bundledPack(): LoadedPack {
  const dir = fileURLToPath(
    new URL("../../src-tauri/legoparts/", import.meta.url),
  );
  const manifest = JSON.parse(
    readFileSync(`${dir}pack.json`, "utf8"),
  ) as LegoPackManifest;
  const blob = new Uint8Array(gunzipSync(readFileSync(`${dir}parts.bin.gz`)));
  const view = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);
  const vertexOffset = view.getUint32(16, true);
  const vertexBytes = view.getUint32(20, true);
  const indexOffset = view.getUint32(24, true);
  const indexBytes = view.getUint32(28, true);
  const vertices = new Float32Array(
    blob.slice(vertexOffset, vertexOffset + vertexBytes).buffer,
  );
  const indices = new Uint16Array(
    blob.slice(indexOffset, indexOffset + indexBytes).buffer,
  );
  const merged = mergePacks([{ manifest, vertices, indices }]);
  return {
    ...merged,
    vertices,
    indices,
    library: { packs: [manifest], atlases: [], dir: "", problems: [] },
  };
}

const pack = bundledPack();
const modules = starterModules(pack);
const options = {
  id: "unit",
  rootPieceId: "root",
  now: "2026-11-07T00:00:00.000Z",
  pack,
  modules,
};

function inputs(
  seed: number,
  planId: string,
  job: GeneratorJob,
  size: GeneratorSize,
): GeneratorInputs {
  const plan = bodyPlanById(planId);
  if (!plan) throw new Error(`no plan ${planId}`);
  return { seed, plan, job, size };
}

const EVERY = BODY_PLANS.flatMap((plan) =>
  GENERATOR_JOBS.flatMap((job) =>
    (["small", "large"] as const).map((size) => ({
      plan: plan.id,
      job: job.id,
      size,
    })),
  ),
);

describe("generateCheckedUnit", () => {
  it("gives a unit that passes every check for every plan, job and two sizes", () => {
    for (const { plan, job, size } of EVERY) {
      for (const seed of [1, 2, 3]) {
        const label = `${plan} ${job} ${size} ${seed}`;
        const result = generateCheckedUnit(
          inputs(seed, plan, job, size),
          options,
        );
        expect(result.status, label).toBe("ok");
        if (result.status !== "ok") continue;
        expect(generatorFaults(result.unit, pack), label).toEqual([]);
        expect(result.unit.generated?.seed, label).toBe(result.seed);
      }
    }
  }, 60_000);

  it("gives the same unit again from the seed the unit records", () => {
    const first = generateCheckedUnit(
      inputs(1, "biped", "antiair", "medium"),
      options,
    );
    if (first.status !== "ok") throw new Error(first.message);
    // Seed 1 of this input would tip, so the unit came from a later seed.
    expect(first.seed).toBeGreaterThan(1);
    const again = generateCheckedUnit(
      inputs(first.seed, "biped", "antiair", "medium"),
      options,
    );
    expect(again).toEqual({ ...first, tries: 1 });
  });

  it("says which check failed when no seed passes", () => {
    const result = generateCheckedUnit(
      inputs(1, "biped", "antiair", "medium"),
      options,
      1,
    );
    expect(result.status).toBe("failed");
    if (result.status !== "failed") return;
    expect(result).toMatchObject({
      first: 1,
      last: 1,
      tries: 1,
      check: "balance",
      counts: { ground: 0, balance: 1, footprint: 0, overlap: 0 },
    });
    expect(result.problem.source).toBe("balance");
    expect(result.message).toBe(
      `No seed from 1 to 1 made a unit that passes the checks. The Balance check failed most often. The first time, it said: ${result.problem.message}`,
    );
  });

  it("names the seeds it tried", () => {
    // Seeds 1 to 3 of this input all tip, measured when the try count was set.
    const result = generateCheckedUnit(
      inputs(1, "biped", "antiair", "medium"),
      options,
      3,
    );
    expect(result).toMatchObject({ status: "failed", first: 1, last: 3 });
  });

  it("refuses fewer than one try, or a count that is not whole", () => {
    for (const tries of [0, 1.5, Number.POSITIVE_INFINITY, Number.NaN]) {
      expect(() =>
        generateCheckedUnit(
          inputs(1, "biped", "scout", "small"),
          options,
          tries,
        ),
      ).toThrow();
    }
  });

  // The same reason as the generator's own test (#5113): a check that came out
  // differently in the Windows app would pick a different seed there.
  it("calls no maths function the engines disagree on", () => {
    const names = [
      "sin",
      "cos",
      "tan",
      "asin",
      "acos",
      "atan",
      "atan2",
      "sinh",
      "cosh",
      "tanh",
      "asinh",
      "acosh",
      "atanh",
      "log",
      "log2",
      "log10",
      "log1p",
      "exp",
      "expm1",
      "pow",
      "hypot",
      "cbrt",
    ] as const;
    const originals = new Map<string, unknown>();
    for (const name of names) {
      originals.set(name, Math[name]);
      Object.defineProperty(Math, name, {
        configurable: true,
        writable: true,
        value: () => {
          throw new Error(`generateCheckedUnit called Math.${name}`);
        },
      });
    }
    try {
      for (const { plan, job, size } of EVERY) {
        generateCheckedUnit(inputs(1, plan, job, size), options);
      }
    } finally {
      for (const name of names) {
        Object.defineProperty(Math, name, {
          configurable: true,
          writable: true,
          value: originals.get(name),
        });
      }
    }
  }, 60_000);
});

describe("repairCandidate", () => {
  it("puts a floating unit on the ground", () => {
    const raw = generateUnit(inputs(1, "wheeled", "scout", "medium"), options);
    expect(
      generatorFaults(raw, pack).filter((f) => f.check === "ground"),
    ).not.toEqual([]);
    const repaired = repairCandidate(raw, pack);
    expect(
      generatorFaults(repaired, pack).filter((f) => f.check === "ground"),
    ).toEqual([]);
    // Only the root moved.
    expect(
      repaired.pieces.filter((p) => p.id !== repaired.rootPieceId),
    ).toEqual(raw.pieces.filter((p) => p.id !== raw.rootPieceId));
  });

  it("centres a unit that sticks out of its footprint", () => {
    const raw = generateUnit(inputs(1, "biped", "assault", "large"), options);
    expect(
      generatorFaults(raw, pack).filter((f) => f.check === "footprint"),
    ).not.toEqual([]);
    const repaired = repairCandidate(raw, pack);
    expect(
      generatorFaults(repaired, pack).filter((f) => f.check === "footprint"),
    ).toEqual([]);
  });

  it("removes a buried covering part and its record", () => {
    const raw = generateUnit(inputs(1, "biped", "assault", "small"), options);
    const buried = generatorFaults(raw, pack).filter(
      (f) => f.check === "overlap",
    );
    expect(buried).not.toEqual([]);
    const repaired = repairCandidate(raw, pack);
    expect(
      generatorFaults(repaired, pack).filter((f) => f.check === "overlap"),
    ).toEqual([]);
    const gone = raw.pieces
      .filter((p) => !repaired.pieces.some((q) => q.id === p.id))
      .map((p) => p.id);
    expect(gone.length).toBeGreaterThan(0);
    for (const id of gone) {
      expect(raw.generated?.covering?.some((c) => c.piece === id)).toBe(true);
      expect(repaired.generated?.covering?.some((c) => c.piece === id)).toBe(
        false,
      );
    }
  });

  it("leaves a unit that would tip as it is for the next seed", () => {
    const raw = generateUnit(inputs(1, "biped", "antiair", "medium"), options);
    expect(
      generatorFaults(repairCandidate(raw, pack), pack).map((f) => f.check),
    ).toContain("balance");
  });
});

describe("nextSeed", () => {
  it("counts up, and wraps round past the largest safe seed", () => {
    expect(nextSeed(41)).toBe(42);
    expect(nextSeed(-1)).toBe(0);
    expect(nextSeed(Number.MAX_SAFE_INTEGER)).toBe(Number.MIN_SAFE_INTEGER);
  });
});
