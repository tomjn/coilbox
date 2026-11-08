import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";

import { mulberry32 } from "../conquest/rng";
import { type BodyPlan, bodyPlanById } from "./bodyPlans";
import { GENERATOR_JOBS, generateUnit } from "./generate";
import { generateCheckedUnit } from "./generateChecked";
import {
  type GeneratorStyle,
  parseStyle,
  parseStyleFile,
  parseStyles,
  serializeStyleFile,
  skewed,
  withCopy,
} from "./generatorStyle";
import { type LegoProject, parseLegoProjectJson } from "./model";
import { type LegoPackManifest, type LoadedPack, mergePacks } from "./pack";
import { rerollUnit } from "./reroll";
import { starterModules } from "./starterModules";

/** The bundled parts with their geometry, which the checks measure. */
function loaded(): LoadedPack {
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

const pack = loaded();
const modules = starterModules(pack);
const SEEDS = Array.from({ length: 12 }, (_, i) => i + 1);

function generate(
  seed: number,
  planId: string,
  job: string,
  style?: GeneratorStyle,
): LegoProject {
  const plan = bodyPlanById(planId);
  if (!plan) throw new Error(`no plan ${planId}`);
  return generateUnit(
    { seed, plan, job, size: "medium" },
    {
      id: "unit",
      rootPieceId: "root",
      now: "2026-11-08T00:00:00.000Z",
      pack,
      modules,
      ...(style ? { style } : {}),
    },
  );
}

function style(fields: Partial<GeneratorStyle>): GeneratorStyle {
  return { id: "s", name: "Style", shapes: [], ...fields };
}

const colourOf = (unit: LegoProject) =>
  unit.pieces.flatMap((p) =>
    p.partId ? [pack.byId.get(p.partId)?.colourway] : [],
  );

/** A part's shape and size. Two colourways of one shape can be different
 *  meshes of the same box, so the mesh id is not compared. */
const shapeAndSize = (partId: string) => {
  const part = pack.byId.get(partId);
  return part && `${part.shape} ${JSON.stringify(part.bbox)}`;
};

/** The shape and size of every part but the covering's, which is chosen
 *  afresh from the colourway's own parts. */
const shapesOf = (unit: LegoProject) => {
  const covering = new Set(unit.generated?.covering?.map((c) => c.piece));
  return unit.pieces.flatMap((p) =>
    p.partId && !covering.has(p.id) ? [shapeAndSize(p.partId)] : [],
  );
};

const coveringShapes = (unit: LegoProject) =>
  (unit.generated?.covering ?? []).map((c) => {
    const partId = unit.pieces.find((p) => p.id === c.piece)?.partId;
    return partId ? pack.byId.get(partId)?.shape : undefined;
  });

const mean = (values: number[]) =>
  values.reduce((a, b) => a + b, 0) / values.length;

describe("skewed", () => {
  it("pushes rolls towards one end and keeps them between 0 and 1", () => {
    const sample = (lean: "high" | "low" | undefined) =>
      Array.from({ length: 2000 }, skewed(mulberry32(5), lean));
    for (const lean of ["high", "low", undefined] as const) {
      for (const u of sample(lean)) {
        expect(u).toBeGreaterThanOrEqual(0);
        expect(u).toBeLessThan(1);
      }
    }
    expect(mean(sample("low"))).toBeLessThan(mean(sample(undefined)));
    expect(mean(sample("high"))).toBeGreaterThan(mean(sample(undefined)));
  });

  it("is the same PRNG when nothing is pushed", () => {
    const rng = mulberry32(1);
    expect(skewed(rng, undefined)).toBe(rng);
  });
});

describe("a style on the generator", () => {
  it("leaves the unit as it was with no style", () => {
    const unit = generate(1, "biped", "assault");
    expect(unit.generated?.style).toBeUndefined();
    // The stored units in fixtures/generated prove the rest: generate.test.ts
    // compares them without a style.
  });

  it("colours every part in the style's colourway", () => {
    for (const plan of ["biped", "wheeled", "tracked"]) {
      for (const seed of SEEDS.slice(0, 4)) {
        const plain = colourOf(generate(seed, plan, "assault"));
        expect(plain).toContain("grey");
        expect(plain).not.toContain("tan");
        const tan = colourOf(
          generate(seed, plan, "assault", style({ colourway: "tan" })),
        );
        expect(tan.length).toBe(plain.length);
        expect(new Set(tan)).toEqual(new Set(["tan"]));
        // Each module part, wheel and tread is the same shape and size, only in
        // another colour.
        expect(
          shapesOf(
            generate(seed, plan, "assault", style({ colourway: "tan" })),
          ),
        ).toEqual(shapesOf(generate(seed, plan, "assault")));
      }
    }
  });

  it("covers in the preferred shapes where the covering allows them", () => {
    const plain = SEEDS.flatMap((seed) =>
      coveringShapes(generate(seed, "quadruped", "assault")),
    );
    expect(new Set(plain).size).toBeGreaterThan(1);
    const blocks = SEEDS.flatMap((seed) =>
      coveringShapes(
        generate(seed, "quadruped", "assault", style({ shapes: ["block"] })),
      ),
    );
    expect(blocks.length).toBeGreaterThan(0);
    expect(new Set(blocks)).toEqual(new Set(["block"]));
  });

  it("makes a stocky unit shorter and wider than a lean one", () => {
    const stocky = style({ proportions: "stocky" });
    const lean = style({ proportions: "lean" });
    const measure = (s: GeneratorStyle | undefined, id: string) =>
      mean(
        SEEDS.map(
          (seed) =>
            generate(seed, "biped", "assault", s).skeleton?.proportions[
              id
            ] as number,
        ),
      );
    expect(measure(stocky, "legLength")).toBeLessThan(
      measure(undefined, "legLength"),
    );
    expect(measure(lean, "legLength")).toBeGreaterThan(
      measure(undefined, "legLength"),
    );
    expect(measure(stocky, "stance")).toBeGreaterThan(measure(lean, "stance"));
  });

  it("keeps every proportion inside the job's range", () => {
    // Medium is the plan's default size for an assault unit.
    const job = GENERATOR_JOBS.find((j) => j.id === "assault");
    if (!job || job.size.medium !== 1) throw new Error("assault changed");
    let checked = 0;
    for (const planId of ["biped", "quadruped", "tracked", "hover", "ship"]) {
      const plan = bodyPlanById(planId) as BodyPlan;
      for (const rule of job.proportions) {
        const own = plan.proportions.find((p) => p.id === rule.id);
        if (!own || rule.against !== undefined) continue;
        const held = (n: number) => Math.min(own.max, Math.max(own.min, n));
        const low = held(own.fallback * rule.range[0]);
        const high = held(own.fallback * rule.range[1]);
        for (const proportions of ["stocky", "lean"] as const) {
          for (const seed of SEEDS) {
            const value = generate(
              seed,
              planId,
              "assault",
              style({ proportions }),
            ).skeleton?.proportions[rule.id] as number;
            expect(value).toBeGreaterThanOrEqual(low - 1e-9);
            expect(value).toBeLessThanOrEqual(high + 1e-9);
            checked++;
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("covers in another shape when the pack has none of the preferred one", () => {
    const parts = pack.parts.filter((p) => p.shape !== "plate");
    const noPlates: LoadedPack = {
      ...pack,
      parts,
      byId: new Map(parts.map((p) => [p.id, p])),
    };
    const make = (s?: GeneratorStyle) =>
      generateUnit(
        {
          seed: 1,
          plan: bodyPlanById("wheeled") as BodyPlan,
          job: "assault",
          size: "medium",
        },
        {
          id: "unit",
          rootPieceId: "root",
          now: "2026-11-08T00:00:00.000Z",
          pack: noPlates,
          modules,
          ...(s ? { style: s } : {}),
        },
      );
    const plain = make();
    const plates = make(style({ shapes: ["plate"] }));
    expect(plates.generated?.covering?.length).toBeGreaterThan(0);
    expect(plates.pieces).toEqual(plain.pieces);
  });

  it("gives a dense unit more pieces than a sparse one", () => {
    const pieces = (detail: "dense" | "sparse") =>
      mean(
        ["biped", "quadruped", "wheeled", "tracked", "hover"].flatMap((plan) =>
          SEEDS.map(
            (seed) =>
              generate(seed, plan, "assault", style({ detail })).pieces.length,
          ),
        ),
      );
    expect(pieces("dense")).toBeGreaterThan(pieces("sparse"));
  });

  it("gives a scout more weapons when dense than when sparse", () => {
    // A scout's weapon slot is 0 to 1, so the count is a job rule a style
    // only leans on.
    const weapons = (detail: "dense" | "sparse") =>
      SEEDS.filter((seed) =>
        generate(
          seed,
          "biped",
          "scout",
          style({ detail }),
        ).generated?.modules.some((m) => m.slot.startsWith("weapon.")),
      ).length;
    expect(weapons("dense")).toBeGreaterThan(weapons("sparse"));
  });

  it("records the style, and a reroll applies it again", () => {
    const tan = style({ colourway: "tan", detail: "dense" });
    const checked = generateCheckedUnit(
      {
        seed: 3,
        plan: bodyPlanById("wheeled") as BodyPlan,
        job: "assault",
        size: "medium",
      },
      {
        id: "unit",
        rootPieceId: "root",
        now: "2026-11-08T00:00:00.000Z",
        pack,
        modules,
        style: tan,
      },
    );
    if (checked.status !== "ok") throw new Error(checked.message);
    const saved = parseLegoProjectJson(JSON.stringify(checked.unit));
    expect(saved?.generated?.style).toEqual(tan);
    const rerolled = rerollUnit(saved as LegoProject, { pack, modules });
    if (rerolled.status !== "ok") throw new Error(rerolled.message);
    expect(rerolled.unit.generated?.style).toEqual(tan);
    expect(new Set(colourOf(rerolled.unit))).toEqual(new Set(["tan"]));
  });

  it("calls no maths function the engines disagree on (#5113)", () => {
    const names = [
      "sin",
      "cos",
      "atan2",
      "log",
      "pow",
      "hypot",
      "exp",
    ] as const;
    const originals = names.map((name) => Math[name]);
    for (const name of names) {
      Object.defineProperty(Math, name, {
        configurable: true,
        writable: true,
        value: () => {
          throw new Error(`generateUnit called Math.${name}`);
        },
      });
    }
    try {
      for (const plan of ["biped", "tracked", "ship"]) {
        generate(1, plan, "assault", {
          id: "s",
          name: "All",
          colourway: "green",
          shapes: ["plate"],
          proportions: "stocky",
          detail: "dense",
        });
      }
    } finally {
      names.forEach((name, i) => {
        Object.defineProperty(Math, name, {
          configurable: true,
          writable: true,
          value: originals[i],
        });
      });
    }
  });
});

describe("saving styles", () => {
  const full: GeneratorStyle = {
    id: "a",
    name: "Green faction",
    colourway: "green",
    shapes: ["block", "plate"],
    proportions: "lean",
    detail: "sparse",
  };

  it("round trips a style through its file", () => {
    expect(parseStyleFile(serializeStyleFile(full))).toEqual(full);
  });

  it("refuses a file that is not a style", () => {
    expect(parseStyleFile("not json")).toBeNull();
    expect(
      parseStyleFile(JSON.stringify({ kind: "coilbox-module" })),
    ).toBeNull();
    expect(
      parseStyleFile(JSON.stringify({ kind: "coilbox-generator-style" })),
    ).toBeNull();
    // A newer file may mean something this version would get wrong.
    const newer = JSON.parse(serializeStyleFile(full));
    expect(parseStyleFile(JSON.stringify({ ...newer, version: 2 }))).toBeNull();
  });

  it("drops what it does not know and skips what it cannot read", () => {
    expect(
      parseStyle({ ...full, proportions: "round", detail: 3, shapes: "x" }),
    ).toEqual({
      id: "a",
      name: "Green faction",
      colourway: "green",
      shapes: [],
    });
    expect(
      parseStyles([full, { id: "b" }, null, { ...full, id: "c" }]),
    ).toEqual([full, { ...full, id: "c" }]);
    expect(parseStyles("nothing")).toEqual([]);
  });

  it("copies a style under a new id and a free name", () => {
    const once = withCopy([full], full, "b");
    expect(once[1]).toEqual({ ...full, id: "b", name: "Green faction 2" });
    const twice = withCopy(once, full, "c");
    expect(twice[2]?.name).toBe("Green faction 3");
    expect(twice[0]).toBe(full);
  });
});
