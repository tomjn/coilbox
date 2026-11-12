/**
 * What a sealed outpost's structures are painted in. Each sealed planet has a
 * few colourways: one or two common ones that give its outposts their
 * character, and a rare bolder one. A structure is built in one colourway,
 * and the planet comes through in the dust that settles on it.
 *
 * Colours are factory paint, so unlike an open town's liveries they are not
 * multiplied by the planet's wall colour. Every colour here is a first guess,
 * in sRGB, to be tuned on screen.
 */
import type { PlanetId } from "../../planets";
import { type Rgb, type Stain, smooth } from "../landmarks/kit";
import { townPalette } from "../landmarks/palettes";

export type SealedPlanetId = "red" | "moon" | "volcanic" | "acid";

export type OutpostFamily =
  | "dome"
  | "deck"
  | "stacked"
  | "spire"
  | "saucer"
  | "fortress"
  | "capsule"
  | "research"
  | "utility";

export interface Colourway {
  id: string;
  /** How many structures take it, beside the other colourways that suit them. */
  share: number;
  /** The families it suits. Left out for every family. */
  families?: readonly OutpostFamily[];
  /** The main masses, and the masses set against them. */
  hull: Rgb;
  hull2: Rgb;
  /** Painted bands, panels and frames. */
  accent: Rgb;
  /** Dark metal in recesses, bands and plates. */
  trim: Rgb;
  /** Bare metal: masts, rails, pipes. */
  metal: Rgb;
  glass: Rgb;
  /** The paint of the hazard stripes, laid over near black. */
  stripe: Rgb;
}

/** A colourway with what settles on a structure on its planet. */
export interface OutpostPaint extends Colourway {
  top: Rgb;
  topCover: number;
  /** Dust drifted against the foot of each wall. */
  dust: Stain[];
}

/** How high up a wall the dust reaches. */
const DUST_HEIGHT = 0.3;

const WHITE_ORANGE: Colourway = {
  id: "white-orange",
  share: 4,
  hull: [226, 226, 222],
  hull2: [196, 198, 200],
  accent: [214, 112, 40],
  trim: [62, 64, 68],
  metal: [150, 152, 156],
  glass: [70, 90, 110],
  stripe: [222, 150, 40],
};

const COPPER: Colourway = {
  id: "copper",
  share: 1,
  hull: [176, 108, 70],
  hull2: [150, 90, 60],
  accent: [214, 196, 170],
  trim: [64, 50, 44],
  metal: [160, 120, 90],
  glass: [60, 74, 86],
  stripe: [214, 170, 60],
};

export const OUTPOST_COLOURWAYS: Record<SealedPlanetId, readonly Colourway[]> =
  {
    moon: [
      WHITE_ORANGE,
      {
        id: "white-blue",
        share: 2,
        hull: [222, 224, 226],
        hull2: [150, 162, 176],
        accent: [92, 112, 138],
        trim: [58, 62, 70],
        metal: [146, 150, 156],
        glass: [64, 86, 112],
        stripe: [220, 170, 50],
      },
      {
        id: "grey-yellow",
        share: 2,
        hull: [184, 186, 186],
        hull2: [140, 142, 144],
        accent: [222, 178, 48],
        trim: [52, 54, 58],
        metal: [140, 142, 146],
        glass: [60, 80, 96],
        stripe: [226, 182, 44],
      },
      {
        id: "graphite-orange",
        share: 1,
        hull: [78, 80, 84],
        hull2: [110, 112, 116],
        accent: [220, 118, 40],
        trim: [40, 42, 46],
        metal: [130, 132, 136],
        glass: [80, 100, 120],
        stripe: [226, 130, 40],
      },
    ],
    red: [
      {
        id: "cream-terracotta",
        share: 4,
        hull: [222, 210, 188],
        hull2: [190, 176, 156],
        accent: [176, 84, 52],
        trim: [70, 58, 52],
        metal: [150, 140, 130],
        glass: [70, 84, 96],
        stripe: [210, 140, 50],
      },
      { ...COPPER, share: 2, families: ["dome", "capsule"] },
      { ...WHITE_ORANGE, share: 2 },
      {
        id: "grey-rust",
        share: 2,
        hull: [160, 156, 150],
        hull2: [126, 120, 114],
        accent: [150, 74, 46],
        trim: [58, 54, 52],
        metal: [138, 132, 126],
        glass: [64, 78, 90],
        stripe: [204, 150, 52],
      },
      {
        id: "bronze",
        share: 1,
        hull: [146, 112, 70],
        hull2: [112, 88, 58],
        accent: [218, 206, 180],
        trim: [52, 44, 36],
        metal: [170, 140, 100],
        glass: [74, 82, 90],
        stripe: [214, 170, 60],
      },
    ],
    volcanic: [
      {
        id: "gunmetal-yellow",
        share: 4,
        hull: [92, 96, 100],
        hull2: [70, 74, 78],
        accent: [226, 184, 40],
        trim: [40, 40, 42],
        metal: [128, 130, 134],
        glass: [70, 80, 90],
        stripe: [228, 186, 38],
      },
      {
        id: "grey-orange",
        share: 2,
        hull: [150, 152, 154],
        hull2: [110, 112, 116],
        accent: [212, 110, 38],
        trim: [48, 48, 50],
        metal: [136, 138, 142],
        glass: [70, 84, 96],
        stripe: [226, 150, 40],
      },
      {
        id: "soot-red",
        share: 2,
        hull: [52, 50, 50],
        hull2: [76, 72, 70],
        accent: [176, 44, 36],
        trim: [30, 30, 32],
        metal: [120, 118, 118],
        glass: [90, 70, 60],
        stripe: [220, 170, 44],
      },
      {
        id: "pale-grey",
        share: 1,
        hull: [200, 200, 198],
        hull2: [160, 160, 160],
        accent: [212, 110, 38],
        trim: [56, 56, 58],
        metal: [150, 152, 154],
        glass: [70, 84, 96],
        stripe: [226, 182, 44],
      },
    ],
    acid: [
      {
        id: "green-teal",
        share: 4,
        hull: [196, 204, 192],
        hull2: [160, 170, 160],
        accent: [40, 140, 140],
        trim: [54, 62, 60],
        metal: [146, 152, 148],
        glass: [60, 96, 96],
        stripe: [222, 200, 60],
      },
      {
        id: "white-yellow",
        share: 2,
        hull: [224, 226, 220],
        hull2: [186, 190, 186],
        accent: [222, 190, 48],
        trim: [58, 62, 62],
        metal: [148, 150, 150],
        glass: [64, 90, 96],
        stripe: [224, 192, 44],
      },
      {
        id: "gunmetal-lime",
        share: 2,
        hull: [88, 94, 92],
        hull2: [66, 72, 70],
        accent: [150, 196, 60],
        trim: [38, 42, 42],
        metal: [128, 134, 132],
        glass: [70, 96, 90],
        stripe: [170, 206, 60],
      },
      COPPER,
    ],
  };

export const isSealedPlanet = (
  planet: PlanetId | undefined,
): planet is SealedPlanetId =>
  planet !== undefined && planet in OUTPOST_COLOURWAYS;

/** One of the colourways that suit `family`, weighted by share, for `pick` from 0 to 1. */
export function colourwayFor(
  planet: SealedPlanetId,
  family: OutpostFamily,
  pick: number,
): Colourway {
  const all = OUTPOST_COLOURWAYS[planet];
  const suited = all.filter((c) => !c.families || c.families.includes(family));
  // A planet always has a colourway for every family, but one limited to a
  // family it does not suit is never the only choice.
  const allowed = suited.length > 0 ? suited : all;
  const total = allowed.reduce((sum, c) => sum + c.share, 0);
  let upTo = 0;
  for (const c of allowed) {
    upTo += c.share / total;
    if (pick < upTo) return c;
  }
  return allowed[allowed.length - 1];
}

/** A colourway as it is painted on `planet`, under its dust. */
export function outpostPaint(
  planet: SealedPlanetId,
  colourway: Colourway,
): OutpostPaint {
  const { top, topCover } = townPalette(planet);
  return {
    ...colourway,
    top,
    topCover,
    dust: [{ colour: top, at: (_x, y) => 1 - smooth(0, DUST_HEIGHT, y) }],
  };
}
