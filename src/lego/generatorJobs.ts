/**
 * The jobs the generator knows, read from `generatorJobs.json` (issue #3232).
 *
 * A job says what a unit is for: which module categories it wants and how
 * many, a range for each proportion, and how its size scales those. The rules
 * are data, so adding a job means adding an entry to the file, with no change
 * here. `generate.ts` reads them and `generatorJobs.test.ts` checks them.
 *
 * Every number in the file is a design choice, not a measurement. They shape
 * what the generator picks. They do not limit what a game maker can then edit.
 */

import { t } from "@lingui/core/macro";
import data from "./generatorJobs.json";
import { limitAxes } from "./jointLimits";
import type { LegoAngleRange, LegoProject } from "./model";

/** The sizes a job scales its proportions for. */
export const GENERATOR_SIZE_IDS = ["small", "medium", "large"] as const;
export type GeneratorSize = (typeof GENERATOR_SIZE_IDS)[number];

/** A job's id, the key of its entry in the file. */
export type GeneratorJob = string;

/** A lowest and highest value, the lowest below the highest. */
export type Range = [number, number];

/** What a job asks of one piece role in the module a slot is filled with. */
export interface RoleRule {
  /** Times the piece's length along its own y axis, which is a barrel's length.
   *  Rolled in this range. */
  stretch?: Range;
  /** The elevation the piece is held to, set as its pitch limit. Only a role
   *  that can be limited in pitch takes one. */
  pitch?: LegoAngleRange;
}

/** One kind of module a job hangs on the unit. */
export interface JobSlot {
  /** Names the slot in `LegoGenerated.modules`, and seeds its rolls. */
  id: string;
  /** The module category it is filled from (`LegoProject.category`). */
  category: string;
  /** Modules carrying every one of these tags are chosen from. When none
   *  does, any module of the category is. */
  tags?: string[];
  /** How many, rolled between the two. Only one fits on a chassis today,
   *  because its top face is the one place a module goes. */
  count: Range;
  /** Times the scale the chassis fixes for the unit, rolled in this range.
   *  Left off, the module is the chassis's scale. */
  scale?: Range;
  /** Rules for the pieces of the module with a role, by role id. */
  roles?: Record<string, RoleRule>;
}

/** The range one proportion is rolled in. */
export interface ProportionRule {
  /** The body plan's proportion. A plan without it ignores the rule. */
  id: string;
  /** Left off, times the plan's default for the proportion, as scaled by the
   *  job's size. With it, times the value rolled for this other proportion,
   *  so `bodyLength` against `legLength` is the body's length over the leg's.
   *  A plan without that proportion ignores the rule. */
  against?: string;
  range: Range;
}

/** What a job asks of the structural parts covering the skeleton (#3233). */
export interface CoveringRule {
  /** How thick the covering is, as a share of the unit's width. Rolled
   *  between the two. */
  thickness: Range;
  /** Whether the unit gets a deck under its chassis. */
  body: boolean;
}

export interface GeneratorJobData {
  id: GeneratorJob;
  /** In English, as the file's author wrote it. The five built in jobs are
   *  shown translated instead (`BUILT_IN_LABELS`). */
  label: string;
  /** The chassis's width as a share of the unit's, rolled between the two. */
  bulk: Range;
  /** Times the plan's default proportions, for each size. */
  size: Record<GeneratorSize, number>;
  /** How heavily the skeleton is covered. A heavy job's is thicker. */
  covering: CoveringRule;
  /** A proportion with no rule is rolled about its default by `DEFAULT_SPREAD`. */
  proportions: ProportionRule[];
  /** Filled in order. The first slot is the chassis the others go on. */
  slots: JobSlot[];
}

/** A job as the generator reads it: its `label` is in the language active when
 *  it is read, for the built in jobs. */
export type GeneratorJobDef = GeneratorJobData;

/**
 * How far an unruled length is rolled from the plan's default, as a share
 * either way. A choice: enough that two seeds look different, small enough that
 * a unit keeps the plan's shape.
 */
export const DEFAULT_SPREAD: Range = [0.85, 1.15];

const BUILT_IN_LABELS: Record<string, () => string> = {
  assault: () => t`Assault`,
  artillery: () => t`Artillery`,
  scout: () => t`Scout`,
  builder: () => t`Builder`,
  antiair: () => t`Anti-air`,
};

const DATA = data.jobs as unknown as GeneratorJobData[];

/** Every job, in the order the file lists them. */
export const GENERATOR_JOBS: readonly GeneratorJobDef[] = DATA.map((job) => ({
  ...job,
  get label() {
    return BUILT_IN_LABELS[job.id]?.() ?? job.label;
  },
}));

/**
 * What is wrong with a job's rules, one line each, or nothing. A range is
 * wrong when it is not two numbers with the first below the second. A category
 * is wrong when no module in `library` has it, and so is a tag no module of
 * the category carries. A role is wrong when no piece role has that id or it
 * cannot be limited in the way asked.
 */
export function jobProblems(
  job: GeneratorJobData,
  library: readonly LegoProject[],
  roles: readonly string[],
  planProportions: readonly string[],
): string[] {
  const problems: string[] = [];
  const range = (what: string, value: unknown) => {
    const ok =
      Array.isArray(value) &&
      value.length === 2 &&
      value.every((n) => typeof n === "number" && Number.isFinite(n)) &&
      value[0] < value[1];
    if (!ok) {
      problems.push(`${job.id} ${what}: a minimum below a maximum`);
    }
  };
  // A count may be fixed, so its two ends may be the same.
  const count = (what: string, value: Range) => {
    const ok =
      Array.isArray(value) &&
      value.length === 2 &&
      value.every((n) => Number.isInteger(n) && n >= 0) &&
      value[0] <= value[1];
    if (!ok) problems.push(`${job.id} ${what}: whole numbers, min up to max`);
  };

  range("bulk", job.bulk);
  range("covering thickness", job.covering?.thickness);
  if (!((job.covering?.thickness?.[0] ?? 0) > 0)) {
    problems.push(`${job.id} covering thickness: above zero`);
  }
  if (typeof job.covering?.body !== "boolean") {
    problems.push(`${job.id} covering body: true or false`);
  }
  if (job.bulk[0] <= 0) problems.push(`${job.id} bulk: above zero`);
  if (job.bulk[1] > 1) problems.push(`${job.id} bulk: over the unit's width`);
  for (const size of GENERATOR_SIZE_IDS) {
    const factor = job.size[size];
    if (typeof factor !== "number" || !(factor > 0)) {
      problems.push(`${job.id} size ${size}: a number above zero`);
    }
  }
  const [small, medium, large] = GENERATOR_SIZE_IDS.map((s) => job.size[s]);
  if (!(small < medium && medium < large)) {
    problems.push(`${job.id} size: small below medium below large`);
  }

  for (const rule of job.proportions) {
    range(`proportion ${rule.id}`, rule.range);
    for (const name of [rule.id, rule.against]) {
      if (name !== undefined && !planProportions.includes(name)) {
        problems.push(`${job.id} proportion ${name}: no body plan has it`);
      }
    }
  }

  const first = job.slots[0]?.count;
  if (!first || first[0] !== 1 || first[1] !== 1) {
    problems.push(`${job.id} slots: the first slot is the one chassis`);
  }
  const ids = new Set<string>();
  for (const slot of job.slots) {
    if (ids.has(slot.id)) problems.push(`${job.id} slot ${slot.id}: repeated`);
    ids.add(slot.id);
    count(`slot ${slot.id} count`, slot.count);
    if (slot.scale) range(`slot ${slot.id} scale`, slot.scale);
    const inCategory = library.filter((m) => m.category === slot.category);
    if (inCategory.length === 0) {
      problems.push(
        `${job.id} slot ${slot.id}: no module has the category ${slot.category}`,
      );
    }
    for (const tag of slot.tags ?? []) {
      const has = inCategory.some((m) =>
        m.tags?.some((own) => own.toLowerCase() === tag.toLowerCase()),
      );
      if (!has) {
        problems.push(
          `${job.id} slot ${slot.id}: no ${slot.category} module has the tag ${tag}`,
        );
      }
    }
    for (const [role, rule] of Object.entries(slot.roles ?? {})) {
      const where = `${job.id} slot ${slot.id} role ${role}`;
      if (!roles.includes(role)) problems.push(`${where}: no such role`);
      if (rule.stretch) range(`${where} stretch`, rule.stretch);
      if (rule.pitch) {
        range(`${where} pitch`, [rule.pitch.min, rule.pitch.max]);
        if (!limitAxes(role).includes("pitch")) {
          problems.push(
            `${where}: a piece with this role cannot be limited in pitch`,
          );
        }
      }
    }
  }
  return problems;
}
