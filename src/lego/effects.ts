/**
 * What a unit script emits, as particles on one frame.
 *
 * Pure: a frame and the emissions resolved from a run give the same particles
 * every time, whatever order the frames were visited in, because a preview is
 * scrubbed and an accumulating simulation would draw something different on
 * every visit. Each particle is a closed form of how long ago it was emitted.
 * The engine's random draws come from `unitFloat`, never `Math.random`.
 *
 * Nano moves as Recoil moves it (`rts/Sim/Projectiles/ProjectileHandler.cpp:670-746`)
 * and is drawn as Total Annihilation drew it: opaque dots with no alpha and a
 * little variation in colour. That is the user's choice, recorded in the spec.
 */

import type { NanoStyle } from "./scriptPlayback";

export type Vec3 = [number, number, number];

export interface NanoEmission {
  kind: "nano";
  /** The frame it was emitted on. */
  birth: number;
  /** The nano piece's origin, world space. */
  at: Vec3;
  /** The buildee's middle, world space. */
  to: Vec3;
  /** Half the buildee's radius, as `Builder.cpp:353` passes it. */
  radius: number;
  style: NanoStyle;
  seed: number;
  /**
   * Frames its dots leave the nozzle over, one when not given. A script
   * sprays from several nozzles by swapping the piece `QueryNanoPiece`
   * answers, so each nozzle fires on only some frames. Spreading a nozzle's
   * dots until it next fires keeps every nozzle's stream unbroken.
   */
  span?: number;
}

export type Emission = NanoEmission;

export interface Particles {
  count: number;
  /** Three per particle. */
  centers: Float32Array;
  /** One per particle, in CSS pixels on screen, whatever the zoom. */
  halfSizes: Float32Array;
  /** Three per particle, sRGB from 0 to 1. */
  colors: Float32Array;
}

/** `UnitDef::nanoColor`'s default (`rts/Sim/Units/UnitDef.cpp:513`). */
const NANO_COLOR: Vec3 = [0.2, 0.7, 0.2];

/**
 * Half the width of a TA nano dot, in CSS pixels on screen. TA drew nano as
 * a few screen pixels whatever the unit's size, so this is a screen size, not
 * elmos. Set by eye with the user against their Total Annihilation
 * screenshots. TA's own value is not available.
 */
const NANO_DOT_HALF_SIZE = 2;

/** How far a dot's brightness strays from the nano colour, either way. Set by
 *  eye against the TA screenshots. */
const NANO_BRIGHTNESS_SPREAD = 0.3;

/**
 * Dots per spraying frame. Recoil emits one particle a frame
 * (`Builder.cpp:353`), which draws as a thin line of dots. TA sprays a cone
 * of them, so each emission draws this many, each with its own jitter from
 * Recoil's formula. Set by eye with the user against their TA screenshots.
 */
export const NANO_DOTS_PER_FRAME = 24;

/** How much wider than Recoil's the cone is. Recoil's spreads to half the
 *  buildee's radius at the target (`Builder.cpp:353`). TA's covers the whole
 *  buildee. Set by eye with the user against their TA screenshots. */
export const NANO_SPREAD = 2;

/** How many random draws one dot takes: three for its jitter, two for its
 *  colour, one for when in its frame it left the nozzle. */
const DRAWS_PER_DOT = 6;

/** How often a dot is a near-white highlight, and how near. Set by eye
 *  against the TA screenshots. */
const NANO_HIGHLIGHT_CHANCE = 0.06;
const NANO_HIGHLIGHT_MIX = 0.6;

/** A number in [0, 1) that is the same for the same seed and draw. */
export function unitFloat(seed: number, draw: number): number {
  let x =
    Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(draw + 1, 0xc2b2ae35);
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

/**
 * The engine's `NextVector`: a point uniform in the unit ball
 * (`rts/System/GlobalRNG.h:151-161`). The engine rejects points outside the
 * ball, which draws an unknown number of times. This draws three and maps
 * them to the same distribution, so it always takes the same draws.
 */
function ballPoint(seed: number, first: number): Vec3 {
  const z = unitFloat(seed, first) * 2 - 1;
  const angle = unitFloat(seed, first + 1) * Math.PI * 2;
  const r = Math.cbrt(unitFloat(seed, first + 2));
  const ring = Math.sqrt(1 - z * z);
  return [r * ring * Math.cos(angle), r * z, r * ring * Math.sin(angle)];
}

interface NanoMotion {
  speed: Vec3;
  life: number;
}

/** Where a nano particle goes and for how long, from
 *  `CProjectileHandler::AddNanoParticle` (`ProjectileHandler.cpp:686-703,724-745`). */
function nanoMotion(emission: NanoEmission, dot: number): NanoMotion | null {
  const d: Vec3 = [
    emission.to[0] - emission.at[0],
    emission.to[1] - emission.at[1],
    emission.to[2] - emission.at[2],
  ];
  const len = Math.hypot(...d);
  if (len === 0) return null;
  const builder = emission.style === "builder";
  const jitter = (builder ? emission.radius / len : 0.15) * NANO_SPREAD;
  const pace = builder ? 3 : 1;
  const wobble = ballPoint(emission.seed, dot * DRAWS_PER_DOT);
  const speed: Vec3 = [
    (d[0] / len + wobble[0] * jitter) * pace,
    (d[1] / len + wobble[1] * jitter) * pace,
    (d[2] / len + wobble[2] * jitter) * pace,
  ];
  return { speed, life: Math.trunc(builder ? len / 3 : len) };
}

/** A TA nano dot's colour: the nano colour, a little brighter or darker, and
 *  now and then close to white. */
function nanoColor(seed: number, dot: number): Vec3 {
  const first = dot * DRAWS_PER_DOT;
  const brightness =
    1 + (unitFloat(seed, first + 3) * 2 - 1) * NANO_BRIGHTNESS_SPREAD;
  const lit = NANO_COLOR.map((c) => Math.min(1, c * brightness)) as Vec3;
  if (unitFloat(seed, first + 4) >= NANO_HIGHLIGHT_CHANCE) return lit;
  return lit.map((c) => c + (1 - c) * NANO_HIGHLIGHT_MIX) as Vec3;
}

export function particlesAt(emissions: Emission[], frame: number): Particles {
  const centers: number[] = [];
  const halfSizes: number[] = [];
  const colors: number[] = [];
  for (const emission of emissions) {
    const age = frame - emission.birth;
    if (age < 0) continue;
    for (let dot = 0; dot < NANO_DOTS_PER_FRAME; dot++) {
      const motion = nanoMotion(emission, dot);
      if (!motion) continue;
      // Each dot leaves at its own moment in the emission's span, so the dots
      // spread along the stream rather than bunching into one clump per
      // emission.
      const leaves =
        unitFloat(emission.seed, dot * DRAWS_PER_DOT + 5) *
        (emission.span ?? 1);
      const flown = age - leaves;
      if (flown < 0 || flown >= motion.life) continue;
      centers.push(
        emission.at[0] + motion.speed[0] * flown,
        emission.at[1] + motion.speed[1] * flown,
        emission.at[2] + motion.speed[2] * flown,
      );
      halfSizes.push(NANO_DOT_HALF_SIZE);
      colors.push(...nanoColor(emission.seed, dot));
    }
  }
  return {
    count: halfSizes.length,
    centers: new Float32Array(centers),
    halfSizes: new Float32Array(halfSizes),
    colors: new Float32Array(colors),
  };
}
