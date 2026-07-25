import { describe, expect, it } from "vitest";
import {
  BASE_NODE_COUNT,
  hashString,
  layoutNodes,
  PLAY_EXTENT,
  playBounds,
  playExtentFor,
  trimLane,
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

  it("scales the longest span to a custom extent", () => {
    const laid = layoutNodes(nodes, 200);
    const a = laid.get("a");
    const b = laid.get("b");
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    if (!a || !b) return;
    expect(b[0] - a[0]).toBeCloseTo(200);
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

describe("playExtentFor", () => {
  it("returns PLAY_EXTENT at the baseline node count", () => {
    expect(playExtentFor(BASE_NODE_COUNT)).toBeCloseTo(PLAY_EXTENT);
  });

  it("scales with the square root of node count (constant density)", () => {
    expect(playExtentFor(BASE_NODE_COUNT * 4)).toBeCloseTo(PLAY_EXTENT * 2);
  });

  it("never collapses for tiny galaxies", () => {
    expect(playExtentFor(0)).toBeGreaterThan(0);
    expect(playExtentFor(1)).toBeGreaterThan(0);
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
    // Statistical: the sample mean wanders a little with the RNG stream.
    expect(Math.abs(ySum / opts.count - opts.yOffset)).toBeLessThan(2);
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

describe("layoutNodes with real depth", () => {
  it("uses the authored third component instead of the hash jitter", () => {
    const nodes = [
      { id: "a", pos: [-10, 0, -10] as [number, number, number] },
      { id: "b", pos: [10, 0, 10] as [number, number, number] },
    ];
    const out = layoutNodes(nodes, 100);
    // The two nodes sit at opposite vertical extremes, far beyond the +/- 3
    // jitter a flat galaxy would get.
    const heights = [...out.values()].map((p) => p[1]);
    expect(Math.abs(heights[0])).toBeGreaterThan(Y_JITTER);
    expect(heights[0]).toBeCloseTo(-heights[1], 6);
  });

  it("scales height by the same factor as width, keeping depth honest", () => {
    const out = layoutNodes(
      [
        { id: "a", pos: [-10, 0, -10] as [number, number, number] },
        { id: "b", pos: [10, 0, 10] as [number, number, number] },
      ],
      100,
    );
    const a = out.get("a");
    const b = out.get("b");
    // Equal spans in x and z map to equal world spans.
    expect(Math.abs((b?.[0] ?? 0) - (a?.[0] ?? 0))).toBeCloseTo(
      Math.abs((b?.[1] ?? 0) - (a?.[1] ?? 0)),
      6,
    );
  });

  it("keeps the jitter for galaxies without a third component", () => {
    const out = layoutNodes([
      { id: "a", pos: [-10, -10] as [number, number] },
      { id: "b", pos: [10, 10] as [number, number] },
    ]);
    for (const p of out.values())
      expect(Math.abs(p[1])).toBeLessThanOrEqual(Y_JITTER);
  });
});

describe("trimLane", () => {
  it("keeps a lane between systems stacked vertically", () => {
    // The bug this guards: measuring only the top-down projection collapses
    // this lane's length to zero, so it was dropped and the two systems looked
    // unconnected. GJ 229 lost its only lane this way.
    const seg = trimLane([0, -20, 0], [0, 20, 0], 2.45);
    expect(seg).not.toBeNull();
    expect(seg?.[0][1]).toBeCloseTo(-17.55, 5);
    expect(seg?.[1][1]).toBeCloseTo(17.55, 5);
  });

  it("returns a stub rather than nothing for a cramped pair", () => {
    const seg = trimLane([0, 0, 0], [1, 0, 0], 2.45);
    expect(seg).not.toBeNull();
    // Trimmed to 35% in from each end, so a third of the lane still draws.
    expect(seg?.[0][0]).toBeCloseTo(0.35, 5);
    expect(seg?.[1][0]).toBeCloseTo(0.65, 5);
  });

  it("trims by the full amount when there is room", () => {
    const seg = trimLane([0, 0, 0], [100, 0, 0], 2.45);
    expect(seg?.[0][0]).toBeCloseTo(2.45, 5);
    expect(seg?.[1][0]).toBeCloseTo(97.55, 5);
  });

  it("is null only when the ends coincide", () => {
    expect(trimLane([5, 5, 5], [5, 5, 5], 2.45)).toBeNull();
  });
});
