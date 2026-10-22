/**
 * The hovercraft, aircraft and ship body plans (issue #3252).
 *
 * Each uses only roles and presets that already exist, and says in its
 * description what it will not do. None sets a movement class, so export
 * writes a static unit until one is picked under Movement, as for every plan.
 *
 * Where the numbers come from. Each was measured off the models' `.s3o`
 * pieces, rest positions and vertices. Each default is the median and each
 * range covers every model, rounded out to 5 elmos as the other plans' are.
 *
 * Splinter Faction, the default game, has no hover movement class, so the
 * hovercraft is Beyond All Reason (rapid tag test-30922) instead: the 20 unit
 * defs on a hover class, less an amphibious bot, a vehicle that floats and a
 * battleship. The hull is the piece named `base` (`body` on one), and its own
 * vertex box gives:
 *
 * - Hull length: 40.2, from 22.6 to 63.7.
 * - Hull width: 31.1, from 17.3 to 59.4.
 * - Hull height, bottom to top of the hull: 14.9, from 7.3 to 23.0.
 * - Gap under the hull, the hull's lowest point above the ground: 0.1, from
 *   -0.2 to 2.0. The two below the ground are held at 0.
 *
 * The ship is Splinter Faction's 10 unit defs on a ship class. The root piece
 * is the hull, at the waterline, and 8 of them carry a turret, barrel and fire
 * point, which give the gun's numbers:
 *
 * - Hull length, the root's vertex box: 89.2, from 45.4 to 130.2.
 * - Deck height, the turret joint above the hull's: 9.3, from 5.0 to 13.4.
 * - Turret height, the barrel joint above the turret's: 5.8, from 3.6 to 13.9.
 * - Barrel length, the fire point ahead of the barrel joint: 14.3, from 11.1
 *   to 33.7.
 *
 * Every ship has a `wake` piece. Over the 10, the one furthest back is a
 * median 0.94 of the way from the middle to the stern, so the plan's sits at
 * the stern and marks the hull's length.
 *
 * The aircraft is Splinter Faction's 17 unit defs that fly, less the chickens.
 * 7 of them carry a gun as a turret ball holding a barrel holding a fire point,
 * with the barrel's joint on the ball's in every one:
 *
 * - Gun ahead, the ball's joint ahead of the body's: 5.1, from -15.3 to 17.6.
 *   A gun behind the body joint is a tail gun.
 * - Gun height, the ball's joint above the body's: 1.9, from -1.4 to 2.9.
 * - Barrel length: 5.2, from 3.7 to 6.8.
 */

import { t } from "@lingui/core/macro";
import type { BodyPlan, BodyPlanBone, BodyPlanProportion } from "./bodyPlans";

function elmos(
  id: string,
  label: () => string,
  min: number,
  max: number,
  fallback: number,
  handle: NonNullable<BodyPlanProportion["handle"]>,
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
    handle,
  };
}

/**
 * The root on the ground, the hull at the gap above it with the Body role,
 * which Hover and bob moves, and bones at the hull's edges: the deck on top, a
 * skirt on each side and the wake at the stern. The wake has the Wake point
 * role, which `wake.moving` emits a wake from (#4368). The deck is where a
 * turret goes and the skirts where side skirts or fans go.
 */
export const HOVER: BodyPlan = {
  id: "hover",
  get label() {
    return t`Hovercraft`;
  },
  get description() {
    return t`A hull that bobs over land and water and leaves a wake. It does not lean into turns.`;
  },
  proportions: [
    elmos("hullLength", () => t`Hull length`, 20, 65, 40.2, {
      bone: "wake",
      axis: 2,
    }),
    elmos("hullWidth", () => t`Hull width`, 15, 60, 31.1, {
      bone: "skirt.l",
      axis: 0,
    }),
    elmos("hullHeight", () => t`Hull height`, 5, 25, 14.9, {
      bone: "deck",
      axis: 1,
    }),
    elmos("gap", () => t`Gap under the hull`, 0, 5, 0.1, {
      bone: "hull",
      axis: 1,
    }),
  ],
  bones({ hullLength, hullWidth, hullHeight, gap }) {
    const half = (hullWidth as number) / 2;
    const skirt = (side: "l" | "r", sign: 1 | -1): BodyPlanBone => ({
      id: `skirt.${side}`,
      name: `${side}skirt`,
      parent: "hull",
      position: [sign * half, 0, 0],
      twin: `skirt.${side === "l" ? "r" : "l"}`,
    });
    return [
      { id: "base", name: "base", parent: null, position: [0, 0, 0] },
      {
        id: "hull",
        name: "hull",
        parent: "base",
        position: [0, gap as number, 0],
        role: "base",
      },
      {
        id: "deck",
        name: "deck",
        parent: "hull",
        position: [0, hullHeight as number, 0],
      },
      skirt("l", 1),
      skirt("r", -1),
      {
        id: "wake",
        name: "wake",
        parent: "hull",
        position: [0, 0, -(hullLength as number) / 2],
        role: "wake",
      },
    ];
  },
  presets: [
    { presetId: "hover.bob", params: {} },
    { presetId: "wake.moving", params: {} },
  ],
};

/**
 * The hull is the root, at the waterline, with the Body role. A turret on the
 * deck holds a barrel holding a muzzle flare, as on the turret building. A
 * wake bone with the Wake point role and a rudder bone sit at the stern on the
 * waterline.
 * There is one rudder, which turns about its joint at the hinge.
 */
export const SHIP: BodyPlan = {
  id: "ship",
  get label() {
    return t`Ship`;
  },
  get description() {
    return t`A hull with a gun turret, a wake and a rudder that swings as it turns. It does not rock on the water.`;
  },
  proportions: [
    elmos("hullLength", () => t`Hull length`, 45, 135, 89.2, {
      bone: "wake",
      axis: 2,
    }),
    elmos("deckHeight", () => t`Deck height`, 5, 15, 9.3, {
      bone: "turret",
      axis: 1,
    }),
    elmos("turretHeight", () => t`Turret height`, 0, 15, 5.8, {
      bone: "barrel",
      axis: 1,
    }),
    elmos("barrelLength", () => t`Barrel length`, 10, 35, 14.3, {
      bone: "flare",
      axis: 2,
    }),
  ],
  bones({ hullLength, deckHeight, turretHeight, barrelLength }) {
    return [
      {
        id: "hull",
        name: "hull",
        parent: null,
        position: [0, 0, 0],
        role: "base",
      },
      {
        id: "turret",
        name: "turret",
        parent: "hull",
        position: [0, deckHeight as number, 0],
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
      {
        id: "wake",
        name: "wake",
        parent: "hull",
        position: [0, 0, -(hullLength as number) / 2],
        role: "wake",
      },
      {
        id: "rudder",
        name: "rudder",
        parent: "hull",
        position: [0, 0, -(hullLength as number) / 2],
        role: "rudder",
      },
    ];
  },
  presets: [
    { presetId: "turret.track", params: {} },
    { presetId: "recoil", params: {} },
    { presetId: "rudder.follow", params: {} },
    { presetId: "wake.moving", params: {} },
  ],
};

/**
 * The body is the root with the Body role. The gun is a turret ball with the
 * barrel's joint on it, so the ball turns the gun about y and the barrel about
 * x from the same point, as on every Splinter Faction aircraft that has one.
 */
export const AIRCRAFT: BodyPlan = {
  id: "aircraft",
  get label() {
    return t`Aircraft`;
  },
  get description() {
    return t`A body with a gun that aims. It does not fly once exported, and has no rotors or landing gear.`;
  },
  proportions: [
    elmos("gunForward", () => t`Gun ahead`, -20, 20, 5.1, {
      bone: "turret",
      axis: 2,
    }),
    elmos("gunHeight", () => t`Gun height`, -5, 5, 1.9, {
      bone: "turret",
      axis: 1,
    }),
    elmos("barrelLength", () => t`Barrel length`, 0, 10, 5.2, {
      bone: "flare",
      axis: 2,
    }),
  ],
  bones({ gunForward, gunHeight, barrelLength }) {
    return [
      {
        id: "body",
        name: "body",
        parent: null,
        position: [0, 0, 0],
        role: "base",
      },
      {
        id: "turret",
        name: "turret",
        parent: "body",
        position: [0, gunHeight as number, gunForward as number],
        role: "turret",
      },
      {
        id: "barrel",
        name: "barrel",
        parent: "turret",
        position: [0, 0, 0],
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
};
