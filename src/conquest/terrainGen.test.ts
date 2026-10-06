import { describe, expect, it } from "vitest";
import { PLANETS, planetOf } from "./planets";
import { mulberry32 } from "./rng";
import {
  generateTerrain,
  LAND_LAYOUTS,
  labelLandMasses,
  landColour,
  landLayoutsFor,
  mariaCraterDelta,
  resolveLandLayout,
  seaRampOf,
} from "./terrainGen";

const opts = { seed: 11, shape: "continent" as const };

describe("planet terrain", () => {
  it("keeps land and heights whatever the planet", () => {
    const base = generateTerrain(opts);
    for (const planet of PLANETS.filter(
      (p) => planetOf(p).sea.crossing !== "none" && !planetOf(p).craters,
    )) {
      const t = generateTerrain({ ...opts, planet });
      expect(t.land).toEqual(base.land);
      expect(t.heightmap).toEqual(base.heightmap);
    }
  }, 60_000);

  it("craters the Moon without moving its coast", () => {
    const plain = generateTerrain({ seed: 9, shape: "continent" });
    const moon = generateTerrain({
      seed: 9,
      shape: "continent",
      planet: "moon",
    });
    expect(moon.land).toEqual(plain.land);
    expect(moon.coastDistance).toEqual(plain.coastDistance);
    expect(moon.heightmap).not.toEqual(plain.heightmap);
    let wrong = 0;
    for (let i = 0; i < moon.land.length; i++)
      if ((moon.heightmap[i] === 0) !== (moon.land[i] === 0)) wrong++;
    expect(wrong).toBe(0);
  });

  it("craters the Moon's maria in the picture and leaves its heights at sea level", () => {
    const S = 512;
    const moon = planetOf("moon");
    const ramp = seaRampOf(moon);
    const t = generateTerrain({
      seed: 11,
      shape: "continents",
      planet: "moon",
    });
    let raised = 0;
    let open = 0;
    let shaded = 0;
    for (let i = 0; i < S * S; i++) {
      if (t.land[i]) continue;
      if (t.heightmap[i] !== 0) raised++;
      if (t.coastDistance[i] <= 6) continue;
      open++;
      const rgb = ramp[Math.min(108, t.coastDistance[i])];
      const want = new Uint8ClampedArray(1);
      want[0] = rgb[0];
      if (t.image[i * 4] !== want[0]) shaded++;
    }
    expect(raised).toBe(0);
    expect(open).toBeGreaterThan(0);
    expect(shaded).toBeGreaterThan(0);
  }, 60_000);

  it("keeps the middle of a maria crater flat", () => {
    const floor = [0, 0.2, 0.49].map(mariaCraterDelta);
    const flat = floor.every((v) => v === floor[0]);
    expect(flat).toBe(true);
    expect(mariaCraterDelta(0.81)).toBeGreaterThan(0);
    expect(mariaCraterDelta(1.44)).toBe(0);
    expect(mariaCraterDelta(2)).toBe(0);
  });

  it("does not shade the sea on a planet without craters", () => {
    const S = 512;
    for (const planet of ["temperate", "ice"] as const) {
      const ramp = seaRampOf(planetOf(planet));
      const t = generateTerrain({ seed: 11, shape: "continents", planet });
      let open = 0;
      let wrong = 0;
      for (let i = 0; i < S * S; i++) {
        if (t.land[i] || t.coastDistance[i] <= 6) continue;
        open++;
        const rgb = ramp[Math.min(108, t.coastDistance[i])];
        const want = new Uint8ClampedArray(3);
        want[0] = rgb[0];
        want[1] = rgb[1];
        want[2] = rgb[2];
        for (let c = 0; c < 3; c++) if (t.image[i * 4 + c] !== want[c]) wrong++;
      }
      expect(open, planet).toBeGreaterThan(0);
      expect(wrong, planet).toBe(0);
    }
  }, 60_000);

  it("leaves the Moon's edge rows and columns as they were", () => {
    const S = 512;
    for (const seed of [9, 10, 11]) {
      const plain = generateTerrain({ seed, shape: "continent" });
      const moon = generateTerrain({
        seed,
        shape: "continent",
        planet: "moon",
      });
      for (let k = 0; k < S; k++) {
        for (const i of [k, (S - 1) * S + k, k * S, k * S + S - 1])
          expect(moon.heightmap[i]).toBe(plain.heightmap[i]);
      }
    }
  }, 60_000);

  it("keeps the relief within its heightmap byte, and gives the sea none", () => {
    for (const planet of PLANETS) {
      const t = generateTerrain({ ...opts, planet });
      // A crater's change is rounded down apart from the height's, so on a
      // cratered planet the two drift by a part of a byte a crater.
      const cratered = planetOf(planet).craters;
      let wrong = 0;
      for (let i = 0; i < t.land.length; i++) {
        // Beside a sea that is ground the relief starts from 0, not 1.
        const step = ["basin", "maria"].includes(planetOf(planet).sea.look)
          ? 1
          : 0;
        const over = t.relief[i] + step - t.heightmap[i];
        if (!t.land[i]) {
          if (t.relief[i] !== 0) wrong++;
        } else if (cratered) {
          if (t.relief[i] < 0 || t.relief[i] > 255) wrong++;
        } else if (over < 0 || over > 1) {
          // A float can round a height a hair under a whole number up to it.
          wrong++;
        }
      }
      expect(wrong, planet).toBe(0);
    }
  }, 60_000);

  it("gives land weights that sum to 255 and sea none", () => {
    for (const planet of PLANETS) {
      const t = generateTerrain({ ...opts, planet });
      let wrong = 0;
      for (let i = 0; i < t.land.length; i++) {
        let sum = 0;
        for (let c = 0; c < 4; c++)
          sum += t.biomes.a[i * 4 + c] + t.biomes.b[i * 4 + c];
        if (sum !== (t.land[i] ? 255 : 0)) wrong++;
      }
      expect(wrong, planet).toBe(0);
    }
  }, 60_000);

  it("paints inland ground in the palette mixed by the weights, shaded by its slope", () => {
    const S = 512;
    const checked = new Map<string, number>();
    let wrong = 0;
    for (const seed of [11]) {
      for (const planet of PLANETS) {
        const t = generateTerrain({ seed, shape: "continent", planet });
        const p = planetOf(planet);
        for (let y = 1; y < S - 1; y++) {
          for (let x = 1; x < S - 1; x++) {
            const i = y * S + x;
            if (!t.land[i] || t.coastDistance[i] <= 6) continue;
            // Lit from the north west, by the heights before rounding.
            const slope = t.relief[i + S + 1] - t.relief[i - S - 1];
            const shade = Math.min(1.25, Math.max(0.75, 1 + slope * 0.03));
            const rgb = landColour(p, t.biomes, i * 4);
            const want = new Uint8ClampedArray(3);
            want[0] = rgb[0] * shade;
            want[1] = rgb[1] * shade;
            want[2] = rgb[2] * shade;
            if (
              t.image[i * 4] !== want[0] ||
              t.image[i * 4 + 1] !== want[1] ||
              t.image[i * 4 + 2] !== want[2]
            )
              wrong++;
            checked.set(planet, (checked.get(planet) ?? 0) + 1);
          }
        }
      }
    }
    for (const planet of PLANETS)
      expect(checked.get(planet) ?? 0, planet).toBeGreaterThan(0);
    expect(wrong).toBe(0);
  }, 60_000);

  it("keeps one land mass where the sea cannot be crossed", () => {
    for (const planet of ["volcanic", "acid"] as const)
      for (const shape of landLayoutsFor(planet))
        expect(
          labelLandMasses(
            generateTerrain({ seed: 5, shape, planet, maxMasses: 40 }),
          ).sizes.length,
        ).toBe(1);
  }, 60_000);

  it("resolves a shape the planet does not offer to one continent", () => {
    const rng = mulberry32(3);
    expect(resolveLandLayout("archipelago", rng, "volcanic")).toBe("continent");
    expect(rng()).toBe(mulberry32(3)());
    expect(landLayoutsFor("volcanic")).toEqual([
      "continent",
      "coast",
      "inlandsea",
      "landlocked",
    ]);
    expect(landLayoutsFor("ice")).toEqual(LAND_LAYOUTS);
  });
});
