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
 *
 * A shot also draws the engine's muzzle flame the way `CMuzzleFlame` draws it,
 * and a tracer running from the muzzle to the target, a neutral look the
 * preview chose since the engine draws the projectile itself instead.
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

export interface FlameEmission {
  kind: "flame";
  birth: number;
  /** The flare piece's origin, world space. */
  at: Vec3;
  /** Unit length, the latest aim. */
  dir: Vec3;
  /** `CMuzzleFlame`'s size. */
  size: number;
  seed: number;
}

export interface TracerEmission {
  kind: "tracer";
  birth: number;
  /** The muzzle's emit point, world space. */
  at: Vec3;
  /** The stand-in's middle, world space. */
  to: Vec3;
  seed: number;
  /** Which weapon fired it, counted from one, so a unit with more than one can
   *  be told apart on screen. */
  weapon: number;
}

export type Emission = NanoEmission | FlameEmission | TracerEmission;

export interface Sprites {
  count: number;
  /** Three per sprite, world space. */
  centers: Float32Array;
  /** One per sprite, in elmos. */
  halfSizes: Float32Array;
  /** Four per sprite, RGBA from 0 to 1, multiplied by the bitmap. */
  colors: Float32Array;
  /** One per sprite, a `BITMAP_*` slot, or `BITMAP_SMOKE + n` for smoke bitmap n. */
  bitmaps: Float32Array;
  /** Three per sprite, a world-space unit direction, zero for an ordinary
   *  billboard. Only a stretched sprite such as the tracer's bolt sets it. */
  axes: Float32Array;
  /** One per sprite, in elmos, zero for an ordinary billboard. Half the
   *  bolt's length along its `axes` direction. */
  halfLengths: Float32Array;
  /** Two per sprite: the near and far u edges of the quad, as fractions of
   *  its bitmap's own u range. `[0, 1]` for an ordinary sprite. A laser end
   *  cap uses half the laser end bitmap, split at `midtexx`. */
  uvRanges: Float32Array;
}

export interface Particles {
  count: number;
  /** Three per particle. */
  centers: Float32Array;
  /** One per particle, in CSS pixels on screen, whatever the zoom. */
  halfSizes: Float32Array;
  /** Three per particle, sRGB from 0 to 1. */
  colors: Float32Array;
  sprites: Sprites;
}

/** Which bitmap a sprite draws: `CMuzzleFlame::Draw`'s three textures, the
 *  laser's own end cap texture, the heat cloud a VTOL sfx draws, the `explo`
 *  bitmap the preview's CEG puff draws, and the wake. The smoke set comes
 *  last because its length depends on the game. */
export const BITMAP_MUZZLE_FLAME = 0;
export const BITMAP_LASER = 1;
export const BITMAP_LASER_END = 2;
export const BITMAP_HEATCLOUD = 3;
export const BITMAP_EXPLO = 4;
export const BITMAP_WAKE = 5;
export const BITMAP_SMOKE = 6;

/** `CMuzzleFlame`'s size with the weapon def's defaults: area of effect 8
 *  stored as 4 (`WeaponDef.cpp:71`) and damage 1 (`WeaponDef.cpp:417`), fed
 *  through `min(damageAreaOfEffect * 0.2, min(1500, damage) * 0.003)`
 *  (`Weapon.cpp:1229`). */
export const DEFAULT_FLAME_SIZE = Math.min(4 * 0.2, Math.min(1500, 1) * 0.003);

/**
 * A piece's emit point and direction, from `LocalModelPiece::GetEmitDirPos`
 * (`rts/Rendering/Models/3DModelPiece.cpp:60-78`): the origin and +Z with no
 * vertices, the origin and that vertex with one, or vertex 0 towards vertex 1
 * with more.
 */
export function emitPoint(vertices: Vec3[]): { pos: Vec3; dir: Vec3 } {
  if (vertices.length === 0) return { pos: [0, 0, 0], dir: [0, 0, 1] };
  if (vertices.length === 1) return { pos: [0, 0, 0], dir: vertices[0] };
  return {
    pos: vertices[0],
    dir: [
      vertices[1][0] - vertices[0][0],
      vertices[1][1] - vertices[0][1],
      vertices[1][2] - vertices[0][2],
    ],
  };
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
  const life = nanoLife(emission);
  if (life === null) return null;
  const d: Vec3 = [
    emission.to[0] - emission.at[0],
    emission.to[1] - emission.at[1],
    emission.to[2] - emission.at[2],
  ];
  const len = Math.hypot(...d);
  const builder = emission.style === "builder";
  const jitter = (builder ? emission.radius / len : 0.15) * NANO_SPREAD;
  const pace = builder ? 3 : 1;
  const wobble = ballPoint(emission.seed, dot * DRAWS_PER_DOT);
  const speed: Vec3 = [
    (d[0] / len + wobble[0] * jitter) * pace,
    (d[1] / len + wobble[1] * jitter) * pace,
    (d[2] / len + wobble[2] * jitter) * pace,
  ];
  return { speed, life };
}

/** How long a nano particle lives, in frames, from the same formula as
 *  `nanoMotion`. Depends only on the emission, not the dot, so `particlesAt`
 *  computes it once and skips a whole dead emission before looping its dots. */
function nanoLife(emission: NanoEmission): number | null {
  const d: Vec3 = [
    emission.to[0] - emission.at[0],
    emission.to[1] - emission.at[1],
    emission.to[2] - emission.at[2],
  ];
  const len = Math.hypot(...d);
  if (len === 0) return null;
  const builder = emission.style === "builder";
  return Math.trunc(builder ? len / 3 : len);
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

/** Set by eye, to be tuned with the user on screen: how fast a preview tracer
 *  crosses the ground, and how long it is. The engine draws the real
 *  projectile instead, so there is no source for these. */
const TRACER_SPEED = 10;
const TRACER_LENGTH = 40;

/** `CLaserProjectile::Draw`'s half-width, the weapon def's `thickness`
 *  default (`WeaponDef.cpp:261`), and its core, the `coreThickness` default
 *  of that (`WeaponDef.cpp:262`). */
const TRACER_THICKNESS = 2;
const TRACER_CORE_THICKNESS = TRACER_THICKNESS * 0.25;

/**
 * A tracer's outer and core colour, by weapon, set by eye since the weapon's
 * own colour needs its unit def. Weapon 1 keeps the preview's original warm
 * white-gold bolt with a plain white core. Weapon 2 is an orange-red, so a
 * unit's second weapon reads apart from its first, and weapon 3 a pale blue.
 * A fourth weapon and beyond cycle back through the same three.
 *
 * Alpha 1/255 matches the engine's own laser colour byte
 * (`LaserProjectile.cpp:210`), which is close to additive against the ONE /
 * ONE_MINUS_SRC_ALPHA blend, and every entry keeps it.
 */
type TracerColors = {
  outer: [number, number, number, number];
  core: [number, number, number, number];
};

const TRACER_PALETTE: TracerColors[] = [
  { outer: [1, 0.85, 0.6, 1 / 255], core: [1, 1, 1, 1 / 255] },
  { outer: [1, 0.35, 0.15, 1 / 255], core: [1, 0.7, 0.55, 1 / 255] },
  { outer: [0.55, 0.75, 1, 1 / 255], core: [0.85, 0.92, 1, 1 / 255] },
];

/** The outer and core colour a weapon's tracer draws, cycling through
 *  `TRACER_PALETTE` for a weapon past the palette's own length. */
function tracerColors(weapon: number): TracerColors {
  const index =
    (((weapon - 1) % TRACER_PALETTE.length) + TRACER_PALETTE.length) %
    TRACER_PALETTE.length;
  return TRACER_PALETTE[index];
}

interface SpriteArrays {
  centers: number[];
  halfSizes: number[];
  colors: number[];
  bitmaps: number[];
  axes: number[];
  halfLengths: number[];
  /** Two per sprite: where in its bitmap's rect the quad's near and far u
   *  edges sit, as fractions of the rect's own u range. `[0, 1]` for an
   *  ordinary sprite that uses the whole rect. A laser end cap uses half of
   *  it, split at the texture's `midtexx`. */
  uvRanges: number[];
}

/** A muzzle flame's quads on one frame, following `CMuzzleFlame::Draw`
 *  (`MuzzleFlame.cpp:52-93`). The flame is made during the firing frame's
 *  unit update, and the projectile handler updates it later the same frame
 *  before drawing, so on frame `birth + k` it already has age `k + 1`. */
function flameSprites(
  emission: FlameEmission,
  frame: number,
  smokeCount: number,
  out: SpriteArrays,
): void {
  const k = frame - emission.birth;
  if (k < 0) return;
  const age = k + 1;
  const life = 4 + emission.size * 30;
  if (age > life) return;

  // Construction: pos -= dir * size * 0.2 (MuzzleFlame.cpp:31).
  const pos: Vec3 = [
    emission.at[0] - emission.dir[0] * emission.size * 0.2,
    emission.at[1] - emission.dir[1] * emission.size * 0.2,
    emission.at[2] - emission.dir[2] * emission.size * 0.2,
  ];
  const numSmoke = 1 + Math.floor(emission.size * 5);
  const alpha = Math.max(0, 1 - age / life);
  const modAge = Math.sqrt(age + 2);
  const drawsize = modAge * 3;

  for (let a = 0; a < numSmoke; a++) {
    // randSmokeDir[a] = dir + guRNG.NextFloat() * 0.4, one float added to
    // all three components.
    const rand = unitFloat(emission.seed, a) * 0.4;
    const scale = (a + 2) * modAge * 0.4;
    const interPos: Vec3 = [
      pos[0] + (emission.dir[0] + rand) * scale,
      pos[1] + (emission.dir[1] + rand) * scale,
      pos[2] + (emission.dir[2] + rand) * scale,
    ];
    const fade = Math.min(1, Math.max(0, (1 - alpha) * (20 + a) * 0.1));

    out.centers.push(...interPos);
    out.halfSizes.push(drawsize);
    out.colors.push(
      Math.trunc(180 * alpha * fade) / 255,
      Math.trunc(180 * alpha * fade) / 255,
      Math.trunc(180 * alpha * fade) / 255,
      Math.trunc(255 * alpha * fade) / 255,
    );
    out.bitmaps.push(BITMAP_SMOKE + (a % smokeCount));
    out.axes.push(0, 0, 0);
    out.halfLengths.push(0);
    out.uvRanges.push(0, 1);

    if (fade < 1) {
      const ifade = 1 - fade;
      out.centers.push(...interPos);
      out.halfSizes.push(drawsize);
      out.colors.push(
        Math.trunc(ifade * 255) / 255,
        Math.trunc(ifade * 255) / 255,
        Math.trunc(ifade * 255) / 255,
        1 / 255,
      );
      out.bitmaps.push(BITMAP_MUZZLE_FLAME);
      out.axes.push(0, 0, 0);
      out.halfLengths.push(0);
      out.uvRanges.push(0, 1);
    }
  }
}

/** The fraction of the laser end texture's u range that its `midtexx` split
 *  sits at. `midtexx` is defined as the exact midpoint of `xstart..xend`
 *  (`LaserProjectile.cpp:47-49`), so the fraction is always one half, not a
 *  number read off a particular weapon def. */
const MIDTEX_U = 0.5;

/** One end cap's outer and core quads, following `CLaserProjectile::Draw`'s
 *  `texture2` quads (`LaserProjectile.cpp:243-260,279-295`). Each is a quad
 *  stretched from `end` outward by `size` (outer) or `coresize` (core) along
 *  `axis`, the direction the cap bulges away from the bolt: forward past the
 *  head, backward past the tail. The near edge, at `end` itself, sits at the
 *  texture's `midtexx`, and the far edge sits at `farU`, `xstart` for the
 *  head or `xend` for the tail. */
function tracerEndCap(
  end: Vec3,
  axis: Vec3,
  farU: number,
  colors: TracerColors,
  out: SpriteArrays,
): void {
  const push = (size: number, color: [number, number, number, number]) => {
    const half = size / 2;
    out.centers.push(
      end[0] + axis[0] * half,
      end[1] + axis[1] * half,
      end[2] + axis[2] * half,
    );
    out.halfSizes.push(size);
    out.colors.push(...color);
    out.bitmaps.push(BITMAP_LASER_END);
    out.axes.push(...axis);
    out.halfLengths.push(half);
    out.uvRanges.push(MIDTEX_U, farU);
  };
  push(TRACER_THICKNESS, colors.outer);
  push(TRACER_CORE_THICKNESS, colors.core);
}

/** A preview tracer's bolt on one frame, drawn as `CLaserProjectile::Draw`
 *  draws a laser: a camera-facing end cap quad past the head, one quad
 *  stretched from `tail` to `head` along the shot's path with a thinner core
 *  quad over it, then a camera-facing end cap quad past the tail, the
 *  engine's own draw order (`LaserProjectile.cpp:243-260,279-295`, the
 *  `texture2` branch). `head` is how far the tracer has travelled and `tail`
 *  is `TRACER_LENGTH` behind it, both clamped to the run from the muzzle to
 *  the target. Nothing is drawn once the raw, unclamped tail has passed the
 *  target, before the emission's birth frame, or while the clamped bolt has
 *  no length, matching the engine's own `curDrawLen <= 0` guard
 *  (`LaserProjectile.cpp:225-226`). */
function tracerSprites(
  emission: TracerEmission,
  frame: number,
  out: SpriteArrays,
): void {
  const k = frame - emission.birth;
  if (k < 0) return;
  const d: Vec3 = [
    emission.to[0] - emission.at[0],
    emission.to[1] - emission.at[1],
    emission.to[2] - emission.at[2],
  ];
  const distance = Math.hypot(...d);
  if (distance === 0) return;
  const dir: Vec3 = [d[0] / distance, d[1] / distance, d[2] / distance];

  const headRaw = k * TRACER_SPEED;
  const tailRaw = headRaw - TRACER_LENGTH;
  if (tailRaw >= distance) return;

  const head = Math.min(Math.max(headRaw, 0), distance);
  const tail = Math.min(Math.max(tailRaw, 0), distance);
  if (head <= tail) return;

  const mid = (head + tail) / 2;
  const halfLength = (head - tail) / 2;
  const center: Vec3 = [
    emission.at[0] + dir[0] * mid,
    emission.at[1] + dir[1] * mid,
    emission.at[2] + dir[2] * mid,
  ];
  const headPos: Vec3 = [
    emission.at[0] + dir[0] * head,
    emission.at[1] + dir[1] * head,
    emission.at[2] + dir[2] * head,
  ];
  const tailPos: Vec3 = [
    emission.at[0] + dir[0] * tail,
    emission.at[1] + dir[1] * tail,
    emission.at[2] + dir[2] * tail,
  ];
  const behindHead: Vec3 = [-dir[0], -dir[1], -dir[2]];
  const colors = tracerColors(emission.weapon);

  // Head cap first, at xstart..midtexx, then the bolt, then the tail cap at
  // midtexx..xend, the order `CLaserProjectile::Draw` itself uses.
  tracerEndCap(headPos, dir, 0, colors, out);

  out.centers.push(...center);
  out.halfSizes.push(TRACER_THICKNESS);
  out.colors.push(...colors.outer);
  out.bitmaps.push(BITMAP_LASER);
  out.axes.push(...dir);
  out.halfLengths.push(halfLength);
  out.uvRanges.push(0, 1);

  out.centers.push(...center);
  out.halfSizes.push(TRACER_CORE_THICKNESS);
  out.colors.push(...colors.core);
  out.bitmaps.push(BITMAP_LASER);
  out.axes.push(...dir);
  out.halfLengths.push(halfLength);
  out.uvRanges.push(0, 1);

  tracerEndCap(tailPos, behindHead, 1, colors, out);
}

export function particlesAt(
  emissions: Emission[],
  frame: number,
  smokeCount = 1,
): Particles {
  const centers: number[] = [];
  const halfSizes: number[] = [];
  const colors: number[] = [];
  const sprites: SpriteArrays = {
    centers: [],
    halfSizes: [],
    colors: [],
    bitmaps: [],
    axes: [],
    halfLengths: [],
    uvRanges: [],
  };
  for (const emission of emissions) {
    if (emission.kind === "flame") {
      flameSprites(emission, frame, smokeCount, sprites);
      continue;
    }
    if (emission.kind === "tracer") {
      tracerSprites(emission, frame, sprites);
      continue;
    }
    const age = frame - emission.birth;
    if (age < 0) continue;
    const life = nanoLife(emission);
    if (life === null || age >= life + (emission.span ?? 1)) continue;
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
    sprites: {
      count: sprites.halfSizes.length,
      centers: new Float32Array(sprites.centers),
      halfSizes: new Float32Array(sprites.halfSizes),
      colors: new Float32Array(sprites.colors),
      bitmaps: new Float32Array(sprites.bitmaps),
      axes: new Float32Array(sprites.axes),
      halfLengths: new Float32Array(sprites.halfLengths),
      uvRanges: new Float32Array(sprites.uvRanges),
    },
  };
}
