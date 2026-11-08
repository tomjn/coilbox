/**
 * A variant of a generated unit: heavier, lighter, or with a different weapon
 * (issue #3240).
 *
 * A variant is a new unit made from the original's generator record, so it
 * keeps the body plan, job, style and seed, and changes only what the option
 * says. It records the unit it came from (`LegoProject.variantOf`). The
 * original is left as it is. Hand edits to the original are not carried over,
 * since the variant is generated again, not copied.
 *
 * - Heavier moves the size factor up to the job's next size tier, when there is
 *   one, and makes the covering `COVERING_STEP` times as thick. Lighter does
 *   the reverse. The rolls keep the original's size, so the proportions are
 *   the original's, larger or smaller.
 * - A different weapon rolls the weapon slots' module, size and gun roles off
 *   another seed. It picks another module when the library has more than one
 *   of the weapon's category, and always rolls the slot's size and the gun's
 *   length again, so with one weapon module in the library that is all it
 *   changes.
 *
 * A variant keeps the original's seed, because another seed is another unit. One
 * that fails the construction checks at that seed is reported with the check
 * that failed, rather than replaced by a different unit. A different weapon
 * moves on a weapon seed at a time instead.
 *
 * A loadout (`loadouts.ts`) is not a variant. A loadout swaps what is mounted
 * on one chassis and exports as extra unit definitions from the same unit. A
 * variant is a separate unit with its own skeleton, covering and size.
 */

import { t } from "@lingui/core/macro";
import { bodyPlanById } from "./bodyPlans";
import {
  GENERATOR_JOBS,
  GENERATOR_SIZES,
  type GeneratorSize,
  holdsGun,
  modulesFor,
} from "./generate";
import {
  type CheckedGeneration,
  GENERATOR_CHECKS,
  GENERATOR_TRIES,
  generateCheckedUnit,
  nextSeed,
} from "./generateChecked";
import { GENERATOR_SIZE_IDS } from "./generatorJobs";
import { type LegoProject, normalisePieceName } from "./model";
import type { LoadedPack } from "./pack";
import { validateProjectName } from "./projectNames";

export type VariantKind = "heavier" | "lighter" | "weapon";

/** How much thicker the covering of a heavier variant is, and how much
 *  thinner a lighter one's. A choice, not a measurement. */
export const COVERING_STEP = 1.5;

export const VARIANT_KINDS: { id: VariantKind; label: string }[] = [
  {
    id: "heavier",
    get label() {
      return t`Heavier`;
    },
  },
  {
    id: "lighter",
    get label() {
      return t`Lighter`;
    },
  },
  {
    id: "weapon",
    get label() {
      return t`Different weapon`;
    },
  },
];

export interface VariantOptions {
  pack: LoadedPack;
  /** The module library, the same the unit was generated from. */
  modules: readonly LegoProject[];
  /** Ids for the new unit. Left off, random ones. */
  id?: string;
  rootPieceId?: string;
  now?: string;
  /** The saved units, so the variant's name is not one already taken. */
  projects?: readonly LegoProject[];
  /** How many weapon seeds a different weapon tries. */
  tries?: number;
}

export type VariantResult =
  | { status: "ok"; unit: LegoProject; kind: VariantKind; seed: number }
  | { status: "failed"; message: string };

/** What a variant is built from, or why it cannot be. */
function setup(project: LegoProject, kind: VariantKind) {
  const generated = project.generated;
  if (!generated) {
    return { ok: false as const, message: t`This unit was not generated.` };
  }
  const plan = bodyPlanById(generated.plan);
  const job = GENERATOR_JOBS.find((j) => j.id === generated.job);
  const size = GENERATOR_SIZES.find((s) => s.id === generated.size);
  if (!plan || !job || !size || !(size.id in job.size)) {
    const name = generated.job;
    const sized = generated.size;
    return {
      ok: false as const,
      message: t`This version cannot generate the job ${name} at size ${sized}, so a variant cannot be made.`,
    };
  }
  const factor = generated.factor ?? job.size[size.id];
  const tiers = GENERATOR_SIZE_IDS.map((id) => job.size[id]);
  const bigger = tiers.find((f) => f > factor);
  const smaller = [...tiers].reverse().find((f) => f < factor);
  return {
    ok: true as const,
    generated,
    plan,
    job,
    size,
    factor,
    bigger,
    smaller,
    kind,
  };
}

/** The unit's weapon modules: the ones in its record that carry a gun. */
function weaponEntries(project: LegoProject, modules: readonly LegoProject[]) {
  return (project.generated?.modules ?? []).filter((entry) => {
    const module = modules.find((m) => m.id === entry.module);
    return module !== undefined && holdsGun(module);
  });
}

/** Why a variant of this kind cannot be made, or null when it can. Whether the
 *  checks pass for the variant is not told. */
export function variantRefusal(
  project: LegoProject,
  kind: VariantKind,
  modules: readonly LegoProject[],
): string | null {
  const made = setup(project, kind);
  if (!made.ok) return made.message;
  if (kind !== "weapon") return null;
  const entries = weaponEntries(project, modules);
  if (entries.length === 0) {
    return t`This unit has no weapon module to change.`;
  }
  // The generator rolls a weapon slot's module, its size and its gun roles'
  // lengths. A slot with one module and none of the other two rules has
  // nothing to roll.
  const varies = entries.some((entry) => {
    const slot = made.job.slots.find((s) => s.id === entry.slot.split(".")[0]);
    return (
      slot !== undefined &&
      (modulesFor(modules, slot).length > 1 ||
        slot.scale !== undefined ||
        Object.values(slot.roles ?? {}).some((r) => r.stretch !== undefined))
    );
  });
  return varies
    ? null
    : t`This unit's job fixes its weapon's size and shape, and the module library has no other weapon of its kind, so there is nothing to change.`;
}

/** The look of a unit's weapons: each weapon module's id and its pieces'
 *  scales. Two units with the same one have the same weapon. */
function weaponLook(
  unit: LegoProject,
  modules: readonly LegoProject[],
): string {
  return weaponEntries(unit, modules)
    .map((entry) => {
      const scales = unit.pieces
        .filter((p) => p.module?.instance === entry.instance)
        .map((p) => p.scale.map((s) => s.toFixed(4)).join(","));
      return `${entry.module}:${scales.join(";")}`;
    })
    .sort()
    .join("|");
}

const SAME = 1e-9;

/**
 * A new unit that is `project` made `kind`, or why not. `project` itself is
 * left as it is.
 */
export function makeVariant(
  project: LegoProject,
  kind: VariantKind,
  options: VariantOptions,
): VariantResult {
  const refusal = variantRefusal(project, kind, options.modules);
  if (refusal) return { status: "failed", message: refusal };
  const made = setup(project, kind);
  if (!made.ok) return { status: "failed", message: made.message };
  const { generated, plan, job, size, factor, bigger, smaller } = made;
  const tries = options.tries ?? GENERATOR_TRIES;

  const was = generated.thickness ?? 1;
  const thickness =
    kind === "heavier"
      ? was * COVERING_STEP
      : kind === "lighter"
        ? was / COVERING_STEP
        : was;
  const next =
    kind === "heavier"
      ? (bigger ?? factor)
      : kind === "lighter"
        ? (smaller ?? factor)
        : factor;

  const id = options.id ?? crypto.randomUUID();
  const base = {
    id,
    rootPieceId: options.rootPieceId ?? crypto.randomUUID(),
    now: options.now ?? new Date().toISOString(),
    pack: options.pack,
    modules: options.modules,
    ...(generated.style ? { style: generated.style } : {}),
    ...(Math.abs(next - job.size[size.id]) > SAME ? { factor: next } : {}),
    ...(Math.abs(thickness - 1) > SAME ? { thickness } : {}),
    ...(generated.weaponSeed !== undefined
      ? { weaponSeed: generated.weaponSeed }
      : {}),
  };
  const inputs = {
    seed: generated.seed,
    plan,
    job: job.id,
    size: size.id as GeneratorSize,
  };

  /** The unit at the original's seed, or why it does not pass the checks. */
  const atSeed = (given: typeof base): CheckedGeneration =>
    generateCheckedUnit(inputs, given, 1);
  const refused = (
    result: Extract<CheckedGeneration, { status: "failed" }>,
  ): VariantResult => {
    const check =
      GENERATOR_CHECKS.find((c) => c.id === result.check)?.label ??
      result.check;
    const said = result.problem.message;
    const seed = generated.seed;
    return {
      status: "failed",
      message: t`A variant at seed ${seed} fails the ${check} check, and a variant keeps its seed. It said: ${said}`,
    };
  };

  const finish = (unit: LegoProject): VariantResult => {
    const name = variantName(project, kind, options.projects ?? []);
    const parent = project.name;
    const notes =
      kind === "heavier"
        ? t`A heavier variant of ${parent}.`
        : kind === "lighter"
          ? t`A lighter variant of ${parent}.`
          : t`A variant of ${parent} with a different weapon.`;
    return {
      status: "ok",
      kind,
      seed: unit.generated?.seed ?? generated.seed,
      unit: {
        ...unit,
        name,
        unitName: normalisePieceName(name),
        notes: unit.notes ? `${unit.notes} ${notes}` : notes,
        variantOf: project.id,
      },
    };
  };

  if (kind !== "weapon") {
    const result = atSeed(base);
    return result.status === "ok" ? finish(result.unit) : refused(result);
  }

  // The unit as it is made without the change, to tell a different weapon from
  // the same one.
  const baseline = atSeed(base);
  if (baseline.status !== "ok") return refused(baseline);
  const before = weaponLook(baseline.unit, options.modules);
  let weaponSeed = nextSeed(generated.weaponSeed ?? generated.seed);
  const first = weaponSeed;
  let last = weaponSeed;
  for (let n = 1; n <= tries; n++) {
    last = weaponSeed;
    const result = atSeed({ ...base, weaponSeed });
    if (
      result.status === "ok" &&
      weaponLook(result.unit, options.modules) !== before
    ) {
      return finish(result.unit);
    }
    weaponSeed = nextSeed(weaponSeed);
  }
  return {
    status: "failed",
    message: t`No weapon seed from ${first} to ${last} made a different weapon that passes the checks.`,
  };
}

/** The name of a variant of `project`: its name with the kind after it, and a
 *  number when that is taken. */
export function variantName(
  project: LegoProject,
  kind: VariantKind,
  projects: readonly LegoProject[],
): string {
  const parent = project.name;
  const base =
    kind === "heavier"
      ? t`${parent} (heavier)`
      : kind === "lighter"
        ? t`${parent} (lighter)`
        : t`${parent} (different weapon)`;
  let name = base;
  for (let n = 2; validateProjectName([...projects], "", name) !== null; n++) {
    name = `${base} ${n}`;
  }
  return name;
}
