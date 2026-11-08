/**
 * A generator style made from a unit built out of parts (#3238).
 *
 * The style records what the unit shows of the four things a style holds:
 *
 * - Colourway: the colourway most of its parts are in. A style holds one, so
 *   the others are not kept. The parts pack's categories are its colourways
 *   (`colourwayLabel`), so a part's category is its colourway and is not
 *   counted twice.
 * - Shapes: the shapes that make up at least half as many parts as the most
 *   used one (`SHAPE_SHARE`).
 * - Proportions: `slenderness`, height over the square root of width times
 *   depth. It has no unit, so a four legged unit and a wheeled one are
 *   compared on shape rather than size. Stocky when the unit is lower for its
 *   footprint than the generator's own units are, lean when it is taller.
 * - Detail: `density`, parts per square elmo of the box round the unit, again
 *   against the generator's own units. Dense when it has more parts for its
 *   size, sparse when it has fewer.
 *
 * "The generator's own units" are the median of what it makes with no style,
 * for every body plan and job at medium size from seed 1, measured the same
 * way (`reference`). Measuring against that, not against a number written here,
 * means a style always points the way that moves the generator's output
 * towards the unit. A unit that measures the same as the median gets no
 * tendency.
 *
 * Both measures are taken from the document by `bakedPieces`, which is what an
 * export writes, so nothing depends on the scene being drawn. The box leaves
 * out what the footprint check leaves out: a barrel, a flare, an aim point and
 * a build arm's nozzle, which point out past the body.
 */

import { t } from "@lingui/core/macro";
import { BODY_PLANS } from "./bodyPlans";
import { OUTLYING_ROLES } from "./footprint";
import { GENERATOR_JOBS, generateUnit } from "./generate";
import {
  DETAIL_DENSITIES,
  type GeneratorStyle,
  PROPORTION_TENDENCIES,
} from "./generatorStyle";
import type { LegoProject } from "./model";
import type { LoadedPack } from "./pack";
import { bakedPieces } from "./s3oBuild";
import { starterModules } from "./starterModules";

/** A shape is kept when it has at least this share of the most used shape's
 *  parts. A choice, not a measurement: half. */
const SHAPE_SHARE = 1 / 2;

export type StyleRefusal = "imported" | "no-parts";

export type StyleFromUnit =
  | { status: "ok"; style: Omit<GeneratorStyle, "id" | "name"> }
  | { status: "refused"; reason: StyleRefusal; message: string };

/** The words for a refusal. */
export function refusalMessage(reason: StyleRefusal): string {
  return reason === "imported"
    ? t`This unit was imported from a game model, so it has no parts to make a style from.`
    : t`This unit has no parts to make a style from.`;
}

export interface Measures {
  slenderness: number;
  density: number;
}

/** The parts of a unit that the pack knows. */
function partsOf(project: LegoProject, pack: LoadedPack) {
  return project.pieces.flatMap((piece) => {
    const part = piece.partId ? pack.byId.get(piece.partId) : undefined;
    return part ? [part] : [];
  });
}

/** The unit's slenderness and density, or null when it has no box to measure. */
export function measureUnit(
  project: LegoProject,
  pack: LoadedPack,
): Measures | null {
  const { world, ranges } = bakedPieces(project, pack, null);
  const left = new Set<number>();
  for (const piece of project.pieces) {
    if (!piece.role || !OUTLYING_ROLES.includes(piece.role)) continue;
    const range = ranges.get(piece.id);
    if (!range) continue;
    for (let i = range[0]; i < range[1]; i++) left.add(i);
  }
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  world.forEach((p, i) => {
    if (left.has(i)) return;
    min[0] = Math.min(min[0], p.x);
    min[1] = Math.min(min[1], p.y);
    min[2] = Math.min(min[2], p.z);
    max[0] = Math.max(max[0], p.x);
    max[1] = Math.max(max[1], p.y);
    max[2] = Math.max(max[2], p.z);
  });
  const [x, y, z] = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  if (!(x > 0 && y > 0 && z > 0)) return null;
  const area = 2 * (x * y + y * z + x * z);
  return {
    slenderness: y / Math.sqrt(x * z),
    density: partsOf(project, pack).length / area,
  };
}

const medianOf = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
};

const references = new WeakMap<LoadedPack, Measures>();

/** The median of what the generator makes with no style. See the file comment. */
function reference(pack: LoadedPack): Measures {
  const cached = references.get(pack);
  if (cached) return cached;
  const modules = starterModules(pack);
  const found: Measures[] = [];
  for (const plan of BODY_PLANS) {
    for (const job of GENERATOR_JOBS) {
      const unit = generateUnit(
        { seed: 1, plan, job: job.id, size: "medium" },
        {
          id: "reference",
          rootPieceId: "root",
          now: "2026-11-08T00:00:00.000Z",
          pack,
          modules,
        },
      );
      const measures = measureUnit(unit, pack);
      if (measures) found.push(measures);
    }
  }
  const median = {
    slenderness: medianOf(found.map((m) => m.slenderness)),
    density: medianOf(found.map((m) => m.density)),
  };
  references.set(pack, median);
  return median;
}

/** The id in `order` with the highest count, the earliest of a tie. */
function mostUsed(counts: Map<string, number>, order: readonly string[]) {
  let best: string | undefined;
  for (const id of order) {
    const n = counts.get(id) ?? 0;
    if (n > 0 && n > (best ? (counts.get(best) ?? 0) : 0)) best = id;
  }
  return best;
}

/**
 * The style a unit built from parts gives, or why it cannot give one: an
 * imported unit names meshes rather than parts, and a unit with no parts has
 * nothing to count.
 */
export function styleFromUnit(
  project: LegoProject,
  pack: LoadedPack,
): StyleFromUnit {
  if (project.imported) {
    return {
      status: "refused",
      reason: "imported",
      message: refusalMessage("imported"),
    };
  }
  const parts = partsOf(project, pack);
  if (parts.length === 0) {
    return {
      status: "refused",
      reason: "no-parts",
      message: refusalMessage("no-parts"),
    };
  }

  const colours = new Map<string, number>();
  const shapes = new Map<string, number>();
  for (const part of parts) {
    colours.set(part.colourway, (colours.get(part.colourway) ?? 0) + 1);
    shapes.set(part.shape, (shapes.get(part.shape) ?? 0) + 1);
  }
  // `mixed` is a part the pack colours itself, which the style picker leaves
  // out, so a style never names it.
  const colourway = mostUsed(
    colours,
    pack.manifest.categories.map((c) => c.id).filter((id) => id !== "mixed"),
  );
  const top = Math.max(...shapes.values());
  const kept = [...shapes]
    .filter(([, n]) => n >= top * SHAPE_SHARE)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([shape]) => shape);

  const measures = measureUnit(project, pack);
  const median = reference(pack);
  const [stocky, lean] = PROPORTION_TENDENCIES;
  const [sparse, dense] = DETAIL_DENSITIES;
  const proportions =
    measures && measures.slenderness !== median.slenderness
      ? measures.slenderness < median.slenderness
        ? stocky
        : lean
      : undefined;
  const detail =
    measures && measures.density !== median.density
      ? measures.density < median.density
        ? sparse
        : dense
      : undefined;

  return {
    status: "ok",
    style: {
      ...(colourway ? { colourway } : {}),
      shapes: kept,
      ...(proportions ? { proportions } : {}),
      ...(detail ? { detail } : {}),
    },
  };
}
