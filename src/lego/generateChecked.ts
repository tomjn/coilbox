/**
 * A generated unit that passes the construction checks (issue #3241).
 *
 * The generator (`generateUnit`) makes a candidate. This runs the four checks
 * from the construction aids milestone on it: ground, balance, footprint and
 * overlap. A fault with a simple fix is repaired. A candidate with any other
 * fault is dropped and the next seed is tried, up to `GENERATOR_TRIES` seeds.
 * The generate screen shows only what this returns as `ok`.
 *
 * The simple fixes are the ones that leave the unit looking as it did:
 * - A buried covering part with nothing hung on it is removed. It cannot be
 *   seen and only costs triangles.
 * - The unit is moved across the ground so its box is centred on its origin,
 *   which is where the export centres the footprint it writes from that box.
 * - The unit is dropped or lifted onto the ground (`sitOnGround`), the
 *   builder's own "Sit on the ground".
 * A unit that would tip, a foot that is still off the ground once the unit
 * sits on it, and a buried part the generator needs are not simple.
 *
 * The next seed is the seed plus one, so the result depends only on the inputs,
 * and the unit records the seed that made it. Generating from that seed gives
 * the same unit again, because it passes on the first try.
 */

import { t } from "@lingui/core/macro";
import { formatNumber } from "@/lib/format";
import { balanceProblem, checkBalance, SAME_POSITION } from "./balance";
import { checkFootprint, footprintProblems } from "./footprint";
import {
  type GeneratorInputs,
  type GeneratorOptions,
  generateUnit,
} from "./generate";
import { childrenOf, type LegoProject } from "./model";
import { checkOverlap, overlapProblems } from "./overlap";
import type { LoadedPack } from "./pack";
import { type Problem, problem } from "./problems";
import { bakedPieces, sitOnGround } from "./s3oBuild";
import { groundProblems } from "./skeletonChecks";

/** The checks a generated unit must pass, in the order they are reported. */
export type GeneratorCheck = "ground" | "balance" | "footprint" | "overlap";

export const GENERATOR_CHECKS: { id: GeneratorCheck; label: string }[] = [
  {
    id: "ground",
    get label() {
      return t`Ground`;
    },
  },
  {
    id: "balance",
    get label() {
      return t`Balance`;
    },
  },
  {
    id: "footprint",
    get label() {
      return t`Footprint`;
    },
  },
  {
    id: "overlap",
    get label() {
      return t`Overlap`;
    },
  },
];

/**
 * How many seeds are tried before giving up. Over seeds 1 to 50 of every plan,
 * job and size, with the bundled parts and starter modules, 12% of repaired
 * candidates failed a check, and the worst input, a medium anti-air biped,
 * failed 33 of 50. At that rate 20 tries all fail about once in 4,000.
 */
export const GENERATOR_TRIES = 20;

export interface CheckFault {
  check: GeneratorCheck;
  problem: Problem;
}

/**
 * The whole unit off the ground, by the same measure as `sitOnGround`. The
 * skeleton's own check judges only feet and wheels with something to judge, and
 * a wheel with no part on it has nothing, so a unit standing on bare wheel
 * bones would float unremarked without this.
 */
function unitOffGround(project: LegoProject, pack: LoadedPack): Problem[] {
  const { world } = bakedPieces(project, pack, null);
  if (world.length === 0) return [];
  let lowest = Number.POSITIVE_INFINITY;
  for (const p of world) lowest = Math.min(lowest, p.y);
  if (Math.abs(lowest) <= SAME_POSITION) return [];
  const distance = formatNumber(Math.abs(lowest), { maximumFractionDigits: 2 });
  return [
    problem(
      "skeleton",
      "warning",
      lowest > 0
        ? t`The unit's lowest point is ${distance} elmos above the ground.`
        : t`The unit's lowest point is ${distance} elmos below the ground.`,
    ),
  ];
}

/** What the four checks find on a unit, in check order. Empty is a pass. */
export function generatorFaults(
  project: LegoProject,
  pack: LoadedPack,
): CheckFault[] {
  const tag = (check: GeneratorCheck) => (problem: Problem) => ({
    check,
    problem,
  });
  const balance = balanceProblem(checkBalance(project, pack, null));
  return [
    ...unitOffGround(project, pack).map(tag("ground")),
    ...groundProblems(project, pack, null).map(tag("ground")),
    ...(balance ? [tag("balance")(balance)] : []),
    ...footprintProblems(checkFootprint(project, pack, null, true)).map(
      tag("footprint"),
    ),
    ...overlapProblems(project, checkOverlap(project, pack, null)).map(
      tag("overlap"),
    ),
  ];
}

/** The unit without its buried covering parts that have nothing hung on them. */
function dropBuriedCovering(
  project: LegoProject,
  pack: LoadedPack,
): LegoProject {
  const covering = project.generated?.covering;
  if (!project.generated || !covering) return project;
  const ids = new Set(covering.map((c) => c.piece));
  const drop = new Set(
    checkOverlap(project, pack, null)
      .buried.map((b) => b.id)
      .filter((id) => ids.has(id) && childrenOf(project, id).length === 0),
  );
  if (drop.size === 0) return project;
  return {
    ...project,
    pieces: project.pieces.filter((p) => !drop.has(p.id)),
    generated: {
      ...project.generated,
      covering: covering.filter((c) => !drop.has(c.piece)),
    },
  };
}

/** The unit moved across the ground so its box is centred on its origin. */
function centreOnOrigin(project: LegoProject, pack: LoadedPack): LegoProject {
  const { world } = bakedPieces(project, pack, null);
  if (world.length === 0) return project;
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (const p of world) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z);
    maxZ = Math.max(maxZ, p.z);
  }
  const x = (minX + maxX) / 2;
  const z = (minZ + maxZ) / 2;
  if (x === 0 && z === 0) return project;
  // The root has no parent, so its position is in the unit's space.
  return {
    ...project,
    pieces: project.pieces.map((piece) =>
      piece.id === project.rootPieceId
        ? {
            ...piece,
            position: [
              piece.position[0] - x,
              piece.position[1],
              piece.position[2] - z,
            ],
          }
        : piece,
    ),
  };
}

/** The candidate with every simple fix made. */
export function repairCandidate(
  project: LegoProject,
  pack: LoadedPack,
): LegoProject {
  const kept = dropBuriedCovering(project, pack);
  return sitOnGround(centreOnOrigin(kept, pack), pack, null);
}

/** The seed tried after `seed`. A seed stays a safe whole number. */
export function nextSeed(seed: number): number {
  return seed >= Number.MAX_SAFE_INTEGER ? Number.MIN_SAFE_INTEGER : seed + 1;
}

export type CheckedGeneration =
  | {
      status: "ok";
      unit: LegoProject;
      /** The seed that made the unit, which the unit also records. */
      seed: number;
      /** How many seeds were tried, this one included. */
      tries: number;
    }
  | {
      status: "failed";
      /** The seeds tried, first and last. */
      first: number;
      last: number;
      tries: number;
      /** The check that failed the most seeds, the earliest in check order
       *  when two failed as many. */
      check: GeneratorCheck;
      /** What that check said about the first seed it failed. */
      problem: Problem;
      /** How many seeds each check failed. */
      counts: Record<GeneratorCheck, number>;
      /** The sentence for the game maker. */
      message: string;
    };

/**
 * A unit from the inputs that passes every check, or, when no seed from the
 * inputs' own onwards does within `tries`, the check that failed.
 */
export function generateCheckedUnit(
  inputs: GeneratorInputs,
  options: GeneratorOptions,
  tries: number = GENERATOR_TRIES,
): CheckedGeneration {
  if (!(tries >= 1)) throw new Error(`at least one try, not ${tries}`);
  const counts: Record<GeneratorCheck, number> = {
    ground: 0,
    balance: 0,
    footprint: 0,
    overlap: 0,
  };
  const firstFault = new Map<GeneratorCheck, Problem>();
  let seed = inputs.seed;
  let last = seed;
  for (let n = 1; n <= tries; n++) {
    last = seed;
    const unit = repairCandidate(
      generateUnit({ ...inputs, seed }, options),
      options.pack,
    );
    const faults = generatorFaults(unit, options.pack);
    if (faults.length === 0) return { status: "ok", unit, seed, tries: n };
    for (const { id } of GENERATOR_CHECKS) {
      const fault = faults.find((f) => f.check === id);
      if (!fault) continue;
      counts[id] += 1;
      if (!firstFault.has(id)) firstFault.set(id, fault.problem);
    }
    seed = nextSeed(seed);
  }
  const worst = GENERATOR_CHECKS.reduce((best, c) =>
    counts[c.id] > counts[best.id] ? c : best,
  );
  const example = firstFault.get(worst.id) as Problem;
  const first = inputs.seed;
  const label = worst.label;
  const said = example.message;
  return {
    status: "failed",
    first,
    last,
    tries,
    check: worst.id,
    problem: example,
    counts,
    message: t`No seed from ${first} to ${last} made a unit that passes the checks. The ${label} check failed most often. The first time, it said: ${said}`,
  };
}
