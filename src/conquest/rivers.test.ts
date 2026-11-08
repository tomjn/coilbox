import { describe, expect, it } from "vitest";
import {
  drainage,
  findRivers,
  RIVER_EDGE_TEXELS,
  type RiverLine,
  riverEdgePixels,
} from "./rivers";
import { mulberry32 } from "./rng";

const SIDE = 200;

/**
 * An island: a ridge down the middle falling to the sea on every side, a
 * closed bowl on its east flank and a little noise. Heights 0 to 1 like the
 * generator's relief.
 */
function island(seed = 3): Float32Array {
  const rng = mulberry32(seed);
  const out = new Float32Array(SIDE * SIDE);
  for (let y = 0; y < SIDE; y++) {
    for (let x = 0; x < SIDE; x++) {
      const r = Math.hypot((x - SIDE / 2) / 80, (y - SIDE / 2) / 85);
      if (r >= 1) continue;
      const ridge = Math.exp(-(((x - 100) / 25) ** 2)) * 0.4;
      const bowl = -Math.exp(-(((x - 135) / 10) ** 2 + ((y - 90) / 10) ** 2));
      const wave = Math.sin(y / 9) * Math.sin(x / 13) * 0.03;
      const v =
        (1 - r) * 0.5 + ridge * (1 - r) + bowl * 0.12 + wave + rng() * 1e-3;
      out[y * SIDE + x] = Math.max(1 / 255, v);
    }
  }
  return out;
}

/** Follow a river's joins down to the river that ends it. */
function mouthOf(lines: readonly RiverLine[], k: number): RiverLine {
  const seen = new Set<number>();
  let line = lines[k];
  while (line.end === "join") {
    expect(seen.has(line.joins)).toBe(false);
    seen.add(line.joins);
    expect(line.joins).toBeGreaterThanOrEqual(0);
    line = lines[line.joins];
  }
  return line;
}

describe("drainage", () => {
  it("drains every land cell to water or the edge, through a closed bowl", () => {
    const h = island();
    const { down, water } = drainage(h, SIDE, SIDE);
    for (let i = 0; i < h.length; i++) {
      if (water[i]) continue;
      let c = i;
      let steps = 0;
      while (c >= 0 && !water[c]) {
        c = down[c];
        steps++;
        expect(steps).toBeLessThan(h.length);
      }
      expect(c === -2 || water[c] === 1).toBe(true);
    }
  });

  it("passes all the rain on to the sea or the edge", () => {
    const h = island();
    const { down, flow, water } = drainage(h, SIDE, SIDE);
    let rain = 0;
    let out = 0;
    for (let i = 0; i < h.length; i++) {
      if (water[i]) continue;
      rain++;
      if (down[i] === -2 || water[down[i]]) out += flow[i];
    }
    expect(out).toBe(rain);
  });
});

describe("findRivers", () => {
  it("finds rivers that all reach the sea or the edge", () => {
    const h = island();
    const lines = findRivers(h, SIDE, SIDE);
    expect(lines.length).toBeGreaterThan(1);
    lines.forEach((_, k) => {
      const mouth = mouthOf(lines, k);
      expect(mouth.end).toBe("sea");
      // A river into the sea ends at the sea's edge.
      const n = mouth.points.length;
      const x = Math.round(mouth.points[n - 3]);
      const y = Math.round(mouth.points[n - 2]);
      let sea = false;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (h[(y + dy) * SIDE + x + dx] === 0) sea = true;
        }
      }
      expect(sea).toBe(true);
    });
  });

  it("gives the same rivers every time for the same heights", () => {
    const a = findRivers(island(), SIDE, SIDE);
    const b = findRivers(island(), SIDE, SIDE);
    expect(b.length).toBe(a.length);
    a.forEach((line, k) => {
      expect(b[k].end).toBe(line.end);
      expect(b[k].joins).toBe(line.joins);
      expect(
        Buffer.from(b[k].points.buffer).equals(Buffer.from(line.points.buffer)),
      ).toBe(true);
    });
  });

  it("has fewer rivers where the land is desert", () => {
    const h = island();
    const desert = new Float32Array(h.length).fill(1);
    const wet = findRivers(h, SIDE, SIDE);
    const dry = findRivers(h, SIDE, SIDE, desert);
    const length = (lines: RiverLine[]) =>
      lines.reduce((sum, l) => sum + l.points.length, 0);
    expect(length(dry)).toBeLessThan(length(wet));
  });

  it("widens a river towards the sea", () => {
    const lines = findRivers(island(), SIDE, SIDE);
    const toSea = lines.filter((l) => l.end === "sea");
    expect(toSea.length).toBeGreaterThan(0);
    for (const { points } of toSea) {
      expect(points[points.length - 1]).toBeGreaterThan(points[2]);
    }
  });

  it("finds none on land with no sea and no slope", () => {
    expect(findRivers(new Float32Array(16), 4, 4)).toEqual([]);
  });
});

describe("riverEdgePixels", () => {
  it("is inside a river on its course and outside far from it", () => {
    const line: RiverLine = {
      points: new Float32Array([2, 10, 1, 18, 10, 1]),
      end: "sea",
      joins: -1,
    };
    const edge = riverEdgePixels([line], 20, 20);
    expect(edge.width).toBe(20 * RIVER_EDGE_TEXELS);
    const at = (px: number, py: number) => {
      const t = (v: number) => Math.round((v + 0.5) * RIVER_EDGE_TEXELS - 0.5);
      return edge.data[t(py) * edge.width + t(px)];
    };
    expect(at(10, 10)).toBeLessThan(128);
    expect(at(10, 18)).toBe(255);
  });
});
