/**
 * The turret building and plain building body plans (issue #3251).
 *
 * Both are static: the plans set no movement, so export writes `canmove =
 * false` as it does for any unit with no movement class. The root bone is the
 * base, on the ground at the unit's origin, with the Body role.
 *
 * The turret building is Splinter Faction's, the default game. Every one of
 * its 13 faction static defences (the unit defs with a weapon and no movement
 * class, less shields, mines and chicken structures) is a base holding a
 * turret, the turret a barrel and the barrel a fire point, for example
 * `cannonturret1`, `cannonbarrel1` and `cannonfirepoint1`. Each default is
 * the median of those 13 models, and each range covers all of them, rounded
 * out to 5 elmos as the legged plans' are.
 *
 * - Base height is the turret joint above the ground: 41.0, from 20.1 to
 *   222.8.
 * - Turret height is the barrel joint above the turret joint: 13.7, from 4.4
 *   to 45.0.
 * - Barrel length is the fire point ahead of the barrel joint: 41.1, from 9.4
 *   to 157.9.
 *
 * A bone only places a joint, and the base's width and depth place none, so
 * neither plan has them. A building's width and depth are its footprint,
 * which a skeleton is sized to in #3254.
 *
 * There is no `aim` bone. An aim point carries a weapon of its own
 * (`weaponCarriers`), so a turret and an aim point together are two weapons,
 * and the turret already answers `AimFromWeapon`. That is also why Aim point
 * (`aim.track`) is not applied: it drives only an aim point.
 *
 * The plain building is the base alone. Its size is the footprint and height,
 * and nothing in it moves. No Splinter Faction building has a door piece to
 * measure one from, so a door is added by hand with the Door role.
 */

import { t } from "@lingui/core/macro";
import type { BodyPlan, BodyPlanBone, BodyPlanProportion } from "./bodyPlans";
import { between, rise } from "./planMeasure";

function elmos(
  id: string,
  label: () => string,
  min: number,
  max: number,
  fallback: number,
  handle?: BodyPlanProportion["handle"],
): BodyPlanProportion {
  return {
    id,
    get label() {
      return label();
    },
    unit: "elmo",
    min,
    max,
    step: 0.1,
    fallback,
    ...(handle ? { handle } : {}),
  };
}

const BASE: BodyPlanBone = {
  id: "base",
  name: "base",
  parent: null,
  position: [0, 0, 0],
  role: "base",
};

/**
 * Each bone's origin is its joint, where the engine turns it: the turret about
 * y on top of the base, the barrel about x at its joint above that. The flare
 * is straight ahead on +z, the way the engine points a unit and recoil pulls a
 * barrel back.
 */
export const TURRET_HEIGHT = elmos(
  "turretHeight",
  () => t`Turret height`,
  0,
  45,
  13.7,
  {
    bone: "barrel",
    axis: 1,
  },
);
export const BARREL_LENGTH = elmos(
  "barrelLength",
  () => t`Barrel length`,
  5,
  160,
  41.1,
  { bone: "flare", axis: 2 },
);

export const TURRET_BUILDING: BodyPlan = {
  id: "turret.building",
  get label() {
    return t`Turret building`;
  },
  get description() {
    return t`A gun turret on a base that does not move.`;
  },
  proportions: [
    elmos("baseHeight", () => t`Base height`, 20, 225, 41, {
      bone: "turret",
      axis: 1,
    }),
    TURRET_HEIGHT,
    BARREL_LENGTH,
  ],
  bones({ baseHeight, turretHeight, barrelLength }) {
    return [
      BASE,
      {
        id: "turret",
        name: "turret",
        parent: "base",
        position: [0, baseHeight as number, 0],
        role: "turret",
      },
      {
        id: "barrel",
        name: "barrel",
        parent: "turret",
        position: [0, turretHeight as number, 0],
        role: "barrel",
      },
      {
        id: "flare",
        name: "flare",
        parent: "barrel",
        position: [0, 0, barrelLength as number],
        role: "flare",
      },
    ];
  },
  presets: [
    { presetId: "turret.track", params: {} },
    { presetId: "recoil", params: {} },
  ],
  // The unit's origin is on the ground, so the turret joint's height is the
  // base's.
  measure: (joints) => ({
    baseHeight: joints.get("turret")?.[1],
    turretHeight: rise(joints, "turret", "barrel"),
    barrelLength: between(joints, "barrel", "flare"),
  }),
};

export const BUILDING: BodyPlan = {
  id: "building",
  get label() {
    return t`Building`;
  },
  get description() {
    return t`A base that does not move, with nothing to animate.`;
  },
  proportions: [],
  bones() {
    return [BASE];
  },
  presets: [],
};
