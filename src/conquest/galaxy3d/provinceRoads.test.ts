import { describe, expect, it } from "vitest";
import type { GalaxyDoc, GalaxyNode } from "../model";
import {
  planProvinceRoads,
  provinceRegions,
  provinceRoadLinks,
  thinRoads,
  touchingRegions,
} from "./provinceRoads";
import type { Ring } from "./provinces";
import { routeGrid, routeRoad } from "./roadRoute";
import { pairKey } from "./roads";

const rect = (x: number, y: number, w: number, h: number): Ring => [
  [x, y],
  [x + w, y],
  [x + w, y + h],
  [x, y + h],
];

const node = (
  id: string,
  pos: [number, number],
  outline?: Ring[],
  kind?: string,
): GalaxyNode =>
  ({
    id,
    name: id,
    pos,
    owner: "neutral",
    difficulty: 1,
    outline,
    kind,
  }) as GalaxyNode;

/**
 * West, mid and east sit in a row. Wall lies under mid and east, and touches
 * mid behind a blocked border. Isle is over the water, joined to west by a
 * crossing. Port is a city in west with a road out. Far is linked to west but
 * does not touch it.
 */
const doc = {
  id: "map-1",
  factions: [],
  nodes: [
    node("west", [15, 15], [rect(0, 0, 30, 30)], "capital"),
    node("mid", [45, 15], [rect(30, 0, 30, 30)]),
    node("east", [75, 15], [rect(60, 0, 30, 30)]),
    node("wall", [60, 45], [rect(30, 30, 60, 30)]),
    node("isle", [15, 85], [rect(0, 70, 30, 30)]),
    node("far", [90, 90], [rect(80, 80, 20, 20)]),
    node("port", [5, 5]),
  ],
  links: [
    ["west", "mid"],
    ["mid", "east"],
    ["east", "wall"],
    ["west", "isle"],
    ["west", "port"],
    ["west", "far"],
  ],
  linkKinds: [["west", "isle", "crossing"]],
  blockedBorders: [["mid", "wall"]],
} as unknown as GalaxyDoc;

const grid = () => routeGrid(100, 100, 10, 1);

describe("provinceRegions", () => {
  it("puts each cell in the province it lies in, and -1 outside them all", () => {
    const g = grid();
    const region = provinceRegions(doc.nodes, g);
    const at = (x: number, y: number) =>
      region[Math.round(y / g.stepY) * g.cols + Math.round(x / g.stepX)];
    expect(at(10, 10)).toBe(0);
    expect(at(50, 10)).toBe(1);
    expect(at(50, 50)).toBe(3);
    expect(at(50, 90)).toBe(-1);
  });

  it("gives an overlap to the smaller province", () => {
    const g = grid();
    const region = provinceRegions(
      [
        { outline: [rect(0, 0, 100, 100)] },
        { outline: [rect(40, 40, 20, 20)] },
      ],
      g,
    );
    const mid = Math.round(50 / g.stepY) * g.cols + Math.round(50 / g.stepX);
    expect(region[mid]).toBe(1);
    expect(region[0]).toBe(0);
  });
});

describe("provinceRoadLinks", () => {
  const g = grid();
  const touching = touchingRegions(
    provinceRegions(doc.nodes, g),
    g.cols,
    g.rows,
  );
  const touches = (a: number, b: number) =>
    touching.has(pairKey(String(a), String(b)));
  const links = provinceRoadLinks(doc, touches);

  it("joins every two linked provinces that touch, in link order", () => {
    expect(links).toEqual([
      { a: "west", b: "mid" },
      { a: "mid", b: "east" },
      { a: "east", b: "wall" },
    ]);
  });

  it("leaves out a crossing, a city's road, a blocked border and provinces apart", () => {
    const pairs = links.map(({ a, b }) => `${a} ${b}`);
    expect(pairs).not.toContain("west isle");
    expect(pairs).not.toContain("west port");
    expect(pairs).not.toContain("mid wall");
    expect(pairs).not.toContain("west far");
  });

  it("is the same every time", () => {
    expect(provinceRoadLinks(doc, touches)).toEqual(links);
  });
});

describe("thinRoads", () => {
  const at = (id: string): [number, number] =>
    ({ a: [0, 0], b: [10, 0], c: [5, 2], d: [5, 30] })[id] as [number, number];

  it("drops a road with a shorter way round through a third town", () => {
    const roads = [
      { a: "a", b: "b" },
      { a: "a", b: "c" },
      { a: "c", b: "b" },
    ];
    expect(thinRoads(roads, at)).toEqual([
      { a: "a", b: "c" },
      { a: "c", b: "b" },
    ]);
  });

  it("keeps a road whose way round is longer than it is", () => {
    const roads = [
      { a: "a", b: "b" },
      { a: "a", b: "d" },
      { a: "d", b: "b" },
    ];
    expect(thinRoads(roads, at)).toEqual(roads);
  });

  it("keeps every town joined that was joined", () => {
    const ids = ["a", "b", "c", "d"];
    const all = ids.flatMap((p, i) =>
      ids.slice(i + 1).map((q) => ({ a: p, b: q })),
    );
    const kept = thinRoads(all, at);
    const reach = new Set(["a"]);
    for (let round = 0; round < ids.length; round++) {
      for (const { a, b } of kept) {
        if (reach.has(a) || reach.has(b)) {
          reach.add(a);
          reach.add(b);
        }
      }
    }
    expect([...reach].sort()).toEqual(ids);
    expect(kept.length).toBeLessThan(all.length);
  });
});

describe("planProvinceRoads", () => {
  const g = grid();
  const { links, roads } = planProvinceRoads(doc, g, 7);
  it("routes each road from town to town and numbers it from the first index", () => {
    expect(roads.map((r) => r.index)).toEqual([7, 8, 9]);
    links.forEach(({ a, b }, j) => {
      const line = roads[j].line;
      const from = doc.nodes.find((n) => n.id === a)?.pos;
      const to = doc.nodes.find((n) => n.id === b)?.pos;
      expect(line[0]).toEqual(from);
      expect(line[line.length - 1]).toEqual(to);
    });
  });

  it("paves a road into a capital", () => {
    expect(roads[0].surface).toBe("paved");
    expect(roads[1].surface).toBe("track");
  });
});

describe("a road between two provinces", () => {
  // Left and right touch only along the bottom, under the middle province,
  // so the straight line between their anchors runs through the middle.
  const nodes = [
    { outline: [rect(0, 0, 40, 100)] },
    { outline: [rect(40, 0, 20, 80)] },
    { outline: [rect(60, 0, 40, 100), rect(40, 80, 20, 20)] },
  ];
  /** True when any stretch of the line passes through the middle province. */
  const throughMiddle = (line: [number, number][]) =>
    line.slice(1).some(([bx, by], k) => {
      const [ax, ay] = line[k];
      for (let f = 0; f <= 1; f += 0.02) {
        const x = ax + (bx - ax) * f;
        const y = ay + (by - ay) * f;
        if (x > 42 && x < 58 && y < 78) return true;
      }
      return false;
    });

  it("keeps to its own two provinces", () => {
    const g = grid();
    g.region = provinceRegions(nodes, g);
    expect(throughMiddle(routeRoad(g, [10, 10], [80, 10], [0, 2]))).toBe(false);
  });

  it("would run straight through the middle without being told", () => {
    const g = grid();
    expect(throughMiddle(routeRoad(g, [10, 10], [80, 10]))).toBe(true);
  });
});
