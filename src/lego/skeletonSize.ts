/**
 * Sizing a skeleton to a footprint and a height (issue #3254).
 *
 * The footprint is in steps of `ELMOS_PER_FOOTPRINT` and the height in elmos.
 * Each plan has a rule for which of its proportions take up which axis. The
 * size measured is the box the plan's proportions describe, from joint to
 * joint: parts built on the skeleton add to it, and the footprint check
 * (`footprint.ts`) measures the finished unit.
 *
 * - Two legs: stance sets the width, and the unit is as long as it is wide,
 *   since the plan has no body length. Leg length and body height share the
 *   height in the proportion they already have.
 * - Four legs: stance sets the width and body length the length. The height is
 *   shared as for two legs.
 * - Wheels: track width sets the width, the span of the axles the length
 *   (axle spacing over the gaps between the axles, so the axle count is kept),
 *   and wheel height the height.
 * - Tracks: track width, track length and track height.
 * - Turret building: base height and turret height share the height in the
 *   proportion they already have. No joint places the base's width and depth,
 *   so the footprint is the target itself.
 * - Building: nothing is a proportion, so the whole size is the target.
 *
 * A plan that is square on the ground takes the smaller side of the footprint,
 * so the box stays inside what was asked for. A value past a proportion's range
 * is held to it, and the size that results is what `skeletonSize` then reports.
 */

import { type BodyPlan, planProportions, projectFromPlan } from "./bodyPlans";
import type { LegoProject, SkeletonTarget } from "./model";
import { applyProportions } from "./skeletonEdit";
import { ELMOS_PER_FOOTPRINT, footprintSteps } from "./unitDef";

type Values = Record<string, number>;

/** Elmos on each axis. An axis is null when no proportion sets it and there is
 *  no target to say. */
export interface SkeletonSize {
  x: number | null;
  z: number | null;
  height: number | null;
}

interface Goal {
  x: number;
  z: number;
  height: number;
}

interface Rule {
  /** The axes the plan's proportions set, in elmos. */
  measure(values: Values): Partial<Record<keyof Goal, number>>;
  /** The proportions that bring the axes the plan sets to the goal. They are
   *  not yet held to their ranges. */
  fit(values: Values, goal: Goal, plan: BodyPlan): Values;
  /** The footprint in steps when the proportions do not give one. */
  footprint?: { x: number; z: number };
}

/**
 * The height of a plain building when nothing else says. It is the Armada solar
 * collector's, the reference unit (`referenceObject.ts`): no Splinter Faction
 * building height has been measured.
 */
export const BUILDING_HEIGHT = 29.1;

/** The 13 Splinter Faction defences' median footprint (#3251). */
const TURRET_FOOTPRINT = { x: 4, z: 4 };
/** The 23 Splinter Faction buildings with no weapon, median footprint (#3251). */
const BUILDING_FOOTPRINT = { x: 9, z: 9 };

/**
 * `total` shared between the proportions in `ids` in the proportion they have
 * now. A share that passes its range is held to the nearest end and the rest
 * go to the others, so the sum is kept for as long as any has room.
 */
function splitHeight(
  plan: BodyPlan,
  ids: string[],
  current: Values,
  total: number,
): Values {
  const out: Values = {};
  let free = ids.map((id) => {
    const range = plan.proportions.find((p) => p.id === id);
    return {
      id,
      min: range?.min ?? 0,
      max: range?.max ?? Infinity,
      weight: current[id] ?? 0,
    };
  });
  let left = total;
  while (free.length > 0) {
    const sum = free.reduce((all, p) => all + p.weight, 0);
    const share = (p: (typeof free)[number]) =>
      sum > 0 ? (left * p.weight) / sum : left / free.length;
    const pinned = free.filter((p) => share(p) < p.min || share(p) > p.max);
    if (pinned.length === 0) {
      for (const p of free) out[p.id] = share(p);
      break;
    }
    const shares = new Map(pinned.map((p) => [p, share(p)]));
    for (const p of pinned) {
      const value = Math.min(p.max, Math.max(p.min, shares.get(p) as number));
      out[p.id] = value;
      left -= value;
    }
    free = free.filter((p) => !pinned.includes(p));
  }
  return out;
}

const RULES: Record<string, Rule> = {
  biped: {
    measure: (v) => ({
      x: v.stance,
      z: v.stance,
      height: v.legLength + v.bodyHeight,
    }),
    fit: (v, g, plan) => ({
      stance: Math.min(g.x, g.z),
      ...splitHeight(plan, ["legLength", "bodyHeight"], v, g.height),
    }),
  },
  quadruped: {
    measure: (v) => ({
      x: v.stance,
      z: v.bodyLength,
      height: v.legLength + v.bodyHeight,
    }),
    fit: (v, g, plan) => ({
      stance: g.x,
      bodyLength: g.z,
      ...splitHeight(plan, ["legLength", "bodyHeight"], v, g.height),
    }),
  },
  wheeled: {
    measure: (v) => ({
      x: v.trackWidth,
      z: (v.axles - 1) * v.axleSpacing,
      height: v.wheelHeight,
    }),
    fit: (v, g) => ({
      trackWidth: g.x,
      axleSpacing: g.z / (v.axles - 1),
      wheelHeight: g.height,
    }),
  },
  tracked: {
    measure: (v) => ({
      x: v.trackWidth,
      z: v.trackLength,
      height: v.trackHeight,
    }),
    fit: (_v, g) => ({
      trackWidth: g.x,
      trackLength: g.z,
      trackHeight: g.height,
    }),
  },
  "turret.building": {
    measure: (v) => ({ height: v.baseHeight + v.turretHeight }),
    fit: (v, g, plan) =>
      splitHeight(plan, ["baseHeight", "turretHeight"], v, g.height),
    footprint: TURRET_FOOTPRINT,
  },
  building: {
    measure: () => ({}),
    fit: () => ({}),
    footprint: BUILDING_FOOTPRINT,
  },
};

function ruleFor(plan: BodyPlan): Rule | undefined {
  return RULES[plan.basedOn ?? plan.id];
}

/** Elmos in a footprint, per axis. */
export function targetElmos(target: SkeletonTarget): Goal {
  return {
    x: target.footprint.x * ELMOS_PER_FOOTPRINT,
    z: target.footprint.z * ELMOS_PER_FOOTPRINT,
    height: target.height,
  };
}

/**
 * The size of a skeleton with these proportions, in elmos. An axis no
 * proportion sets is the target's, or null without one. A plan this version
 * has no rule for has no size.
 */
export function skeletonSize(
  plan: BodyPlan,
  proportions: Values,
  target?: SkeletonTarget,
): SkeletonSize {
  const rule = ruleFor(plan);
  const measured = rule ? rule.measure(planProportions(plan, proportions)) : {};
  const goal = target ? targetElmos(target) : null;
  return {
    x: measured.x ?? goal?.x ?? null,
    z: measured.z ?? goal?.z ?? null,
    height: measured.height ?? goal?.height ?? null,
  };
}

/**
 * The proportions that size the skeleton to the target, every one held to its
 * range, a count rounded and kept as it is. Proportions the plan's rule leaves
 * alone are as they were.
 */
export function fitProportions(
  plan: BodyPlan,
  proportions: Values,
  target: SkeletonTarget,
): Values {
  const rule = ruleFor(plan);
  const current = planProportions(plan, proportions);
  if (!rule) return current;
  return planProportions(plan, {
    ...current,
    ...rule.fit(current, targetElmos(target), plan),
  });
}

/**
 * The target a plan starts from: the footprint and height of its default
 * proportions, or for a building the median footprint of the game's own.
 */
export function defaultTarget(plan: BodyPlan): SkeletonTarget {
  const rule = ruleFor(plan);
  const measured = rule?.measure(planProportions(plan)) ?? {};
  const steps = (elmos: number | undefined, fallback = 1) =>
    elmos === undefined ? fallback : footprintSteps(elmos);
  return {
    footprint: {
      x: steps(measured.x, rule?.footprint?.x),
      z: steps(measured.z, rule?.footprint?.z),
    },
    height: Number((measured.height ?? BUILDING_HEIGHT).toFixed(1)),
  };
}

/**
 * The target a skeleton with no target stands at: the footprint steps and
 * height it measures now, with the plan's default for an axis it cannot
 * measure.
 */
export function currentTarget(
  plan: BodyPlan,
  proportions: Values,
): SkeletonTarget {
  const size = skeletonSize(plan, proportions);
  const fallback = defaultTarget(plan);
  return {
    footprint: {
      x: size.x === null ? fallback.footprint.x : footprintSteps(size.x),
      z: size.z === null ? fallback.footprint.z : footprintSteps(size.z),
    },
    height:
      size.height === null ? fallback.height : Number(size.height.toFixed(1)),
  };
}

/** The size in words: steps first, then elmos, then the height. */
export function describeSize(size: SkeletonSize): string {
  const round = (n: number) => Number(n.toFixed(1));
  const parts: string[] = [];
  if (size.x !== null && size.z !== null) {
    parts.push(
      `${footprintSteps(size.x)} by ${footprintSteps(size.z)} steps (${round(size.x)} by ${round(size.z)} elmos)`,
    );
  }
  if (size.height !== null) parts.push(`${round(size.height)} elmos tall`);
  return parts.join(", ");
}

/** Past this, an axis counts as over the target. Absorbs float error from the
 *  division an axle count makes. */
const SLACK = 1e-6;

/** The axes where the size passes the target. */
export function overTarget(
  size: SkeletonSize,
  target: SkeletonTarget,
): (keyof Goal)[] {
  const goal = targetElmos(target);
  return (["x", "z", "height"] as const).filter((axis) => {
    const measured = size[axis];
    return measured !== null && measured > goal[axis] + SLACK;
  });
}

/** A new unit from the plan, fitted to the target, which it keeps. */
export function projectFromTarget(
  plan: BodyPlan,
  target: SkeletonTarget,
  options: Parameters<typeof projectFromPlan>[1],
): LegoProject {
  const proportions = fitProportions(
    plan,
    planProportions(plan, options.proportions),
    target,
  );
  const project = projectFromPlan(plan, { ...options, proportions });
  return project.skeleton
    ? { ...project, skeleton: { ...project.skeleton, target } }
    : project;
}

/**
 * The unit refitted to a new target, which it then keeps. One edit: the
 * proportions move as `applyProportions` moves them. A unit with no skeleton,
 * one from another plan, or one fitted to its own pieces comes back as it was.
 */
export function applyTarget(
  project: LegoProject,
  plan: BodyPlan,
  target: SkeletonTarget,
  newId: () => string,
): LegoProject {
  const skeleton = project.skeleton;
  if (!skeleton || skeleton.plan !== plan.id || skeleton.fitted) return project;
  const values = fitProportions(plan, skeleton.proportions, target);
  const { project: fitted } = applyProportions(project, plan, values, newId);
  return fitted.skeleton
    ? { ...fitted, skeleton: { ...fitted.skeleton, target } }
    : fitted;
}
