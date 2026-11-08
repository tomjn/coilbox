/**
 * A batch of generated units for the generate screen (#3234).
 *
 * Each candidate comes from `generateCheckedUnit`, which moves on to the next
 * seed when one fails the checks. The next candidate starts after the seed the
 * last one used, so two candidates never share a seed and a reroll that starts
 * after the batch never repeats one of it.
 */

import type { GeneratorInputs, GeneratorOptions } from "./generate";
import { generateCheckedUnit, nextSeed } from "./generateChecked";
import type { LegoProject } from "./model";

export interface Candidate {
  /** The seed that made the unit, which can differ from the one asked for. */
  seed: number;
  unit: LegoProject;
}

export interface CandidateBatch {
  candidates: Candidate[];
  /** Where the next batch starts. */
  next: number;
  /** Why the batch stopped short, from `generateCheckedUnit`. */
  failed: string | null;
}

/**
 * Up to `count` units from `start` onwards. Stops at the first input that no
 * seed within the checker's tries can make, and says why.
 *
 * `options` is asked once per candidate, so each one gets its own unit id.
 */
export function generateCandidates(
  inputs: Omit<GeneratorInputs, "seed">,
  start: number,
  count: number,
  options: () => GeneratorOptions,
): CandidateBatch {
  const candidates: Candidate[] = [];
  let seed = start;
  for (let n = 0; n < count; n++) {
    const result = generateCheckedUnit({ ...inputs, seed }, options());
    if (result.status === "failed") {
      return {
        candidates,
        next: nextSeed(result.last),
        failed: result.message,
      };
    }
    candidates.push({ seed: result.seed, unit: result.unit });
    seed = nextSeed(result.seed);
  }
  return { candidates, next: seed, failed: null };
}

/** A seed for a blank seed field. Small enough to read and type back. */
export function randomSeed(): number {
  return Math.floor(Math.random() * 1_000_000);
}

/** A typed seed, or null when it is not a whole number the generator takes.
 *  Blank is a random one. */
export function parseSeed(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === "") return randomSeed();
  if (!/^-?\d+$/.test(trimmed)) return null;
  const seed = Number(trimmed);
  return Number.isSafeInteger(seed) ? seed : null;
}
