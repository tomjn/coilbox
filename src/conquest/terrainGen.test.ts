import { describe, expect, it } from "vitest";
import { LIQUID_SEAS, PLANETS, planetOf } from "./planets";
import { mulberry32 } from "./rng";
import {
  ABYSS_DARK,
  coastDistanceOf,
  extendTerrain,
  generateTerrain,
  generateTerrainWithMargin,
  LAND_LAYOUTS,
  labelLandMasses,
  landColour,
  landLayoutsFor,
  mariaCraterDelta,
  resolveLandLayout,
  seaColourAtDepth,
  seaDepthOf,
  seaRampOf,
  shoreOf,
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

  it("colours the sea by its depth alone on a planet without craters", () => {
    const S = 512;
    for (const planet of ["temperate", "ice"] as const) {
      const t = generateTerrain({ seed: 11, shape: "continents", planet });
      let open = 0;
      let wrong = 0;
      for (let i = 0; i < S * S; i++) {
        if (t.land[i] || t.coastDistance[i] <= 6) continue;
        open++;
        const rgb = seaColourAtDepth(planetOf(planet), t.seaDepth[i]);
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

  it("gives the land no depth, and the sea more the further out it is", () => {
    const S = 512;
    const t = generateTerrain({ seed: 11, shape: "continents" });
    let onLand = 0;
    let near = 0;
    let nearCount = 0;
    let far = 0;
    let farCount = 0;
    for (let i = 0; i < S * S; i++) {
      if (t.land[i]) {
        if (t.seaDepth[i] !== 0) onLand++;
      } else if (t.coastDistance[i] <= 9) {
        near += t.seaDepth[i];
        nearCount++;
      } else if (t.coastDistance[i] >= 90) {
        far += t.seaDepth[i];
        farCount++;
      }
    }
    expect(onLand).toBe(0);
    expect(nearCount).toBeGreaterThan(0);
    expect(farCount).toBeGreaterThan(0);
    expect(far / farCount).toBeGreaterThan(near / nearCount);
  }, 60_000);

  it("runs the shallows further out from low ground than from high ground", () => {
    // Land across the top with a straight coast: low on the left half, high
    // on the right.
    const W = 200;
    const H = 100;
    const land = new Uint8Array(W * H);
    const heightmap = new Uint8Array(W * H);
    for (let y = 0; y < 40; y++) {
      for (let x = 0; x < W; x++) {
        land[y * W + x] = 1;
        heightmap[y * W + x] = x < W / 2 ? 2 : 200;
      }
    }
    const coast = coastDistanceOf(land, W, H);
    // A bed at the surface, so the shelf alone sets the depth.
    const flatBed = (mask: Uint8Array) =>
      Float64Array.from(mask, (v) => (v ? 1 : -1e-9));
    const depth = seaDepthOf(
      land,
      heightmap,
      coast,
      W,
      H,
      1,
      () => 0.5,
      flatBed(land),
      1,
    );
    // Ten pixels out, well clear of where the two halves meet.
    const offLow = depth[50 * W + 30];
    const offHigh = depth[50 * W + 170];
    expect(offLow).toBeGreaterThan(0);
    expect(offHigh).toBeGreaterThan(offLow * 2);
    // The same coast at half the resolution is as deep at the same place.
    const half = new Uint8Array((W / 2) * (H / 2));
    const halfHeights = new Uint8Array(half.length);
    for (let y = 0; y < H / 2; y++) {
      for (let x = 0; x < W / 2; x++) {
        half[y * (W / 2) + x] = land[y * 2 * W + x * 2];
        halfHeights[y * (W / 2) + x] = heightmap[y * 2 * W + x * 2];
      }
    }
    const coarse = seaDepthOf(
      half,
      halfHeights,
      coastDistanceOf(half, W / 2, H / 2),
      W / 2,
      H / 2,
      2,
      () => 0.5,
      flatBed(half),
      1,
    );
    const coarseLow = coarse[25 * (W / 2) + 15];
    expect(Math.abs(coarseLow - offLow)).toBeLessThan(offLow * 0.25);
  });

  it("puts the water line where the smooth coast is, not on the pixels' steps", () => {
    // A round island 20.3 pixels across its radius, cut from a smooth level.
    const W = 64;
    const R = 20.3;
    const land = new Uint8Array(W * W);
    const level = new Float64Array(W * W);
    for (let y = 0; y < W; y++) {
      for (let x = 0; x < W; x++) {
        const dx = x - 31.5;
        const dy = y - 31.5;
        level[y * W + x] = R - Math.sqrt(dx * dx + dy * dy);
        land[y * W + x] = level[y * W + x] > 0 ? 1 : 0;
      }
    }
    const shore = shoreOf(land, coastDistanceOf(land, W, W), level, W, W, 1);
    for (let i = 0; i < shore.length; i++)
      expect(shore[i] > 0).toBe(land[i] === 1);
    // The blend between pixel centres, as a texture gives it.
    const at = (x: number, y: number) => {
      const ix = Math.floor(x);
      const iy = Math.floor(y);
      const fx = x - ix;
      const fy = y - iy;
      const i = iy * W + ix;
      const top = shore[i] + (shore[i + 1] - shore[i]) * fx;
      const bottom = shore[i + W] + (shore[i + W + 1] - shore[i + W]) * fx;
      return top + (bottom - top) * fy;
    };
    // Walk out from the middle along 40 directions to where the blend
    // crosses 0. A 3, 4, 5 triangle turns the direction with no cosine.
    let worst = 0;
    let dx = 1;
    let dy = 0;
    for (let k = 0; k < 40; k++) {
      let r = R - 3;
      while (at(31.5 + dx * r, 31.5 + dy * r) > 0) r += 0.01;
      worst = Math.max(worst, Math.abs(r - R));
      [dx, dy] = [0.8 * dx - 0.6 * dy, 0.6 * dx + 0.8 * dy];
    }
    // The pixels' own steps are up to half a pixel off the circle.
    expect(worst).toBeLessThan(0.15);
  });

  it("measures the shore from the water line on the map and past its edge", () => {
    const { terrain, margin } = generateTerrainWithMargin(
      { seed: 11, shape: "continents" },
      64,
    );
    let wrong = 0;
    let beside = 0;
    for (let i = 0; i < terrain.land.length; i++) {
      if (terrain.shore[i] > 0 !== (terrain.land[i] === 1)) wrong++;
      if (terrain.coastDistance[i] === 3) {
        beside++;
        if (Math.abs(terrain.shore[i]) > 1) wrong++;
      } else if (Math.abs(terrain.shore[i]) < 1.5) wrong++;
    }
    expect(beside).toBeGreaterThan(0);
    expect(wrong).toBe(0);
    let marginWrong = 0;
    for (let o = 0; o < margin.shore.length; o++)
      if (margin.shore[o] > 0 !== margin.heightmap[o] > 0) marginWrong++;
    expect(marginWrong).toBe(0);
    const wide = extendTerrain(terrain, margin);
    expect(wide.shore).toHaveLength(wide.width * wide.height);
    expect(wide.seaDepth).toHaveLength(wide.width * wide.height);
    // The map's own values sit in the middle, untouched.
    const o = (margin.margin + 100) * wide.width + margin.margin + 200;
    expect(wide.shore[o]).toBe(terrain.shore[100 * terrain.width + 200]);
    expect(wide.seaDepth[o]).toBe(terrain.seaDepth[100 * terrain.width + 200]);
  }, 60_000);

  it("makes the sea as deep as its bed past the shelf, and never shallower than the shelf", () => {
    // Land across the top, level ground, and a bed that is a bank on the
    // left half and a basin on the right.
    const W = 200;
    const H = 160;
    const land = new Uint8Array(W * H);
    const heightmap = new Uint8Array(W * H);
    const level = new Float64Array(W * H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const o = y * W + x;
        if (y < 30) {
          land[o] = 1;
          heightmap[o] = 2;
          level[o] = 1;
        } else {
          level[o] = x < W / 2 ? -0.2 : -4;
        }
      }
    }
    const coast = coastDistanceOf(land, W, H);
    const depth = seaDepthOf(
      land,
      heightmap,
      coast,
      W,
      H,
      1,
      () => 0.5,
      level,
      1,
    );
    // Far out, clear of where the halves meet.
    const overBank = depth[140 * W + 40];
    const overBasin = depth[140 * W + 160];
    expect(overBasin).toBeGreaterThan(overBank * 2);
    // The bank is nearer the surface than the shelf's edge, so the shelf
    // carries on over it at the depth of its edge.
    const besideCoast = depth[33 * W + 40];
    expect(overBank).toBeGreaterThan(besideCoast);
    const nearer = depth[100 * W + 40];
    expect(Math.abs(nearer - overBank)).toBeLessThan(overBank * 0.01);
  });

  it("fades the sea from its shallow colour to its deep one, or darker, with no edge", () => {
    for (const planet of ["temperate", "ice", "acid"] as const) {
      const p = planetOf(planet);
      const { shallow, deep } = p.sea;
      // The channel the two colours differ in most.
      let c = 0;
      for (let k = 1; k < 3; k++)
        if (Math.abs(shallow[k] - deep[k]) > Math.abs(shallow[c] - deep[c]))
          c = k;
      const span = Math.abs(shallow[c] - deep[c]);
      const towards = Math.sign(deep[c] - shallow[c]);
      let last = seaColourAtDepth(p, 1)[c];
      let largest = 0;
      for (let d = 1.05; d <= 40; d += 0.05) {
        const now = seaColourAtDepth(p, d)[c];
        expect((now - last) * towards, planet).toBeGreaterThanOrEqual(0);
        largest = Math.max(largest, Math.abs(now - last));
        last = now;
      }
      // No step of a twentieth of a depth changes the colour by much.
      expect(largest, planet).toBeLessThan(span * 0.05);
      if (LIQUID_SEAS.includes(p.sea.look)) {
        // A liquid sea goes darker than its deep colour over its basins, by
        // no more than the abyss takes.
        expect(last, planet).toBeLessThan(deep[c]);
        expect(last, planet).toBeGreaterThan(deep[c] * (1 - ABYSS_DARK));
      } else {
        expect(Math.abs(last - deep[c]), planet).toBeLessThan(span * 0.01);
      }
    }
  });

  it("starts a liquid sea at its bed and any other sea at its shallow colour", () => {
    const ice = planetOf("ice");
    expect(seaColourAtDepth(ice, 0)).toEqual(ice.sea.shallow);
    const temperate = planetOf("temperate");
    const shore = temperate.biomes[temperate.shore].colour;
    const line = seaColourAtDepth(temperate, 0);
    const out = seaColourAtDepth(temperate, 3);
    // Sand is redder than water, so the water line is redder than open sea.
    expect(shore[0]).toBeGreaterThan(temperate.sea.shallow[0]);
    expect(line[0]).toBeGreaterThan(temperate.sea.shallow[0]);
    expect(out[0]).toBeLessThan(temperate.sea.shallow[0]);
  });

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
