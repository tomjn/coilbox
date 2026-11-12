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

/** The standing anomalies: the monolith, shard, gate, overhang and stump. */
export interface AnomalyPalette {
  /** Dark stone and old plate. */
  slate: Rgb;
  /** Pale cast stone. */
  concrete: Rgb;
  /** What has bled down them. */
  rust: Rgb;
  /** The dull green of old copper. */
  oxide: Rgb;
  /** The ground heaped at the foot, and the rubble. */
  rock: Rgb;
  top: Rgb;
  topCover: number;
}

/** What a depot takes from its planet. Its paint is in {@link DEPOT_LIVERIES}. */
export interface DepotPalette {
  /** The cast slabs it stands on. */
  pad: Rgb;
  /** Bare metal: frames, masts, pipes. */
  metal: Rgb;
  /** What settles on it: moss, sand, snow, ash. */
  top: Rgb;
  topCover: number;
}

/** The paint a depot wears, the same on every planet. A depot's seed picks one. */
export interface DepotLivery {
  /** The broad panels. */
  shell: Rgb;
  /** Bands, end caps and fins. */
  accent: Rgb;
}
export const DEPOT_LIVERIES: readonly DepotLivery[] = [
  { shell: [214, 210, 200], accent: [204, 104, 44] },
  { shell: [206, 212, 218], accent: [48, 92, 146] },
  { shell: [210, 206, 198], accent: [164, 56, 46] },
  { shell: [88, 122, 108], accent: [206, 118, 48] },
  { shell: [186, 156, 72], accent: [70, 74, 80] },
];
const DEPOT_METAL: Rgb = [70, 74, 82];

/** A run's landing pad. Like a depot, only its stone and what settles on it are the planet's. */
export interface LandingPalette {
  /** The cast foundation and footings. */
  pad: Rgb;
  /** Bare metal: the frame, the pedestal, the masts. */
  metal: Rgb;
  /** The deck's plate. */
  deck: Rgb;
  /** The towers' paint. */
  shell: Rgb;
  /** The deck's markings and the towers' band. */
  mark: Rgb;
  top: Rgb;
  topCover: number;
}
const LANDING_DECK: Rgb = [164, 168, 170];
const LANDING_SHELL: Rgb = [190, 192, 190];
const LANDING_MARK: Rgb = [58, 106, 172];

export const ANOMALY_PALETTES: Record<PlanetId, AnomalyPalette> = {
  temperate: {
    slate: [78, 80, 88],
    concrete: [150, 150, 144],
    rust: [150, 84, 48],
    oxide: [84, 122, 112],
    rock: [112, 104, 92],
    top: [92, 118, 62],
    topCover: 0.5,
  },
  desert: {
    slate: [96, 84, 74],
    concrete: [186, 164, 130],
    rust: [168, 92, 50],
    oxide: [104, 130, 112],
    rock: [158, 124, 92],
    top: [214, 190, 140],
    topCover: 0.4,
  },
  ice: {
    slate: [74, 82, 94],
    concrete: [150, 160, 168],
    rust: [120, 90, 74],
    oxide: [88, 128, 132],
    rock: [100, 102, 110],
    top: [238, 242, 246],
    topCover: 0.65,
  },
  red: {
    slate: [84, 58, 52],
    concrete: [156, 108, 86],
    rust: [170, 84, 50],
    oxide: [104, 112, 96],
    rock: [110, 66, 50],
    top: [176, 98, 66],
    topCover: 0.35,
  },
  moon: {
    slate: [58, 58, 64],
    concrete: [140, 140, 142],
    rust: [110, 104, 100],
    oxide: [96, 108, 110],
    rock: [104, 104, 110],
    top: [180, 180, 186],
    topCover: 0.2,
  },
  volcanic: {
    slate: [50, 42, 40],
    concrete: [120, 94, 74],
    rust: [150, 74, 40],
    oxide: [84, 96, 84],
    rock: [78, 60, 50],
    top: [62, 46, 38],
    topCover: 0.25,
  },
  acid: {
    slate: [70, 72, 56],
    concrete: [150, 142, 104],
    rust: [128, 120, 52],
    oxide: [96, 120, 84],
    rock: [104, 96, 80],
    top: [150, 142, 88],
    topCover: 0.25,
  },
};

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

/** What a town takes from its planet. */
export interface TownPalette {
  /** The buildings' walls. */
  building: Rgb;
  /** The streets, darker than the walls. */
  street: Rgb;
  /** Recesses, cores and bands: the dark metal between two masses. */
  dark: Rgb;
  /** A few painted panels, the planet's wall colour pulled towards rust. */
  accent: Rgb;
  /** What settles on the roofs: moss, sand, snow, ash. */
  top: Rgb;
  topCover: number;
  /** The slab each lot stands on, paler than the streets. */
  pavement: Rgb;
  /** Grass in a park or on a pitch, and the trees over it. */
  grass: Rgb;
  tree: Rgb;
}

/** How dark the streets and the pavements are beside the stronghold's concrete. */
const TOWN_STREET = 0.42;
const TOWN_PAVEMENT = 0.8;

/**
 * What grows in a town on the planets whose towns stand in the open: grass and
 * the trees over it. The other planets' towns are sealed and have no parks.
 */
const TOWN_PLANTS: Partial<Record<PlanetId, { grass: Rgb; tree: Rgb }>> = {
  temperate: { grass: [104, 138, 74], tree: [76, 114, 62] },
  desert: { grass: [150, 146, 92], tree: [108, 124, 72] },
  ice: { grass: [206, 214, 216], tree: [84, 112, 100] },
};

/** How far a town's walls are lifted from the stronghold's concrete towards white. */
const TOWN_PALE = 0.35;

/** The paint a town's accent panels start from, and how far they are pulled to it. */
const TOWN_RUST: Rgb = [170, 88, 56];
const TOWN_ACCENT = 0.6;

const townFrom = (
  { concrete, trim, top, topCover }: StrongholdPalette,
  plants: { grass: Rgb; tree: Rgb } = { grass: top, tree: trim },
): TownPalette => ({
  building: [
    Math.round(concrete[0] + (255 - concrete[0]) * TOWN_PALE),
    Math.round(concrete[1] + (255 - concrete[1]) * TOWN_PALE),
    Math.round(concrete[2] + (255 - concrete[2]) * TOWN_PALE),
  ],
  dark: trim,
  accent: [
    Math.round(concrete[0] + (TOWN_RUST[0] - concrete[0]) * TOWN_ACCENT),
    Math.round(concrete[1] + (TOWN_RUST[1] - concrete[1]) * TOWN_ACCENT),
    Math.round(concrete[2] + (TOWN_RUST[2] - concrete[2]) * TOWN_ACCENT),
  ],
  street: [
    Math.round(concrete[0] * TOWN_STREET),
    Math.round(concrete[1] * TOWN_STREET),
    Math.round(concrete[2] * (TOWN_STREET + 0.02)),
  ],
  pavement: [
    Math.round(concrete[0] * TOWN_PAVEMENT),
    Math.round(concrete[1] * TOWN_PAVEMENT),
    Math.round(concrete[2] * TOWN_PAVEMENT),
  ],
  top,
  topCover,
  ...plants,
});

export const TOWN_PALETTES: Record<PlanetId, TownPalette> = {
  temperate: townFrom(STRONGHOLD_PALETTES.temperate, TOWN_PLANTS.temperate),
  desert: townFrom(STRONGHOLD_PALETTES.desert, TOWN_PLANTS.desert),
  ice: townFrom(STRONGHOLD_PALETTES.ice, TOWN_PLANTS.ice),
  red: townFrom(STRONGHOLD_PALETTES.red),
  moon: townFrom(STRONGHOLD_PALETTES.moon),
  volcanic: townFrom(STRONGHOLD_PALETTES.volcanic),
  acid: townFrom(STRONGHOLD_PALETTES.acid),
};

/** A moon has no history for a castle to be a ruin of, so it has none. */
export const RUIN_PALETTES: Record<Exclude<PlanetId, "moon">, RuinPalette> = {
  temperate: {
    stone: [188, 168, 130],
    darkStone: [130, 114, 90],
    rock: [112, 104, 92],
    top: [92, 118, 62],
    topCover: 0.5,
  },
  desert: {
    stone: [214, 188, 146],
    darkStone: [168, 142, 108],
    rock: [158, 124, 92],
    top: [214, 190, 140],
    topCover: 0.4,
  },
  ice: {
    stone: [196, 198, 204],
    darkStone: [150, 152, 160],
    rock: [100, 102, 110],
    top: [238, 242, 246],
    topCover: 0.65,
  },
  red: {
    stone: [178, 118, 90],
    darkStone: [134, 88, 68],
    rock: [110, 66, 50],
    top: [176, 98, 66],
    topCover: 0.35,
  },
  volcanic: {
    stone: [148, 120, 98],
    darkStone: [104, 86, 72],
    rock: [78, 60, 50],
    top: [62, 46, 38],
    topCover: 0.25,
  },
  acid: {
    stone: [168, 156, 116],
    darkStone: [108, 100, 78],
    rock: [104, 96, 80],
    top: [150, 142, 88],
    topCover: 0.25,
  },
};

/** A map with no planet, which is a hand-made one, is drawn as Temperate. */
export const strongholdPalette = (planet?: PlanetId): StrongholdPalette =>
  STRONGHOLD_PALETTES[planet ?? "temperate"];

export const townPalette = (planet?: PlanetId): TownPalette =>
  TOWN_PALETTES[planet ?? "temperate"];

export const ruinPalette = (planet?: PlanetId): RuinPalette | undefined =>
  planet === "moon" ? undefined : RUIN_PALETTES[planet ?? "temperate"];

export const anomalyPalette = (planet?: PlanetId): AnomalyPalette =>
  ANOMALY_PALETTES[planet ?? "temperate"];

/** A depot stands on the planet's own cast stone and wears what settles there. */
export const depotPalette = (planet?: PlanetId): DepotPalette => {
  const { armour, top, topCover } = strongholdPalette(planet);
  return { pad: armour, metal: DEPOT_METAL, top, topCover };
};

/** A landing pad stands on the planet's own cast stone, as a depot does. */
export const landingPalette = (planet?: PlanetId): LandingPalette => {
  const { armour, top, topCover } = strongholdPalette(planet);
  return {
    pad: armour,
    metal: DEPOT_METAL,
    deck: LANDING_DECK,
    shell: LANDING_SHELL,
    mark: LANDING_MARK,
    top,
    topCover,
  };
};
