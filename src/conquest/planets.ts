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

/** Which of the shader's six existing patterns a slot draws with until piece 2. */
export type BiomePattern =
  | "forest"
  | "grass"
  | "dry"
  | "tundra"
  | "rock"
  | "snow";

export interface Biome {
  name: string;
  colour: Rgb;
  farm: boolean;
  pattern: BiomePattern;
}

export type SeaLook = "water" | "acid" | "lava" | "ice" | "basin" | "maria";

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
  /** Fill `out` (length 8) with shares summing to 1. `h`, `wet`, `cold` are 0 to 1. */
  weights(h: number, wet: number, cold: number, out: Float64Array): void;
  sea: {
    look: SeaLook;
    shallow: Rgb;
    deep: Rgb;
    crossing: "lane" | "solid" | "none";
  };
  craters: boolean;
}

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
    biome("dry", [182, 168, 116], "dry", true),
    biome("forest", [58, 98, 56], "forest"),
    biome("tundra", [146, 146, 122], "tundra"),
    biome("rock", [122, 106, 90], "rock"),
    biome("scree", [152, 146, 140], "rock"),
    biome("snow", [240, 240, 240], "snow"),
    biome("beach", [214, 200, 150], "dry"),
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
};

const DESERT: Planet = {
  id: "desert",
  label: "Desert",
  biomes: [
    biome("dunes", [214, 186, 128], "dry"),
    biome("rock flats", [168, 138, 104], "rock"),
    biome("mesa", [150, 96, 70], "rock"),
    biome("scrub", [150, 148, 96], "grass", true),
    biome("salt pan", [226, 220, 204], "snow"),
    biome("beach", [222, 206, 160], "dry"),
  ],
  shore: 5,
  steep: [
    [150, 96, 70],
    [168, 138, 104],
  ],
  clearing: [150, 148, 96],
  climate: { wet: -0.35, cold: -0.2 },
  weights(h, wet, cold, out) {
    out.fill(0);
    const t = ramp(wet, 0.2, 0.4);
    out[0] = 1 - t;
    out[3] = t;
    blend(out, 1, ramp(h, 0.42, 0.15));
    blend(out, 2, ramp(h, 0.66, 0.14));
    blend(out, 4, ramp(h, 0.84 - 0.25 * cold, 0.08));
    blend(out, 5, 1 - ramp(h, 0, 0.015));
  },
  sea: {
    look: "water",
    shallow: [78, 150, 160],
    deep: [30, 78, 104],
    crossing: "lane",
  },
  craters: false,
};

const ICE: Planet = {
  id: "ice",
  label: "Ice",
  biomes: [
    biome("snowfield", [238, 242, 246], "snow"),
    biome("bare ice", [176, 208, 224], "snow"),
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
};

const RED: Planet = {
  id: "red",
  label: "Red",
  biomes: [
    biome("red dust", [170, 92, 62], "dry"),
    biome("dark basalt", [84, 60, 54], "rock"),
    biome("pale dunes", [204, 150, 112], "dry"),
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
};

const MOON: Planet = {
  id: "moon",
  label: "Moon",
  biomes: [
    biome("regolith", [142, 142, 146], "dry"),
    biome("bright highland", [196, 196, 200], "tundra"),
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
    shallow: [86, 88, 96],
    deep: [58, 60, 68],
    crossing: "solid",
  },
  craters: true,
};

const VOLCANIC: Planet = {
  id: "volcanic",
  label: "Volcanic",
  biomes: [
    biome("dark basalt", [54, 48, 48], "rock"),
    biome("brown rock", [96, 70, 54], "rock"),
    biome("ash", [122, 116, 112], "dry"),
    biome("cooled flows", [34, 30, 32], "rock"),
  ],
  shore: 0,
  steep: [
    [34, 30, 32],
    [96, 70, 54],
  ],
  clearing: [54, 48, 48],
  climate: { wet: -0.2, cold: -0.3 },
  weights(h, wet, _cold, out) {
    out.fill(0);
    const t = ramp(wet, 0.2, 0.4);
    out[0] = 1 - t;
    out[2] = t;
    blend(out, 1, ramp(h, 0.42, 0.15));
    blend(out, 3, ramp(h, 0.66, 0.14));
  },
  sea: {
    look: "lava",
    shallow: [240, 120, 30],
    deep: [150, 36, 16],
    crossing: "none",
  },
  craters: false,
};

const ACID: Planet = {
  id: "acid",
  label: "Acid",
  biomes: [
    biome("dull yellow ground", [156, 148, 96], "dry"),
    biome("brown ground", [118, 98, 70], "tundra"),
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
