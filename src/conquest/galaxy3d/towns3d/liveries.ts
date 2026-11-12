/**
 * What each building of an open town is made of. A model is built once in the
 * planet's concrete, and each copy of it is then dressed in one livery: its
 * walls change surface and colour, its roofs and trim stay as they were built.
 *
 * Every colour here multiplies the planet's wall colour, so a brick town on a
 * desert is still a different red from one on ice.
 */
import type * as THREE from "three";
import type { Kind } from "../landmarks/kit";

type Tint = readonly [number, number, number];

/** One of a building's surfaces in a livery: what it is drawn as and its colour. */
interface Finish {
  /** Left out to keep the surface the model was built with. */
  kind?: Kind;
  tint: Tint;
}

export interface Livery {
  id: string;
  /** How many buildings take it, beside the other liveries its height allows. */
  share: number;
  /** The model heights it is for. Left out for no limit. */
  from?: number;
  to?: number;
  /** The main masses, the ribbed ones, and the podiums and plates. */
  wall: Finish;
  ribs: Finish;
  alt: Finish;
  /** Its roofs, which keep the concrete and what has settled on it. */
  roof: Tint;
  /** The dark metal of its bands and recesses, and its painted panels. Left out to keep them. */
  trim?: Finish;
  accent?: Finish;
}

/** The kinds a model's walls are built in, as `openTown.ts` paints them. */
const WALL: Kind = 8;
const RIBS: Kind = 6;
const ALT: Kind = 5;

const TRIM: Kind = 13;
const ACCENT: Kind = 7;

const BRICK: Kind = 1;
const GLASS: Kind = 3;

const PLAIN: Tint = [1, 1, 1];

/** A face tilted up more than this is a roof, and keeps its concrete. */
const ROOF_TILT = 0.7;
/** How much of its walls' colour a concrete building's roof takes. */
const ROOF_SHARE = 0.55;
/** The roofs over glass, and the darker felt over brick. */
const GLASS_ROOF: Tint = [0.82, 0.84, 0.87];
const BRICK_ROOF: Tint = [0.66, 0.61, 0.57];

const roofOf = (tint: Tint): Tint => [
  1 + (tint[0] - 1) * ROOF_SHARE,
  1 + (tint[1] - 1) * ROOF_SHARE,
  1 + (tint[2] - 1) * ROOF_SHARE,
];

const concrete = (id: string, share: number, tint: Tint): Livery => ({
  id,
  share,
  wall: { tint },
  ribs: { tint },
  alt: { tint },
  roof: roofOf(tint),
});

/** Dark walls over a paler podium and plates. */
const stone = (
  id: string,
  share: number,
  tint: Tint,
  from: number,
): Livery => ({
  id,
  share,
  from,
  wall: { tint },
  ribs: { tint },
  alt: { tint: [1.1, 1.1, 1.1] },
  roof: roofOf(tint),
});

/** Glass walls, with the podium and the plates left in concrete. */
const glass = (
  id: string,
  share: number,
  tint: Tint,
  from: number,
): Livery => ({
  id,
  share,
  from,
  wall: { kind: GLASS, tint },
  ribs: { kind: GLASS, tint: [tint[0] * 0.8, tint[1] * 0.8, tint[2] * 0.8] },
  alt: { tint: [0.9, 0.9, 0.92] },
  roof: GLASS_ROOF,
});

/** Brick walls, banded where the model is ribbed, on pale stone. */
const brick = (id: string, share: number, tint: Tint, to: number): Livery => ({
  id,
  share,
  to,
  wall: { kind: BRICK, tint },
  ribs: { tint },
  alt: { tint: [1.25, 1.2, 1.1] },
  roof: BRICK_ROOF,
});

const cast = (tint: Tint): Finish => ({ tint });
/** Cast concrete with no ribs, for a ribbed mass that is to read as plain bands. */
const flat = (tint: Tint): Finish => ({ kind: WALL, tint });
const ribbed = (tint: Tint): Finish => ({ kind: RIBS, tint });
const glazed = (tint: Tint): Finish => ({ kind: GLASS, tint });
const bricked = (tint: Tint): Finish => ({ kind: BRICK, tint });

const WHITE: Tint = [1.12, 1.12, 1.12];
const SAND: Tint = [0.96, 0.84, 0.66];
const SLATE: Tint = [0.5, 0.53, 0.58];
const CHARCOAL: Tint = [0.27, 0.28, 0.31];
const BLUE: Tint = [0.26, 0.44, 0.72];
const TEAL: Tint = [0.26, 0.52, 0.5];
const SMOKE: Tint = [0.17, 0.21, 0.27];
const BRONZE: Tint = [0.52, 0.4, 0.27];
const RED: Tint = [0.7, 0.38, 0.3];
const TERRACOTTA: Tint = [0.82, 0.52, 0.36];
const VERDIGRIS: Tint = [0.46, 0.7, 0.62];

/** A building whose masses are of different materials. */
const mixed = (
  id: string,
  share: number,
  heights: { from?: number; to?: number },
  parts: Pick<Livery, "wall" | "ribs" | "alt" | "roof" | "trim" | "accent">,
): Livery => ({ id, share, ...heights, ...parts });

/**
 * The liveries of an open town. Brick is for the lower buildings and glass for
 * the towers, as in a city that grew over a century. The mixed ones give one
 * model's masses different materials, so two copies of a model can share
 * nothing but their outline.
 */
export const LIVERIES: readonly Livery[] = [
  concrete("pale", 0.14, PLAIN),
  concrete("cool", 0.12, [0.84, 0.86, 0.9]),
  concrete("sand", 0.1, SAND),
  concrete("ochre", 0.06, [0.84, 0.64, 0.46]),
  concrete("slate", 0.1, SLATE),
  stone("charcoal", 0.1, CHARCOAL, 0.5),
  glass("blue-glass", 0.16, BLUE, 0.6),
  glass("green-glass", 0.09, TEAL, 0.6),
  glass("smoke-glass", 0.1, SMOKE, 0.9),
  glass("bronze-glass", 0.05, BRONZE, 0.9),
  brick("red-brick", 0.2, RED, 0.9),
  brick("brown-brick", 0.12, [0.74, 0.55, 0.38], 0.9),
  brick("dark-brick", 0.08, [0.46, 0.29, 0.25], 1.2),
  // Concrete with glass where the model is ribbed: strip windows.
  mixed(
    "strip-glass",
    0.08,
    {},
    {
      wall: cast(PLAIN),
      ribs: glazed(BLUE),
      alt: cast([0.8, 0.82, 0.86]),
      roof: PLAIN,
    },
  ),
  // Ribs over every wall, pale and dark.
  mixed(
    "ribbed-pale",
    0.07,
    {},
    {
      wall: ribbed(PLAIN),
      ribs: ribbed(SAND),
      alt: cast(SLATE),
      roof: PLAIN,
    },
  ),
  mixed(
    "ribbed-dark",
    0.06,
    { from: 0.5 },
    {
      wall: ribbed(SLATE),
      ribs: ribbed(CHARCOAL),
      alt: cast(WHITE),
      roof: roofOf(SLATE),
    },
  ),
  // Pale walls with dark bands where the model is ribbed.
  mixed(
    "banded",
    0.07,
    {},
    {
      wall: cast(WHITE),
      ribs: flat(CHARCOAL),
      alt: cast(SLATE),
      roof: PLAIN,
    },
  ),
  // A glass tower on a brick podium, as one built over an older block.
  mixed(
    "glass-on-brick",
    0.07,
    { from: 0.6, to: 1.8 },
    {
      wall: glazed(BLUE),
      ribs: glazed(SMOKE),
      alt: bricked(RED),
      roof: GLASS_ROOF,
    },
  ),
  // Brick with dark glass where the model is ribbed.
  mixed(
    "brick-and-glass",
    0.08,
    { to: 1.2 },
    {
      wall: bricked(RED),
      ribs: glazed(SMOKE),
      alt: cast(WHITE),
      roof: BRICK_ROOF,
    },
  ),
  // Terracotta with plain pale bands and teal panels.
  mixed(
    "terracotta",
    0.07,
    { to: 1.5 },
    {
      wall: bricked(TERRACOTTA),
      ribs: flat(WHITE),
      alt: cast(WHITE),
      roof: BRICK_ROOF,
      accent: { tint: [0.45, 0.95, 1.2] },
    },
  ),
  // White walls, black glass and a dark podium.
  mixed(
    "white-and-black",
    0.07,
    { from: 0.5 },
    {
      wall: cast(WHITE),
      ribs: glazed(SMOKE),
      alt: cast(CHARCOAL),
      roof: PLAIN,
    },
  ),
  // Black glass with pale bands in place of the dark metal.
  mixed(
    "black-and-white",
    0.06,
    { from: 0.9 },
    {
      wall: glazed(SMOKE),
      ribs: glazed(SMOKE),
      alt: cast(WHITE),
      roof: GLASS_ROOF,
      trim: { kind: ACCENT, tint: [3.2, 3.2, 3.1] },
    },
  ),
  // Pale stone under copper gone green: its plates and its roofs.
  mixed(
    "verdigris",
    0.07,
    {},
    {
      wall: cast([0.98, 0.93, 0.82]),
      ribs: cast(SAND),
      alt: cast(VERDIGRIS),
      roof: VERDIGRIS,
    },
  ),
  // Teal glass with sand plates and mustard panels.
  mixed(
    "teal-and-sand",
    0.05,
    { from: 0.6 },
    {
      wall: glazed(TEAL),
      ribs: ribbed(SAND),
      alt: cast(SAND),
      roof: GLASS_ROOF,
      accent: { tint: [1.25, 1.25, 0.7] },
    },
  ),
  // Dark stone with bronze glass where the model is ribbed.
  mixed(
    "bronze-frame",
    0.05,
    { from: 0.5 },
    {
      wall: cast(CHARCOAL),
      ribs: glazed(BRONZE),
      alt: cast([0.84, 0.64, 0.46]),
      roof: roofOf(CHARCOAL),
    },
  ),
];

/** The livery for a number from 0 to 1 and a model of `height`. */
export function liveryFor(pick: number, height: number): Livery {
  const allowed = LIVERIES.filter(
    (l) =>
      (l.from === undefined || height >= l.from) &&
      (l.to === undefined || height <= l.to),
  );
  const total = allowed.reduce((sum, l) => sum + l.share, 0);
  let upTo = 0;
  for (const l of allowed) {
    upTo += l.share / total;
    if (pick < upTo) return l;
  }
  return allowed[allowed.length - 1];
}

/**
 * Dress one copy of a model: multiply its colours by `shade`, and give its
 * walls the livery's surface and colour. With no livery only the shade is
 * applied, as on a sealed outpost.
 */
export function dress(
  copy: THREE.BufferGeometry,
  shade: number,
  livery?: Livery,
): void {
  const colour = copy.getAttribute("color");
  const kind = copy.getAttribute("kind");
  const normal = copy.getAttribute("normal");
  const size = colour.itemSize;
  for (let i = 0; i < colour.count; i++) {
    const built = kind.getX(i);
    const finish = !livery
      ? undefined
      : built === WALL
        ? livery.wall
        : built === RIBS
          ? livery.ribs
          : built === ALT
            ? livery.alt
            : built === TRIM
              ? livery.trim
              : built === ACCENT
                ? livery.accent
                : undefined;
    // Trim has no roof to speak of, so it is one finish all over.
    const roof =
      built !== TRIM && built !== ACCENT && normal.getY(i) > ROOF_TILT;
    if (finish?.kind !== undefined && !roof) kind.setX(i, finish.kind);
    const tint = !finish ? PLAIN : roof && livery ? livery.roof : finish.tint;
    for (let c = 0; c < 3; c++) colour.array[i * size + c] *= shade * tint[c];
  }
}
