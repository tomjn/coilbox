import { describe, expect, it } from "vitest";
import {
  hashString,
  layoutNodes,
  PLAY_EXTENT,
  playBounds,
  Y_JITTER,
} from "./layout";
import { buildStarfield } from "./starfield";

describe("layoutNodes", () => {
  const nodes = [
    { id: "a", pos: [0, 0] as [number, number] },
    { id: "b", pos: [10, 0] as [number, number] },
    { id: "c", pos: [5, 4] as [number, number] },
  ];

  it("scales the longest span to PLAY_EXTENT, centred", () => {
    const laid = layoutNodes(nodes);
    const a = laid.get("a");
    const b = laid.get("b");
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    if (!a || !b) return;
    expect(b[0] - a[0]).toBeCloseTo(PLAY_EXTENT);
    expect(a[0]).toBeCloseTo(-PLAY_EXTENT / 2);
  });

  it("is deterministic and bounds the Y jitter", () => {
    const one = layoutNodes(nodes);
    const two = layoutNodes(nodes);
    expect(one).toEqual(two);
    for (const [, [, y]] of one) {
      expect(Math.abs(y)).toBeLessThanOrEqual(Y_JITTER);
    }
  });

  it("handles a single node without NaN", () => {
    const laid = layoutNodes([{ id: "solo", pos: [7, 7] }]);
    const p = laid.get("solo");
    expect(p?.[0]).toBe(0);
    expect(p?.[2]).toBe(0);
  });

  it("computes bounds over laid-out positions", () => {
    const laid = layoutNodes(nodes);
    const b = playBounds(laid.values());
    expect(b.maxX - b.minX).toBeCloseTo(PLAY_EXTENT);
    expect(b.maxZ).toBeGreaterThan(b.minZ);
  });
});

describe("hashString", () => {
  it("is stable and spreads values", () => {
    expect(hashString("node-1")).toBe(hashString("node-1"));
    expect(hashString("node-1")).not.toBe(hashString("node-2"));
  });
});

describe("buildStarfield", () => {
  const opts = {
    count: 2000,
    radius: 400,
    thickness: 30,
    yOffset: -20,
    seed: "galaxy-1",
  };

  it("returns matching-length buffers, deterministically", () => {
    const a = buildStarfield(opts);
    const b = buildStarfield(opts);
    expect(a.positions.length).toBe(opts.count * 3);
    expect(a.colors.length).toBe(opts.count * 3);
    expect(a.sizes.length).toBe(opts.count);
    expect(a.positions).toEqual(b.positions);
  });

  it("keeps stars inside the disc and around the offset plane", () => {
    const { positions } = buildStarfield(opts);
    let maxR = 0;
    let ySum = 0;
    for (let i = 0; i < opts.count; i++) {
      const x = positions[i * 3];
      const y = positions[i * 3 + 1];
      const z = positions[i * 3 + 2];
      maxR = Math.max(maxR, Math.hypot(x, z));
      ySum += y;
    }
    expect(maxR).toBeLessThanOrEqual(opts.radius);
    expect(ySum / opts.count).toBeCloseTo(opts.yOffset, 0);
  });

  it("honours a custom palette", () => {
    const { colors } = buildStarfield({ ...opts, palette: ["#ff0000"] });
    // All red-tinted: green/blue channels scale with red, never exceed it.
    for (let i = 0; i < 20; i++) {
      expect(colors[i * 3 + 1]).toBe(0);
      expect(colors[i * 3 + 2]).toBe(0);
    }
  });
});
