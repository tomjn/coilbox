import { describe, expect, it } from "vitest";
import { erodeRelief, runDrops } from "./displayErosion";
import { mulberry32 } from "./rng";

const SIDE = 192;

/**
 * Rolling land: a tilted plane with a couple of bumps and some noise, with a
 * strip of sea down the left edge. Heights are 0 to 1 like the generator's
 * relief.
 */
function hills(): Float32Array {
  const rng = mulberry32(7);
  const out = new Float32Array(SIDE * SIDE);
  for (let y = 0; y < SIDE; y++) {
    for (let x = 0; x < SIDE; x++) {
      if (x < 6) continue;
      const bump =
        Math.exp(-(((x - 60) / 22) ** 2 + ((y - 40) / 22) ** 2)) * 0.5 +
        Math.exp(-(((x - 30) / 14) ** 2 + ((y - 70) / 14) ** 2)) * 0.3;
      out[y * SIDE + x] = 0.05 + (x / SIDE) * 0.15 + bump + rng() * 0.0002;
    }
  }
  return out;
}

const same = (a: Float32Array, b: Float32Array) =>
  a.length === b.length && a.every((v, i) => v === b[i]);

describe("erodeRelief", () => {
  it("gives the same heights twice for the same seed", () => {
    const a = erodeRelief(hills(), SIDE, SIDE, 1234);
    const b = erodeRelief(hills(), SIDE, SIDE, 1234);
    expect(Buffer.from(a.buffer).equals(Buffer.from(b.buffer))).toBe(true);
  });

  it("carves differently for a different seed", () => {
    const a = erodeRelief(hills(), SIDE, SIDE, 1234);
    const b = erodeRelief(hills(), SIDE, SIDE, 1235);
    expect(same(a, b)).toBe(false);
  });

  it("changes the land but leaves the input alone", () => {
    const input = hills();
    const copy = input.slice();
    const out = erodeRelief(input, SIDE, SIDE, 1);
    expect(same(input, copy)).toBe(true);
    expect(out).toHaveLength(input.length);
    expect(same(out, input)).toBe(false);
  });

  it("keeps the sea at zero and every height between 0 and 1", () => {
    const input = hills();
    const out = erodeRelief(input, SIDE, SIDE, 2);
    for (let i = 0; i < out.length; i++) {
      if (input[i] === 0) expect(out[i]).toBe(0);
      expect(out[i]).toBeGreaterThanOrEqual(0);
      expect(out[i]).toBeLessThanOrEqual(1);
    }
  });

  it("leaves the shape of whole hills to the pinned heights", () => {
    const input = hills();
    const out = erodeRelief(input, SIDE, SIDE, 3);
    // Averaged over a window, what the drops moved is small next to how much
    // they moved at single pixels: the change is fine detail.
    const WINDOW = 48;
    let fine = 0;
    let broad = 0;
    let windows = 0;
    for (let y0 = 0; y0 + WINDOW <= SIDE; y0 += WINDOW) {
      for (let x0 = 16; x0 + WINDOW <= SIDE; x0 += WINDOW) {
        let sum = 0;
        for (let y = y0; y < y0 + WINDOW; y++) {
          for (let x = x0; x < x0 + WINDOW; x++) {
            const d = out[y * SIDE + x] - input[y * SIDE + x];
            fine += Math.abs(d);
            sum += d;
          }
        }
        broad += Math.abs(sum);
        windows++;
      }
    }
    const pixels = windows * WINDOW * WINDOW;
    expect(fine / pixels).toBeGreaterThan(0.001);
    expect(broad / pixels).toBeLessThan((fine / pixels) * 0.3);
  });

  it("lays what it carves out along the fall line", () => {
    // A slope falling to the south, with small ripples across it for the
    // water to gather in.
    const rng = mulberry32(11);
    const ripple = Array.from({ length: SIDE }, () => rng() * 0.004);
    const input = new Float32Array(SIDE * SIDE);
    for (let y = 0; y < SIDE; y++) {
      for (let x = 0; x < SIDE; x++) {
        input[y * SIDE + x] = 0.7 - (y / SIDE) * 0.5 + ripple[x];
      }
    }
    const out = erodeRelief(input, SIDE, SIDE, 4);
    // What the drops changed, and how fast it varies across the slope against
    // down it. Channels running downhill vary quickly across and slowly down.
    let across = 0;
    let down = 0;
    for (let y = 20; y < SIDE - 20; y++) {
      for (let x = 20; x < SIDE - 20; x++) {
        const at = (dx: number, dy: number) => {
          const i = (y + dy) * SIDE + x + dx;
          return out[i] - input[i];
        };
        across += Math.abs(at(1, 0) - at(-1, 0));
        down += Math.abs(at(0, 1) - at(0, -1));
      }
    }
    expect(across).toBeGreaterThan(down * 1.5);
  });

  it("never builds land up in the sea from drops that run into it", () => {
    // Land rising from the sea at the left edge, so every drop ends there.
    const side = 96;
    const h = new Float32Array(side * side);
    for (let y = 0; y < side; y++) {
      for (let x = 4; x < side; x++) {
        h[y * side + x] = 0.01 + (x - 4) * 0.003;
      }
    }
    const before = h.slice();
    runDrops(h, side, side, mulberry32(9));
    // The drops did run: some land moved.
    expect(same(h, before)).toBe(false);
    for (let y = 0; y < side; y++) {
      for (let x = 0; x < 4; x++) expect(h[y * side + x]).toBe(0);
    }
  });

  it("leaves flat land flat", () => {
    const flat = new Float32Array(SIDE * SIDE).fill(0.3);
    const out = erodeRelief(flat, SIDE, SIDE, 5);
    expect(same(out, flat)).toBe(true);
  });

  it("handles an odd sized grid", () => {
    const side = 51;
    const input = new Float32Array(side * side);
    for (let i = 0; i < input.length; i++) input[i] = 0.1 + (i % side) / 200;
    const out = erodeRelief(input, side, side, 6);
    expect(out).toHaveLength(input.length);
    expect(out.every(Number.isFinite)).toBe(true);
  });
});
