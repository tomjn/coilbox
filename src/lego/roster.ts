/**
 * A roster: one generated unit per job and tier, all in one style (#3239).
 *
 * A game maker making a faction asks for a line of units from a small scout to
 * a heavy. The request names the roster, the jobs, the body plans, a count of
 * tiers and a seed, and every unit comes from `generateCheckedUnit` with the
 * request's style.
 *
 * Tiers. The jobs give a size factor for small, medium and large. Tier 1 is
 * the job's small factor and the last tier its large one, and the tiers
 * between are spread evenly along small, medium, large. Three tiers are
 * exactly small, medium and large, so each of those units is the one the
 * generate screen makes from the same seed. Any other tier takes the rolls of
 * the size nearest it and records its own factor (`LegoGenerated.factor`), so
 * a reroll keeps its size.
 *
 * Sizes step up. Each tier's unit must have a bigger box than the tier below.
 * A seed whose unit is not bigger is passed over for the next, as a seed that
 * fails a check is, so the roster still depends only on the request.
 *
 * Plans. With several plans the jobs take them in turn: the first job the
 * first plan, the second job the second, and round again. Every tier of a job
 * has the same plan, so a job's line reads as one family.
 *
 * Names. A unit's unit name is the roster's name, the job and the tier, as
 * `raiders_scout_t1`, through `normalisePieceName`, so it is a Lua name and
 * sorts by job then tier. The display name is "Raiders Scout 1". A roster
 * whose names clash with a saved unit's is refused rather than renamed, so the
 * names stay the ones the game maker can predict.
 *
 * Each unit records its place (`LegoProject.roster`), and the units page
 * gathers units with the same roster id into one section (`groupProjects`).
 */

import { t } from "@lingui/core/macro";
import type { BodyPlan } from "./bodyPlans";
import {
  GENERATOR_JOBS,
  GENERATOR_SIZES,
  type GeneratorJob,
  type GeneratorOptions,
  type GeneratorSize,
} from "./generate";
import {
  GENERATOR_TRIES,
  generateCheckedUnit,
  nextSeed,
} from "./generateChecked";
import type { GeneratorStyle } from "./generatorStyle";
import { type LegoProject, normalisePieceName } from "./model";
import type { LoadedPack } from "./pack";
import { bakedPieces } from "./s3oBuild";

/** The most tiers a roster has. One digit, so `_t1` to `_t9` sort as text. */
export const MAX_ROSTER_TIERS = 9;

export interface RosterRequest {
  /** The roster's id, which every unit in it records. */
  id: string;
  name: string;
  seed: number;
  /** Taken in turn by the jobs. At least one. */
  plans: readonly BodyPlan[];
  /** In the order the roster lists them. At least one, none twice. */
  jobs: readonly GeneratorJob[];
  tiers: number;
  style?: GeneratorStyle;
}

/** What `generateUnit` needs besides the inputs, asked for once per unit so
 *  each gets its own id. */
export type RosterUnitOptions = () => Omit<
  GeneratorOptions,
  "style" | "factor"
>;

/** A tier's size: the size whose rolls it takes, and its factor. */
export interface TierSize {
  size: GeneratorSize;
  factor: number;
}

/**
 * Tier `tier` of `tiers` for a job: evenly along small, medium, large. One
 * tier is medium.
 */
export function tierSize(
  job: GeneratorJob,
  tier: number,
  tiers: number,
): TierSize {
  const def = GENERATOR_JOBS.find((j) => j.id === job);
  if (!def) throw new Error(`no generator job ${job}`);
  const sizes = GENERATOR_SIZES.map((s) => s.id);
  // Where the tier sits along the sizes, from 0 at small to 2 at large.
  const at = tiers === 1 ? 1 : ((tier - 1) * (sizes.length - 1)) / (tiers - 1);
  const below = Math.min(Math.floor(at), sizes.length - 2);
  const share = at - below;
  const low = def.size[sizes[below]];
  const high = def.size[sizes[below + 1]];
  const size = sizes[share < 0.5 ? below : below + 1];
  // A tier on a size is that size's factor exactly, not a sum that may be off
  // in the last bit.
  const factor =
    share === 0 ? low : share === 1 ? high : low + (high - low) * share;
  return { size, factor };
}

/** The unit name of a roster's unit, a Lua name. */
export function rosterUnitName(
  roster: string,
  job: GeneratorJob,
  tier: number,
): string {
  return normalisePieceName(
    `${normalisePieceName(roster)}_${normalisePieceName(job)}_t${tier}`,
  );
}

/** The display name of a roster's unit. */
export function rosterDisplayName(
  roster: string,
  job: GeneratorJob,
  tier: number,
): string {
  const name = roster.trim();
  const label = GENERATOR_JOBS.find((j) => j.id === job)?.label ?? job;
  return t`${name} ${label} ${tier}`;
}

/**
 * Why the request cannot be generated as asked, or null. Checks the counts and
 * that no unit's name or unit name is taken, by a saved unit or by another
 * unit of the roster.
 */
export function rosterRequestProblem(
  request: Pick<RosterRequest, "name" | "plans" | "jobs" | "tiers">,
  saved: readonly LegoProject[],
): string | null {
  if (request.name.trim() === "") return t`A roster needs a name.`;
  if (request.plans.length === 0) return t`Choose at least one body plan.`;
  if (request.jobs.length === 0) return t`Choose at least one job.`;
  const max = MAX_ROSTER_TIERS;
  if (
    !Number.isSafeInteger(request.tiers) ||
    request.tiers < 1 ||
    request.tiers > max
  ) {
    return t`A roster has from 1 to ${max} tiers.`;
  }
  const names = new Set(saved.map((p) => p.name.trim().toLowerCase()));
  const unitNames = new Set(saved.map((p) => p.unitName.toLowerCase()));
  for (const job of request.jobs) {
    for (let tier = 1; tier <= request.tiers; tier++) {
      const name = rosterDisplayName(request.name, job, tier);
      const unitName = rosterUnitName(request.name, job, tier);
      if (names.has(name.toLowerCase()) || unitNames.has(unitName)) {
        return t`A unit is already called ${name} or ${unitName}. Choose another roster name.`;
      }
      names.add(name.toLowerCase());
      unitNames.add(unitName);
    }
  }
  return null;
}

/** How big a unit is: its box's volume, in cubic elmos. */
export function unitVolume(unit: LegoProject, pack: LoadedPack): number {
  const { world } = bakedPieces(unit, pack, null);
  if (world.length === 0) return 0;
  const min = [
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
  ];
  const max = [
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ];
  for (const p of world) {
    min[0] = Math.min(min[0], p.x);
    min[1] = Math.min(min[1], p.y);
    min[2] = Math.min(min[2], p.z);
    max[0] = Math.max(max[0], p.x);
    max[1] = Math.max(max[1], p.y);
    max[2] = Math.max(max[2], p.z);
  }
  return (max[0] - min[0]) * (max[1] - min[1]) * (max[2] - min[2]);
}

export type RosterResult =
  | {
      status: "ok";
      /** By job in the request's order, then by tier, smallest first. */
      units: LegoProject[];
    }
  | { status: "failed"; message: string };

/**
 * Every unit of the roster, or why one could not be made. The same request,
 * pack and module library always give the same units.
 */
export function generateRoster(
  request: RosterRequest,
  options: RosterUnitOptions,
): RosterResult {
  const units: LegoProject[] = [];
  for (const [index, job] of request.jobs.entries()) {
    const plan = request.plans[index % request.plans.length];
    let smaller = 0;
    for (let tier = 1; tier <= request.tiers; tier++) {
      const { size, factor } = tierSize(job, tier, request.tiers);
      // On a size, the unit is the one the generate screen makes.
      const own =
        GENERATOR_JOBS.find((j) => j.id === job)?.size[size] === factor;
      let seed = request.seed;
      let last = seed;
      let made: LegoProject | null = null;
      let volume = 0;
      for (let n = 1; n <= GENERATOR_TRIES && !made; n++) {
        const base = options();
        const result = generateCheckedUnit(
          { seed, plan, job, size },
          {
            ...base,
            ...(request.style ? { style: request.style } : {}),
            ...(own ? {} : { factor }),
          },
        );
        if (result.status === "failed") {
          return { status: "failed", message: result.message };
        }
        last = result.seed;
        volume = unitVolume(result.unit, base.pack);
        if (volume > smaller) made = result.unit;
        else seed = nextSeed(result.seed);
      }
      if (!made) {
        const label = rosterDisplayName(request.name, job, tier);
        const first = request.seed;
        return {
          status: "failed",
          message: t`No seed from ${first} to ${last} made ${label} bigger than the tier below it.`,
        };
      }
      smaller = volume;
      units.push({
        ...made,
        name: rosterDisplayName(request.name, job, tier),
        unitName: rosterUnitName(request.name, job, tier),
        roster: {
          id: request.id,
          name: request.name.trim(),
          job,
          tier,
          tiers: request.tiers,
        },
      });
    }
  }
  return { status: "ok", units };
}
