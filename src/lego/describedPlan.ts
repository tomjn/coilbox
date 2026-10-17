/**
 * Four questions turn a description of a unit into a skeleton (issue #3263).
 *
 * How it moves picks a movement plan from the registry. Whether it has a
 * weapon and whether it builds add a bone group each to that plan, so the
 * answer is one body plan, `describedPlan`, with the movement plan's bones and
 * proportions, then the weapon's, then the build arm's. The fourth question,
 * how big, is the size `skeletonSize.ts` already fits a plan to.
 *
 * A group hangs from the bone the movement plan carries its upper body on
 * (`MOUNT`), not from the root, so a turret on two legs sits on the torso and
 * not between the feet. The plan's id is the movement plan's id with `+gun`
 * and `+build` after it as the groups go on, so a saved unit names its plan in
 * the one field `LegoProject.skeleton` has, and `planById` finds it again.
 *
 * Where the numbers come from:
 *
 * - The weapon group is the turret building's own (`buildingPlans.ts`): turret
 *   height 13.7 and barrel length 41.1, the medians of Splinter Faction's 13
 *   static defences. No mobile unit's weapon has been measured.
 * - The build arm's one length is the nano point's rise, 17.1: the median
 *   height above the model origin of the first piece named nano* in the 63
 *   Splinter Faction models in `Objects3D` that have one, range 0.0 to 90.0
 *   (rounded out to 90). The model origin is the ground, and the group hangs
 *   from the upper body, so on a plan whose upper body is above the ground the
 *   point sits higher than the median model's. Splinter Faction's builders have
 *   a nano point and no arm, so the arm's base, arm and nozzle all sit at the
 *   mount and the nozzle carries the point.
 */

import {
  BODY_PLANS,
  type BodyPlan,
  type BodyPlanBone,
  type BodyPlanProportion,
  bodyPlanById,
} from "./bodyPlans";
import { BARREL_LENGTH, TURRET_HEIGHT } from "./buildingPlans";
import { between, rise } from "./planMeasure";

/** The movement answers, in the order the form lists them. */
export const MOVES = [
  { id: "biped", label: "Two legs" },
  { id: "quadruped", label: "Four legs" },
  { id: "wheeled", label: "Wheels" },
  { id: "tracked", label: "Tracks" },
  { id: "hover", label: "Hovers" },
  { id: "static", label: "Does not move" },
] as const;

export type MoveId = (typeof MOVES)[number]["id"];

/**
 * The most weapons the form allows. The script numbers a call-in for each
 * weapon (`scriptWeapons`), so it is not the limit. The plan is: it adds one
 * turret, barrel and flare with fixed bone ids, the id it saves names the group
 * with a bare `+gun`, a turret building already has its one turret, and no
 * measurement says where a second mobile weapon sits. More weapons are added to
 * the started unit.
 */
export const MAX_WEAPONS = 1;

export interface Description {
  move: MoveId;
  /** 0 up to `MAX_WEAPONS`. */
  weapons: number;
  builds: boolean;
}

/** The bone a unit's upper body is on, by movement plan. A plan not listed
 *  here takes its root. */
const MOUNT: Record<string, string> = {
  biped: "torso",
  quadruped: "torso",
  wheeled: "body",
  tracked: "body",
  hover: "deck",
};

const NANO_RISE: BodyPlanProportion = {
  id: "nanoRise",
  label: "Nano point height",
  unit: "elmo",
  min: 0,
  max: 90,
  step: 0.1,
  fallback: 17.1,
  handle: { bone: "buildarm.nozzle", axis: 1 },
};

/** The movement plan an answer names. A unit that does not move is the turret
 *  building when it has a weapon and the plain building when it has none. */
export function movementPlan(move: MoveId, weapons: number): BodyPlan {
  const id =
    move === "static" ? (weapons > 0 ? "turret.building" : "building") : move;
  const plan = bodyPlanById(id);
  if (!plan) throw new Error(`No body plan called ${id}.`);
  return plan;
}

function hasTurret(plan: BodyPlan): boolean {
  return plan.bones(emptyValues(plan)).some((bone) => bone.role === "turret");
}

function emptyValues(plan: BodyPlan): Record<string, number> {
  return Object.fromEntries(plan.proportions.map((p) => [p.id, p.fallback]));
}

function weaponBones(mount: string, v: Record<string, number>): BodyPlanBone[] {
  return [
    {
      id: "turret",
      name: "turret",
      parent: mount,
      position: [0, 0, 0],
      role: "turret",
    },
    {
      id: "barrel",
      name: "barrel",
      parent: "turret",
      position: [0, v.turretHeight, 0],
      role: "barrel",
    },
    {
      id: "flare",
      name: "flare",
      parent: "barrel",
      position: [0, 0, v.barrelLength],
      role: "flare",
    },
  ];
}

function buildBones(mount: string, v: Record<string, number>): BodyPlanBone[] {
  return [
    {
      id: "buildarm.base",
      name: "buildbase",
      parent: mount,
      position: [0, 0, 0],
      role: "buildarm.base",
    },
    {
      id: "buildarm.arm",
      name: "buildarm",
      parent: "buildarm.base",
      position: [0, 0, 0],
      role: "buildarm.arm",
    },
    {
      id: "buildarm.nozzle",
      name: "nozzle",
      parent: "buildarm.arm",
      position: [0, v.nanoRise, 0],
      role: "buildarm.nozzle",
    },
    {
      id: "buildarm.nano",
      name: "nano1",
      parent: "buildarm.nozzle",
      position: [0, 0, 0],
      role: "buildarm.nano",
    },
  ];
}

/**
 * The plan with a weapon group and a build arm added, each only if asked for.
 * A plan that has a turret already takes no second one. With nothing to add the
 * plan itself comes back.
 */
export function withGroups(
  base: BodyPlan,
  groups: { weapon: boolean; builds: boolean },
): BodyPlan {
  const weapon = groups.weapon && !hasTurret(base);
  if (!weapon && !groups.builds) return base;
  const mount = MOUNT[base.id] ?? "base";
  return {
    id: `${base.id}${weapon ? "+gun" : ""}${groups.builds ? "+build" : ""}`,
    label: `${base.label}${weapon ? ", gun" : ""}${groups.builds ? ", builds" : ""}`,
    description: base.description,
    basedOn: base.id,
    proportions: [
      ...base.proportions,
      ...(weapon ? [TURRET_HEIGHT, BARREL_LENGTH] : []),
      ...(groups.builds ? [NANO_RISE] : []),
    ],
    bones: (values) => [
      ...base.bones(values),
      ...(weapon ? weaponBones(mount, values) : []),
      ...(groups.builds ? buildBones(mount, values) : []),
    ],
    presets: [
      ...base.presets,
      ...(weapon
        ? [
            { presetId: "turret.track", params: {} },
            { presetId: "recoil", params: {} },
          ]
        : []),
      ...(groups.builds
        ? [
            { presetId: "build.aim", params: {} },
            { presetId: "build.nano", params: {} },
          ]
        : []),
    ],
    // The groups' lengths are read off their joints as the turret building's
    // are, and the nano point's rise is the nozzle's above the arm (#3261).
    measure: (joints, values) => ({
      ...base.measure?.(joints, values),
      ...(weapon
        ? {
            turretHeight: rise(joints, "turret", "barrel"),
            barrelLength: between(joints, "barrel", "flare"),
          }
        : {}),
      ...(groups.builds
        ? { nanoRise: rise(joints, "buildarm.arm", "buildarm.nozzle") }
        : {}),
    }),
  };
}

/** The body plan the four questions' first three answers describe. */
export function describedPlan(answer: Description): BodyPlan {
  const weapons = Math.min(
    MAX_WEAPONS,
    Math.max(0, Math.round(answer.weapons)),
  );
  return withGroups(movementPlan(answer.move, weapons), {
    weapon: weapons > 0,
    builds: answer.builds,
  });
}

/**
 * The plan a saved skeleton names: one from the registry, or a registry plan
 * with groups added, as `withGroups` writes the id.
 */
export function planById(id: string): BodyPlan | undefined {
  const [movement, ...groups] = id.split("+");
  const base = BODY_PLANS.find((plan) => plan.id === movement);
  if (!base) return undefined;
  if (groups.length === 0) return base;
  const known = groups.every((g) => g === "gun" || g === "build");
  if (!known) return undefined;
  const plan = withGroups(base, {
    weapon: groups.includes("gun"),
    builds: groups.includes("build"),
  });
  return plan.id === id ? plan : undefined;
}
