import { hashString, mulberry32, pick } from "./rng";

/** Colour in sRGB, each channel 0 to 255. */
export type Rgb = [number, number, number];

export type PlanetId =
  | "temperate"
  | "desert"
  | "ice"
  | "red"
  | "moon"
  | "volcanic"
  | "acid";

export const PLANETS: readonly PlanetId[] = [
  "temperate",
  "desert",
  "ice",
  "red",
  "moon",
  "volcanic",
  "acid",
];

export const isPlanetId = (value: unknown): value is PlanetId =>
  typeof value === "string" && (PLANETS as readonly string[]).includes(value);

/** How many ground types the terrain shader can mix. */
export const BIOME_SLOTS = 8;

/** The pattern the terrain shader draws a slot with. See `terrainShader.ts`. */
export type BiomePattern =
  | "forest"
  | "grass"
  | "scrub"
  | "sand"
  | "dunes"
  | "dust"
  | "regolith"
  | "rock"
  | "scree"
  | "mesa"
  | "salt"
  | "basalt"
  | "flows"
  | "ash"
  | "ice"
  | "snow"
  | "tundra"
  | "cracked"
  | "earth";

export interface Biome {
  name: string;
  colour: Rgb;
  farm: boolean;
  pattern: BiomePattern;
}

export type SeaLook = "water" | "acid" | "lava" | "ice" | "basin" | "maria";

/**
 * How a planet's settlements are laid out. `organic` and `compound` stand
 * in the open air. `sealed` is domes and modules joined by tubes.
 */
export type SettlementStyle = "organic" | "compound" | "sealed";

/**
 * What a planet's settlements and roads look like. Display only. Every
 * colour here is a first guess, in sRGB.
 */
export interface Settlement {
  style: SettlementStyle;
  /** For `sealed`: the share of structures that are domes, 0 to 1. */
  domes: number;
  /** Most roofs and hulls. */
  hull: Rgb;
  /** The second colour: glass, a dome's skin, a shed's roof. */
  trim: Rgb;
  /**
   * What lies round a settlement: `farms` where the ground can be farmed,
   * `works` for solar arrays, greenhouses and pads on any flat ground, or
   * `none`.
   */
  outskirts: "farms" | "works" | "none";
  roads: {
    /**
     * `open` is a dirt track, a minor road and a surfaced main road.
     * `sealed` is wheel ruts, a graded way and a transit tube.
     */
    look: "open" | "sealed";
    /** The surface of each, from the least used to the most. */
    track: Rgb;
    minor: Rgb;
    main: Rgb;
  };
}

export interface Planet {
  id: PlanetId;
  label: string;
  /** 1 to 8 ground types. */
  biomes: readonly Biome[];
  /** Slot a coast pixel on the sea side mixes towards. */
  shore: number;
  /** Colours steep ground shows, darker then lighter, in sRGB. */
  steep: [Rgb, Rgb];
  /** Colour of a clearing in a `forest` pattern slot, in sRGB. */
  clearing: Rgb;
  /** Added to moisture and to cold before the rule runs. */
  climate: { wet: number; cold: number };
  /**
   * Fill `out` (length 8) with shares summing to 1. `h`, `wet`, `cold` are 0 to
   * 1, and so is `inland`: 0 at the coast and 1 from 40 pixels in.
   */
  weights(
    h: number,
    wet: number,
    cold: number,
    out: Float64Array,
    inland: number,
  ): void;
  sea: {
    look: SeaLook;
    shallow: Rgb;
    deep: Rgb;
    crossing: "lane" | "solid" | "none";
  };
  craters: boolean;
  settlement: Settlement;
}

/**
 * Patterns of ground too dry to farm without water brought to it. Fields on
 * a farm slot with one of these are drawn as dry country's are: irrigated
 * plots, fallow ones, groves and vines, on levelled earth.
 */
const DRY_PATTERNS: readonly BiomePattern[] = [
  // Not dunes. Nothing is farmed on them.
  "scrub",
  "sand",
  "dust",
];

/** True for a farm slot whose ground is dry. */
export const farmsDry = (biome: Biome): boolean =>
  biome.farm && DRY_PATTERNS.includes(biome.pattern);

/** Scale every share by `1 - t` and add `t` to `slot`. */
export function blend(out: Float64Array, slot: number, t: number): void {
  for (let i = 0; i < out.length; i++) out[i] *= 1 - t;
  out[slot] += t;
}

/**
 * The rules use only add, subtract, multiply, divide and comparisons, so every
 * platform gets the same shares for the same inputs.
 */
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** How far `v` has got from `start`, over `span`, 0 to 1. */
const ramp = (v: number, start: number, span: number) =>
  clamp01((v - start) / span);

const biome = (
  name: string,
  colour: Rgb,
  pattern: BiomePattern,
  farm = false,
): Biome => ({
  name,
  colour,
  farm,
  pattern,
});

const TEMPERATE: Planet = {
  id: "temperate",
  label: "Temperate",
  biomes: [
    biome("grass", [122, 154, 84], "grass", true),
    biome("dry", [182, 168, 116], "dunes"),
    biome("forest", [58, 98, 56], "forest"),
    biome("tundra", [146, 146, 122], "tundra"),
    biome("rock", [122, 106, 90], "rock"),
    biome("scree", [152, 146, 140], "scree"),
    biome("snow", [240, 240, 240], "snow"),
    biome("beach", [214, 200, 150], "sand"),
  ],
  shore: 7,
  steep: [
    [122, 106, 90],
    [152, 146, 140],
  ],
  clearing: [122, 154, 84],
  climate: { wet: 0, cold: 0 },
  weights(h, wet, cold, out) {
    out.fill(0);
    if (wet < 0.42) {
      const t = ramp(wet, 0.2, 0.18);
      out[1] = 1 - t;
      out[0] = t;
    } else {
      const t = ramp(wet, 0.48, 0.2);
      out[0] = 1 - t;
      out[2] = t;
    }
    blend(out, 3, cold);
    blend(out, 4, ramp(h, 0.42, 0.15));
    blend(out, 5, ramp(h, 0.66, 0.14));
    blend(out, 6, ramp(h, 0.84 - 0.25 * cold, 0.08));
    blend(out, 7, 1 - ramp(h, 0, 0.015));
  },
  sea: {
    look: "water",
    shallow: [70, 140, 170],
    deep: [24, 58, 96],
    crossing: "lane",
  },
  craters: false,
  settlement: {
    style: "organic",
    domes: 0,
    hull: [140, 134, 128],
    trim: [104, 106, 112],
    outskirts: "farms",
    roads: {
      look: "open",
      track: [222, 206, 170],
      minor: [196, 190, 178],
      main: [104, 104, 106],
    },
  },
};

const DESERT: Planet = {
  id: "desert",
  label: "Desert",
  biomes: [
    biome("dunes", [214, 186, 128], "dunes"),
    biome("rock flats", [168, 138, 104], "scree"),
    biome("mesa", [150, 96, 70], "mesa"),
    biome("scrub", [150, 148, 96], "scrub", true),
    biome("salt pan", [226, 220, 204], "salt"),
    biome("beach", [222, 206, 160], "sand"),
  ],
  shore: 5,
  steep: [
    [150, 96, 70],
    [168, 138, 104],
  ],
  clearing: [150, 148, 96],
  climate: { wet: -0.35, cold: -0.2 },
  weights(h, wet, _cold, out, inland) {
    out.fill(0);
    const t = ramp(wet, 0.2, 0.4);
    out[0] = 1 - t;
    out[3] = t;
    // Salt lies where water once pooled and dried: the floors of dry basins
    // well back from the sea.
    blend(
      out,
      4,
      ramp(inland, 0.4, 0.3) *
        (1 - ramp(h, 0.11, 0.05)) *
        (1 - ramp(wet, 0.1, 0.2)),
    );
    blend(out, 1, ramp(h, 0.42, 0.15));
    blend(out, 2, ramp(h, 0.66, 0.14));
    blend(out, 5, 1 - ramp(h, 0, 0.015));
  },
  sea: {
    look: "water",
    shallow: [78, 150, 160],
    deep: [30, 78, 104],
    crossing: "lane",
  },
  craters: false,
  settlement: {
    style: "organic",
    domes: 0,
    hull: [214, 198, 172],
    trim: [176, 140, 110],
    outskirts: "farms",
    roads: {
      look: "open",
      track: [232, 214, 176],
      minor: [204, 190, 166],
      main: [112, 108, 104],
    },
  },
};

const ICE: Planet = {
  id: "ice",
  label: "Ice",
  biomes: [
    biome("snowfield", [238, 242, 246], "snow"),
    biome("bare ice", [176, 208, 224], "ice"),
    biome("tundra", [132, 138, 126], "tundra"),
    biome("rock", [104, 104, 110], "rock"),
  ],
  shore: 0,
  steep: [
    [104, 104, 110],
    [132, 138, 126],
  ],
  clearing: [238, 242, 246],
  climate: { wet: 0, cold: 0.6 },
  weights(h, wet, cold, out) {
    out.fill(0);
    const t = ramp(wet, 0.3, 0.4);
    out[0] = 1 - t;
    out[1] = t;
    // Tundra shows through where it is mildest and never takes over.
    blend(out, 2, 1 - cold);
    blend(out, 3, ramp(h, 0.42, 0.15));
    blend(out, 0, ramp(h, 0.84, 0.08));
  },
  sea: {
    look: "ice",
    shallow: [206, 226, 236],
    deep: [150, 186, 206],
    crossing: "solid",
  },
  craters: false,
  settlement: {
    style: "sealed",
    domes: 0.25,
    hull: [200, 84, 52],
    trim: [228, 232, 238],
    outskirts: "works",
    roads: {
      look: "sealed",
      track: [176, 194, 208],
      minor: [150, 170, 188],
      main: [92, 98, 106],
    },
  },
};

const RED: Planet = {
  id: "red",
  label: "Red",
  biomes: [
    biome("red dust", [170, 92, 62], "dust"),
    biome("dark basalt", [84, 60, 54], "basalt"),
    biome("pale dunes", [204, 150, 112], "dunes"),
    biome("rock", [128, 78, 60], "rock"),
  ],
  shore: 0,
  steep: [
    [84, 60, 54],
    [128, 78, 60],
  ],
  clearing: [170, 92, 62],
  climate: { wet: -0.3, cold: 0 },
  weights(h, wet, _cold, out) {
    out.fill(0);
    const t = ramp(wet, 0.2, 0.4);
    out[0] = 1 - t;
    out[2] = t;
    blend(out, 3, ramp(h, 0.42, 0.15));
    blend(out, 1, ramp(h, 0.66, 0.14));
  },
  sea: {
    look: "basin",
    shallow: [128, 74, 54],
    deep: [92, 54, 44],
    crossing: "solid",
  },
  craters: false,
  settlement: {
    style: "sealed",
    domes: 0.7,
    hull: [228, 224, 214],
    trim: [150, 190, 204],
    outskirts: "works",
    roads: {
      look: "sealed",
      track: [120, 64, 46],
      minor: [104, 60, 48],
      main: [204, 198, 188],
    },
  },
};

const MOON: Planet = {
  id: "moon",
  label: "Moon",
  biomes: [
    biome("regolith", [142, 142, 146], "regolith"),
    biome("bright highland", [196, 196, 200], "regolith"),
    biome("rock", [108, 108, 114], "rock"),
  ],
  shore: 0,
  steep: [
    [108, 108, 114],
    [196, 196, 200],
  ],
  clearing: [142, 142, 146],
  climate: { wet: 0, cold: 0 },
  weights(h, _wet, _cold, out) {
    out.fill(0);
    out[0] = 1;
    blend(out, 2, ramp(h, 0.42, 0.15));
    blend(out, 1, ramp(h, 0.66, 0.14));
  },
  sea: {
    look: "maria",
    shallow: [88, 90, 96],
    deep: [80, 82, 88],
    crossing: "solid",
  },
  craters: true,
  settlement: {
    style: "sealed",
    domes: 0.7,
    hull: [232, 232, 236],
    trim: [124, 152, 184],
    outskirts: "works",
    roads: {
      look: "sealed",
      track: [104, 104, 108],
      minor: [92, 92, 98],
      main: [216, 216, 222],
    },
  },
};

const VOLCANIC: Planet = {
  id: "volcanic",
  label: "Volcanic",
  biomes: [
    biome("dark basalt", [46, 40, 40], "basalt"),
    biome("brown rock", [88, 58, 42], "rock"),
    biome("ash", [92, 80, 72], "ash"),
    biome("cooled flows", [28, 24, 26], "flows"),
  ],
  shore: 0,
  steep: [
    [28, 24, 26],
    [88, 58, 42],
  ],
  clearing: [46, 40, 40],
  climate: { wet: -0.2, cold: -0.3 },
  weights(h, wet, _cold, out) {
    out.fill(0);
    // Basalt and brown rock share the low ground. Ash only dusts the slopes,
    // and the peaks are black flows.
    const t = ramp(wet, 0.2, 0.4);
    out[0] = 1 - t;
    out[1] = t;
    blend(out, 2, 0.4 * ramp(h, 0.3, 0.2));
    blend(out, 3, ramp(h, 0.6, 0.15));
  },
  sea: {
    look: "lava",
    // The crust and the melt in its gaps, mixed. The shader draws them apart.
    shallow: [150, 62, 26],
    deep: [112, 44, 24],
    crossing: "none",
  },
  craters: false,
  settlement: {
    style: "sealed",
    domes: 0.2,
    hull: [126, 130, 136],
    trim: [240, 150, 60],
    outskirts: "works",
    roads: {
      look: "sealed",
      track: [96, 86, 80],
      minor: [110, 100, 94],
      main: [152, 152, 158],
    },
  },
};

const ACID: Planet = {
  id: "acid",
  label: "Acid",
  biomes: [
    biome("dull yellow ground", [156, 148, 96], "cracked"),
    biome("brown ground", [118, 98, 70], "earth"),
    biome("brown forest", [84, 62, 44], "forest"),
    biome("rock", [110, 104, 92], "rock"),
  ],
  shore: 0,
  steep: [
    [84, 62, 44],
    [110, 104, 92],
  ],
  clearing: [118, 98, 70],
  climate: { wet: 0, cold: 0 },
  weights(h, wet, _cold, out) {
    out.fill(0);
    if (wet < 0.42) {
      const t = ramp(wet, 0.2, 0.18);
      out[0] = 1 - t;
      out[1] = t;
    } else {
      const t = ramp(wet, 0.48, 0.2);
      out[1] = 1 - t;
      out[2] = t;
    }
    blend(out, 3, ramp(h, 0.42, 0.15));
  },
  sea: {
    look: "acid",
    shallow: [126, 170, 72],
    deep: [52, 96, 40],
    crossing: "none",
  },
  craters: false,
  settlement: {
    style: "sealed",
    domes: 0.6,
    hull: [208, 212, 192],
    trim: [120, 172, 112],
    outskirts: "works",
    roads: {
      look: "sealed",
      track: [100, 84, 62],
      minor: [90, 80, 66],
      main: [182, 186, 172],
    },
  },
};

const BY_ID: Record<PlanetId, Planet> = {
  temperate: TEMPERATE,
  desert: DESERT,
  ice: ICE,
  red: RED,
  moon: MOON,
  volcanic: VOLCANIC,
  acid: ACID,
};

export function planetOf(id: PlanetId): Planet {
  return BY_ID[id];
}

/** `random` picks from the seed. Anything else that is not a planet id is Temperate. */
export function resolvePlanet(value: unknown, seed: number): PlanetId {
  if (value === "random")
    return pick(mulberry32(hashString(`planet:${seed >>> 0}`)), PLANETS);
  return isPlanetId(value) ? value : "temperate";
}

/**
 * Bytes summing to 255: floor each share times 255, then give what is left to
 * the largest share, lowest slot on a tie.
 */
export function weightBytes(
  shares: Float64Array,
  out: Uint8Array,
  offset: number,
): void {
  let total = 0;
  let largest = 0;
  for (let i = 0; i < shares.length; i++) {
    const b = Math.floor(shares[i] * 255);
    out[offset + i] = b;
    total += b;
    if (shares[i] > shares[largest]) largest = i;
  }
  out[offset + largest] += 255 - total;
}
