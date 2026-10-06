import { describe, expect, it } from "vitest";
import {
  BIOME_SLOTS,
  blend,
  isPlanetId,
  PLANETS,
  planetOf,
  type Rgb,
  resolvePlanet,
  weightBytes,
} from "./planets";

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const mix = (a: Rgb, b: Rgb, t: number): Rgb => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

// The chain terrainGen.ts used before planets existed, copied here as the reference.
const BEACH: Rgb = [214, 200, 150];
const DRY: Rgb = [182, 168, 116];
const GRASS: Rgb = [122, 154, 84];
const FOREST: Rgb = [58, 98, 56];
const TUNDRA: Rgb = [146, 146, 122];
const ROCK: Rgb = [122, 106, 90];
const SCREE: Rgb = [152, 146, 140];
const SNOW: Rgb = [240, 240, 240];

function oldBiomeColour(h: number, wet: number, cold: number): Rgb {
  let c =
    wet < 0.42
      ? mix(DRY, GRASS, clamp01((wet - 0.2) / 0.18))
      : mix(GRASS, FOREST, clamp01((wet - 0.48) / 0.2));
  c = mix(c, TUNDRA, cold);
  c = mix(c, ROCK, clamp01((h - 0.42) / 0.15));
  c = mix(c, SCREE, clamp01((h - 0.66) / 0.14));
  c = mix(c, SNOW, clamp01((h - (0.84 - 0.25 * cold)) / 0.08));
  return mix(BEACH, c, clamp01(h / 0.015));
}

describe("planets", () => {
  it("lists the seven planets in order", () => {
    expect([...PLANETS]).toEqual([
      "temperate",
      "desert",
      "ice",
      "red",
      "moon",
      "volcanic",
      "acid",
    ]);
    expect(isPlanetId("moon")).toBe(true);
    expect(isPlanetId("random")).toBe(false);
    expect(isPlanetId(3)).toBe(false);
  });

  it("gives every planet 1 to 8 slots", () => {
    for (const id of PLANETS) {
      const n = planetOf(id).biomes.length;
      expect(n).toBeGreaterThanOrEqual(1);
      expect(n).toBeLessThanOrEqual(BIOME_SLOTS);
    }
  });

  it("keeps each planet's shore inside its slots", () => {
    for (const id of PLANETS) {
      const p = planetOf(id);
      expect(p.shore).toBeGreaterThanOrEqual(0);
      expect(p.shore).toBeLessThan(p.biomes.length);
    }
  });

  it("gives shares that sum to 1 with none in an unused slot", () => {
    for (const id of PLANETS) {
      const p = planetOf(id);
      const out = new Float64Array(BIOME_SLOTS);
      for (const h of [0, 0.01, 0.3, 0.5, 0.7, 0.9, 1])
        for (const wet of [0, 0.3, 0.45, 0.7, 1])
          for (const cold of [0, 0.5, 1]) {
            p.weights(h, wet, cold, out);
            expect(out.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
            for (let s = p.biomes.length; s < BIOME_SLOTS; s++)
              expect(out[s]).toBe(0);
            for (const v of out) expect(v).toBeGreaterThanOrEqual(0);
          }
    }
  });

  it("mixes Temperate to the colour biomeColour gave", () => {
    const p = planetOf("temperate");
    const out = new Float64Array(BIOME_SLOTS);
    const inputs: [number, number, number][] = [
      [0.5, 0.6, 0.2],
      [0.5, 0.3, 0.2],
      [0.3, 0.41, 0],
      [0.3, 0.42, 0],
      [0.01, 0.6, 0.1],
      [0.005, 0.3, 0.5],
      [0.6, 0.7, 0.9],
      [0.7, 0.2, 0.3],
      [0.8, 0.5, 0],
      [0.9, 0.45, 0.4],
      [1, 0.9, 1],
    ];
    for (const [h, wet, cold] of inputs) {
      p.weights(h, wet, cold, out);
      const got: Rgb = [0, 0, 0];
      for (let s = 0; s < p.biomes.length; s++)
        for (let ch = 0; ch < 3; ch++)
          got[ch] += out[s] * p.biomes[s].colour[ch];
      const want = oldBiomeColour(h, wet, cold);
      for (let ch = 0; ch < 3; ch++)
        expect(Math.abs(got[ch] - want[ch])).toBeLessThan(1e-9);
    }
  });

  it("blends towards a slot", () => {
    const out = Float64Array.of(0.5, 0.5, 0, 0, 0, 0, 0, 0);
    blend(out, 2, 0.5);
    expect([...out]).toEqual([0.25, 0.25, 0.5, 0, 0, 0, 0, 0]);
  });

  it("writes bytes that sum to 255", () => {
    const out = new Uint8Array(8);
    weightBytes(Float64Array.of(1 / 3, 1 / 3, 1 / 3, 0, 0, 0, 0, 0), out, 0);
    expect([...out]).toEqual([85, 85, 85, 0, 0, 0, 0, 0]);
    weightBytes(Float64Array.of(0.5, 0.3, 0.2, 0, 0, 0, 0, 0), out, 0);
    expect(out.reduce((a, b) => a + b, 0)).toBe(255);
  });

  it("resolves a planet", () => {
    expect(resolvePlanet(undefined, 7)).toBe("temperate");
    expect(resolvePlanet("nonsense", 7)).toBe("temperate");
    expect(resolvePlanet("moon", 7)).toBe("moon");
    expect(resolvePlanet("random", 7)).toBe(resolvePlanet("random", 7));
    expect(
      new Set(Array.from({ length: 64 }, (_, s) => resolvePlanet("random", s)))
        .size,
    ).toBeGreaterThan(1);
  });
});
