import { describe, expect, it } from "vitest";

import { type BodyPlan, bodyPlanById } from "./bodyPlans";
import { generateUnit } from "./generate";
import type { GeneratorStyle } from "./generatorStyle";
import { type LegoPiece, type LegoProject, newProject } from "./model";
import type { LoadedPack } from "./pack";
import { starterModules } from "./starterModules";
import { measureUnit, styleFromUnit } from "./styleFromUnit";
import { bundledPack } from "./testPack";

const pack: LoadedPack = bundledPack();
const modules = starterModules(pack);

function partWhere(colourway: string, shape: string) {
  const part = pack.parts.find(
    (p) => p.colourway === colourway && p.shape === shape,
  );
  if (!part) throw new Error(`no ${colourway} ${shape}`);
  return part.id;
}

/** A unit of parts: a part id and where it sits, one piece each. */
function unitOf(
  parts: { partId: string; at: [number, number, number] }[],
): LegoProject {
  const project = newProject({
    id: "unit",
    rootPieceId: "root",
    name: "Source",
    packId: pack.manifest.id,
    packVersion: pack.manifest.version,
    now: "2026-11-08T00:00:00.000Z",
  });
  const pieces: LegoPiece[] = parts.map(({ partId, at }, i) => ({
    id: `p${i}`,
    name: `part${i}`,
    parentId: "root",
    partId,
    position: at,
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
  }));
  return { ...project, pieces: [...project.pieces, ...pieces] };
}

const green = partWhere("green", "block");
const greenBeam = partWhere("green", "beam");
const greenPlate = partWhere("green", "plate");
const grey = partWhere("grey", "block");
const mixed = pack.parts.find((p) => p.colourway === "mixed")?.id as string;

function ok(project: LegoProject) {
  const result = styleFromUnit(project, pack);
  if (result.status !== "ok") throw new Error(result.message);
  return result.style;
}

type At = [number, number, number];

/** Eight blocks in a column: tall for its footprint. */
const column = unitOf(
  Array.from({ length: 8 }, (_, i) => ({
    partId: green,
    at: [0, i * 12, 0] as At,
  })),
);

/** Thirty six plates in a grid: low for its footprint. */
const slab = unitOf(
  Array.from({ length: 36 }, (_, i) => ({
    partId: greenPlate,
    at: [(i % 6) * 20, 0, Math.floor(i / 6) * 20] as At,
  })),
);

/** The same box twice, with two parts in it and with four hundred and two. */
const corners: At[] = [
  [0, 0, 0],
  [60, 60, 60],
];
const sparseUnit = unitOf(corners.map((at) => ({ partId: green, at })));
const denseUnit = unitOf([
  ...corners.map((at) => ({ partId: green, at })),
  ...Array.from({ length: 400 }, () => ({
    partId: green,
    at: [30, 30, 30] as At,
  })),
]);

describe("a style from a unit built of parts", () => {
  it("records the colourway and shapes the unit uses most", () => {
    const at: [number, number, number] = [0, 0, 0];
    const style = ok(
      unitOf([
        ...Array.from({ length: 5 }, () => ({ partId: green, at })),
        ...Array.from({ length: 4 }, () => ({ partId: greenBeam, at })),
        { partId: greenPlate, at },
        { partId: grey, at },
        { partId: grey, at },
      ]),
    );
    expect(style.colourway).toBe("green");
    // Seven blocks, four beams and one plate: the plate is under half of seven.
    expect(style.shapes).toEqual(["block", "beam"]);
  });

  it("never names the mixed colourway", () => {
    const at: [number, number, number] = [0, 0, 0];
    const style = ok(
      unitOf([
        ...Array.from({ length: 6 }, () => ({ partId: mixed, at })),
        { partId: grey, at },
      ]),
    );
    expect(style.colourway).toBe("grey");
  });

  it("records a tall narrow unit as lean and a low wide one as stocky", () => {
    expect(ok(column).proportions).toBe("lean");
    expect(ok(slab).proportions).toBe("stocky");
  });

  it("compares by shape, not size", () => {
    const column = (scale: number) => {
      const unit = unitOf(
        Array.from({ length: 8 }, (_, i) => ({
          partId: green,
          at: [0, i * 12 * scale, 0] as [number, number, number],
        })),
      );
      return {
        ...unit,
        pieces: unit.pieces.map((p) =>
          p.id === "root"
            ? p
            : {
                ...p,
                scale: [scale, scale, scale] as [number, number, number],
              },
        ),
      };
    };
    const small = measureUnit(column(1), pack);
    const large = measureUnit(column(3), pack);
    expect(small && large).toBeTruthy();
    expect(large?.slenderness).toBeCloseTo(small?.slenderness ?? NaN, 5);
  });

  it("records many parts for its size as dense and few as sparse", () => {
    expect(ok(sparseUnit).detail).toBe("sparse");
    expect(ok(denseUnit).detail).toBe("dense");
  });
});

describe("a unit that cannot give a style", () => {
  it("is refused when it has no parts, and says so", () => {
    const empty = unitOf([]);
    const result = styleFromUnit(empty, pack);
    expect(result).toMatchObject({ status: "refused", reason: "no-parts" });
    expect(result.status === "refused" && result.message).toMatch(/no parts/);
  });

  it("is refused when it was imported from a game model, and says so", () => {
    const imported: LegoProject = {
      ...unitOf([{ partId: green, at: [0, 0, 0] }]),
      imported: { source: "objects3d/arm/com.s3o" },
    };
    const result = styleFromUnit(imported, pack);
    expect(result).toMatchObject({ status: "refused", reason: "imported" });
    expect(result.status === "refused" && result.message).toMatch(/imported/);
  });
});

describe("generating with a style from a unit", () => {
  const SEEDS = Array.from({ length: 12 }, (_, i) => i + 1);
  const PLANS = ["biped", "quadruped", "wheeled", "tracked", "hover"];

  function batch(style?: GeneratorStyle) {
    return PLANS.flatMap((planId) =>
      SEEDS.map((seed) =>
        generateUnit(
          {
            seed,
            plan: bodyPlanById(planId) as BodyPlan,
            job: "assault",
            size: "medium",
          },
          {
            id: "unit",
            rootPieceId: "root",
            now: "2026-11-08T00:00:00.000Z",
            pack,
            modules,
            ...(style ? { style } : {}),
          },
        ),
      ),
    );
  }
  const mean = (values: number[]) =>
    values.reduce((a, b) => a + b, 0) / values.length;
  const measured = (units: LegoProject[], key: "slenderness" | "density") =>
    mean(
      units.flatMap((u) => {
        const m = measureUnit(u, pack);
        return m ? [m[key]] : [];
      }),
    );
  /** The style a source unit gives, named as the hook names it. */
  const styleOf = (source: LegoProject): GeneratorStyle => ({
    id: "from-unit",
    name: "From unit",
    ...ok(source),
  });

  // The baseline is the same style with the one tendency taken out, so the
  // colourway and shapes it carries from the source do not count as the move.
  const without = (
    style: GeneratorStyle,
    key: "proportions" | "detail",
  ): GeneratorStyle => {
    const { [key]: _removed, ...rest } = style;
    return rest;
  };

  it("moves the output towards the source's proportions", () => {
    for (const [source, key, side] of [
      [column, "lean", 1],
      [slab, "stocky", -1],
    ] as const) {
      const style = styleOf(source);
      expect(style.proportions).toBe(key);
      const plain = measured(
        batch(without(style, "proportions")),
        "slenderness",
      );
      const made = measured(batch(style), "slenderness");
      expect(Math.sign(made - plain)).toBe(side);
    }
  });

  it("moves the output towards the source's density", () => {
    for (const [source, key, side] of [
      [denseUnit, "dense", 1],
      [sparseUnit, "sparse", -1],
    ] as const) {
      const style = styleOf(source);
      expect(style.detail).toBe(key);
      const plain = measured(batch(without(style, "detail")), "density");
      const made = measured(batch(style), "density");
      expect(Math.sign(made - plain)).toBe(side);
    }
  });

  it("records the style on the unit it makes, for a reroll", () => {
    const style = styleOf(column);
    expect(batch(style)[0].generated?.style).toEqual(style);
  });
});
