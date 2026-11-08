import { describe, expect, it } from "vitest";
import {
  carveValleys,
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

  it("keeps out of a block, running round it", () => {
    const h = island();
    const free = findRivers(h, SIDE, SIDE);
    // A block on a river's course, partway down it.
    const { points } = free.reduce((a, b) =>
      b.points.length > a.points.length ? b : a,
    );
    const k = Math.floor(points.length / 6) * 3;
    const block = { x: points[k], y: points[k + 1], radius: 8 };
    const lines = findRivers(h, SIDE, SIDE, undefined, [block]);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      for (let j = 0; j < line.points.length; j += 3) {
        const d = Math.hypot(
          line.points[j] - block.x,
          line.points[j + 1] - block.y,
        );
        // Smoothing moves a course up to a pixel and a half off the cells
        // it was found on, which is why a block is drawn that much larger.
        expect(d).toBeGreaterThan(block.radius - line.points[j + 2] - 1.5);
      }
    }
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

describe("carveValleys", () => {
  it("cuts a bed under each river and banks rising from it, and leaves the sea", () => {
    const h = island();
    const lines = findRivers(h, SIDE, SIDE);
    const cut = carveValleys(h, SIDE, SIDE, lines);
    for (let i = 0; i < h.length; i++) {
      if (h[i] === 0) expect(cut[i]).toBe(0);
      expect(cut[i]).toBeLessThanOrEqual(h[i]);
    }
    // Along every river the ground is lower than it was, and it rises away
    // from the water on either side.
    const { points } = lines.reduce((a, b) =>
      b.points.length > a.points.length ? b : a,
    );
    const at = (x: number, y: number) => Math.round(y) * SIDE + Math.round(x);
    let lowered = 0;
    let rising = 0;
    let looked = 0;
    for (let j = 6; j + 6 < points.length; j += 3) {
      const [x, y] = [points[j], points[j + 1]];
      const tx = points[j + 3] - points[j - 3];
      const ty = points[j + 4] - points[j - 2];
      const len = Math.hypot(tx, ty) || 1;
      const [nx, ny] = [-ty / len, tx / len];
      const mid = cut[at(x, y)];
      const side = Math.min(
        cut[at(x + nx * 5, y + ny * 5)],
        cut[at(x - nx * 5, y - ny * 5)],
      );
      if (mid === 0 || side === 0) continue;
      looked++;
      if (mid < h[at(x, y)]) lowered++;
      if (side > mid) rising++;
    }
    expect(looked).toBeGreaterThan(10);
    expect(lowered).toBe(looked);
    expect(rising / looked).toBeGreaterThan(0.9);
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
