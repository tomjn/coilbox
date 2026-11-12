import { describe, expect, it } from "vitest";
import {
  type ForestGround,
  forestCoverPixels,
  plantForest,
  SPECIES,
} from "./placement";

const SUN: [number, number, number] = [-0.5, 0.7, -0.5];

/** Level forest 6 by 6, with whatever a test changes. */
const ground = (over: Partial<ForestGround> = {}): ForestGround => ({
  minX: 0,
  maxX: 6,
  minZ: 0,
  maxZ: 6,
  height: () => 1,
  seaLevel: 0.1,
  maxHeight: 10,
  cover: (_x, _z, out) => {
    out[0] = 1;
    out[1] = 0;
    out[2] = 0;
  },
  ...over,
});

describe("plantForest", () => {
  it("plants the same forest from the same seed, and another from another", () => {
    const a = plantForest(ground(), 5, SUN);
    const b = plantForest(ground(), 5, SUN);
    const c = plantForest(ground(), 6, SUN);
    expect(a.count).toBeGreaterThan(100);
    expect(Array.from(b.x)).toEqual(Array.from(a.x));
    expect(Array.from(b.species)).toEqual(Array.from(a.species));
    expect(Array.from(c.x.slice(0, 20))).not.toEqual(
      Array.from(a.x.slice(0, 20)),
    );
  });

  it("keeps every tree inside the ground it was given", () => {
    const f = plantForest(ground(), 5, SUN);
    for (let t = 0; t < f.count; t++) {
      expect(f.x[t]).toBeGreaterThanOrEqual(0);
      expect(f.x[t]).toBeLessThanOrEqual(6);
      expect(f.z[t]).toBeGreaterThanOrEqual(0);
      expect(f.z[t]).toBeLessThanOrEqual(6);
    }
  });

  it("stands no tree inside another's crown", () => {
    const f = plantForest(ground(), 5, SUN);
    let closest = Number.POSITIVE_INFINITY;
    for (let a = 0; a < f.count; a++)
      for (let b = a + 1; b < f.count; b++) {
        const d = Math.hypot(f.x[a] - f.x[b], f.z[a] - f.z[b]);
        closest = Math.min(closest, d / (f.width[a] + f.width[b]));
      }
    // CROWN_FIT, less the rounding of a 32 bit float.
    expect(closest).toBeGreaterThan(0.319);
  });

  it("plants nothing in the sea, on a river, or where the ground is blocked", () => {
    const sea = plantForest(ground({ height: (x) => (x < 3 ? 0 : 1) }), 5, SUN);
    expect(sea.count).toBeGreaterThan(0);
    expect(Math.min(...sea.x)).toBeGreaterThanOrEqual(3);

    const river = plantForest(
      ground({ riverEdge: (x) => Math.abs(x - 3) - 0.2 }),
      5,
      SUN,
    );
    for (let t = 0; t < river.count; t++)
      expect(Math.abs(river.x[t] - 3)).toBeGreaterThanOrEqual(0.23);

    const blocked = plantForest(ground({ blocked: (_x, z) => z > 2 }), 5, SUN);
    expect(blocked.count).toBeGreaterThan(0);
    expect(Math.max(...blocked.z)).toBeLessThanOrEqual(2);
  });

  it("plants nothing where nothing grows", () => {
    const bare = plantForest(
      ground({ cover: (_x, _z, out) => out.fill(0) }),
      5,
      SUN,
    );
    expect(bare.count).toBe(0);
  });

  it("thins a forest out on steep ground", () => {
    const level = plantForest(ground(), 5, SUN);
    const steep = plantForest(ground({ height: (x) => 1 + x * 2 }), 5, SUN);
    expect(steep.count).toBeLessThan(level.count / 10);
  });

  it("grows copses on grassland, far thinner than a forest", () => {
    const forest = plantForest(ground(), 5, SUN);
    const grass = plantForest(
      ground({
        maxX: 30,
        maxZ: 30,
        cover: (_x, _z, out) => {
          out[0] = 0;
          out[1] = 0;
          out[2] = 1;
        },
      }),
      5,
      SUN,
    );
    expect(grass.count).toBeGreaterThan(0);
    expect(grass.count / 900).toBeLessThan(forest.count / 36 / 3);
  });

  it("plants more than one kind of tree, at more than one size", () => {
    const f = plantForest(ground({ maxX: 30, maxZ: 30 }), 5, SUN);
    expect(new Set(f.species).size).toBeGreaterThanOrEqual(4);
    for (let t = 0; t < f.count; t++) {
      const s = SPECIES[f.species[t]];
      expect(f.height[t]).toBeGreaterThan(s.height[0] * 0.5);
      expect(f.height[t]).toBeLessThan(s.height[1] * 1.3);
    }
  });

  it("plants a cold forest in conifers and birch", () => {
    const f = plantForest(
      ground({
        cover: (_x, _z, out) => {
          out[0] = 0;
          out[1] = 1;
          out[2] = 0;
        },
      }),
      5,
      SUN,
    );
    const ids = Array.from(f.species, (k) => SPECIES[k].id);
    const cold = ids.filter((id) => id === "spruce" || id === "birch");
    expect(cold.length / ids.length).toBeGreaterThan(0.85);
  });

  it("turns some broadleaf trees only when asked", () => {
    const green = plantForest(ground({ maxX: 20, maxZ: 20 }), 5, SUN, 0);
    const autumn = plantForest(ground({ maxX: 20, maxZ: 20 }), 5, SUN, 0.3);
    expect(green.turning.reduce((a, b) => a + b, 0)).toBe(0);
    const turned = autumn.turning.reduce((a, b) => a + b, 0);
    expect(turned).toBeGreaterThan(0);
    expect(turned).toBeLessThan(autumn.count / 2);
    for (let t = 0; t < autumn.count; t++)
      if (autumn.turning[t])
        expect(SPECIES[autumn.species[t]].conifer).toBe(false);
  });

  it("shades the trees inside a forest and not the ones on its sunward edge", () => {
    const f = plantForest(ground(), 5, SUN);
    let shaded = 0;
    for (let t = 0; t < f.count; t++) {
      expect(f.shade[t]).toBeGreaterThanOrEqual(0);
      expect(f.shade[t]).toBeLessThanOrEqual(1);
      if (f.shade[t] > 0.2) shaded++;
      // The sun stands at -x, -z, so nothing shades the corner nearest it.
      if (f.x[t] < 0.07 && f.z[t] < 0.07) expect(f.shade[t]).toBe(0);
    }
    expect(shaded).toBeGreaterThan(f.count / 4);
  });
});

describe("forestCoverPixels", () => {
  const one = {
    count: 1,
    x: Float32Array.of(3),
    y: Float32Array.of(1),
    z: Float32Array.of(3),
    height: Float32Array.of(0.4),
    width: Float32Array.of(0.4),
    turn: Float32Array.of(0),
    pick: Float32Array.of(0),
    shade: Float32Array.of(0),
    species: Uint8Array.of(0),
    turning: Uint8Array.of(0),
  };
  const pixels = forestCoverPixels(one, ground(), 120, 120, SUN);
  const at = (x: number, z: number, channel: number) =>
    pixels[(Math.floor(z * 20) * 120 + Math.floor(x * 20)) * 2 + channel];

  it("marks the canopy over the tree and nowhere else", () => {
    expect(at(3, 3, 0)).toBe(255);
    expect(at(3.5, 3, 0)).toBe(0);
    expect(at(1, 1, 0)).toBe(0);
  });

  it("throws the shadow away from the sun", () => {
    expect(at(3.2, 3.2, 1)).toBeGreaterThan(200);
    expect(at(2.7, 2.7, 1)).toBe(0);
    expect(at(4, 4, 1)).toBe(0);
  });
});
