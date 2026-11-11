/**
 * The colours of each landmark on each planet. A landmark takes the planet's
 * cast all over, so it reads as built from the planet's own ground. These are
 * chosen for the landmarks alone and take nothing from the towns.
 */
import type { PlanetId } from "../../planets";
import type { Rgb } from "./kit";

export interface StrongholdPalette {
  /** The cast walls and decks. */
  concrete: Rgb;
  /** The plates and buttresses on them. */
  armour: Rgb;
  /** Lips, masts, frames: the darkest parts. */
  trim: Rgb;
  /** The crag. */
  rock: Rgb;
  /** What settles on the crag: moss, sand, snow, ash. */
  top: Rgb;
  topCover: number;
  /** The few small lit points. */
  lamp: Rgb;
}

export interface RuinPalette {
  stone: Rgb;
  /** Footings, courses and the inside of broken walls. */
  darkStone: Rgb;
  /** The mound and the rubble. */
  rock: Rgb;
  top: Rgb;
  topCover: number;
}

export const STRONGHOLD_PALETTES: Record<PlanetId, StrongholdPalette> = {
  temperate: {
    concrete: [160, 154, 140],
    armour: [130, 126, 116],
    trim: [56, 60, 66],
    rock: [112, 104, 92],
    top: [92, 118, 62],
    topCover: 0.45,
    lamp: [255, 226, 170],
  },
  desert: {
    concrete: [178, 156, 122],
    armour: [150, 130, 102],
    trim: [62, 54, 46],
    rock: [158, 124, 92],
    top: [214, 190, 140],
    topCover: 0.35,
    lamp: [255, 220, 160],
  },
  ice: {
    concrete: [170, 176, 182],
    armour: [138, 144, 152],
    trim: [52, 58, 66],
    rock: [100, 102, 110],
    top: [236, 240, 246],
    topCover: 0.6,
    lamp: [220, 236, 255],
  },
  red: {
    concrete: [150, 104, 82],
    armour: [124, 86, 70],
    trim: [52, 38, 34],
    rock: [110, 66, 50],
    top: [176, 98, 66],
    topCover: 0.3,
    lamp: [255, 190, 140],
  },
  moon: {
    concrete: [154, 152, 150],
    armour: [126, 124, 122],
    trim: [50, 50, 56],
    rock: [104, 104, 110],
    top: [180, 180, 186],
    topCover: 0.2,
    lamp: [230, 230, 255],
  },
  volcanic: {
    concrete: [124, 94, 70],
    armour: [104, 80, 64],
    trim: [48, 38, 34],
    rock: [50, 42, 40],
    top: [62, 46, 38],
    topCover: 0.25,
    lamp: [255, 186, 110],
  },
  acid: {
    concrete: [146, 138, 104],
    armour: [120, 112, 86],
    trim: [50, 48, 38],
    rock: [104, 96, 80],
    top: [150, 142, 88],
    topCover: 0.35,
    lamp: [240, 236, 170],
  },
};

export const RUIN_PALETTES: Record<PlanetId, RuinPalette> = {
  temperate: {
    stone: [188, 168, 130],
    darkStone: [130, 114, 90],
    rock: [112, 104, 92],
    top: [92, 118, 62],
    topCover: 0.5,
  },
  desert: {
    stone: [190, 164, 124],
    darkStone: [150, 126, 96],
    rock: [158, 124, 92],
    top: [214, 190, 140],
    topCover: 0.4,
  },
  ice: {
    stone: [160, 164, 170],
    darkStone: [120, 124, 132],
    rock: [100, 102, 110],
    top: [238, 242, 246],
    topCover: 0.65,
  },
  red: {
    stone: [150, 96, 74],
    darkStone: [112, 72, 58],
    rock: [110, 66, 50],
    top: [176, 98, 66],
    topCover: 0.35,
  },
  moon: {
    stone: [150, 150, 154],
    darkStone: [112, 112, 118],
    rock: [104, 104, 110],
    top: [186, 186, 190],
    topCover: 0.25,
  },
  volcanic: {
    stone: [148, 120, 98],
    darkStone: [104, 86, 72],
    rock: [78, 60, 50],
    top: [62, 46, 38],
    topCover: 0.25,
  },
  acid: {
    stone: [140, 130, 98],
    darkStone: [108, 100, 78],
    rock: [104, 96, 80],
    top: [150, 142, 88],
    topCover: 0.4,
  },
};

/** A map with no planet, which is a hand-made one, is drawn as Temperate. */
export const strongholdPalette = (planet?: PlanetId): StrongholdPalette =>
  STRONGHOLD_PALETTES[planet ?? "temperate"];

export const ruinPalette = (planet?: PlanetId): RuinPalette =>
  RUIN_PALETTES[planet ?? "temperate"];
