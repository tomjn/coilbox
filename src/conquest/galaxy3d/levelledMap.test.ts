import { describe, expect, it } from "vitest";
import type { GalaxyDoc, GalaxyNode } from "../model";
import { layoutLevelledMap } from "./levelledMap";
import { type HeightGrid, layoutStrategicMap } from "./terrain";

const node = (
  id: string,
  pos: [number, number],
  extra: Partial<GalaxyNode> = {},
): GalaxyNode =>
  ({
    id,
    name: id,
    pos,
    owner: "neutral",
    difficulty: 1,
    ...extra,
  }) as GalaxyNode;

const nodes = [
  node("a", [20, 20], { kind: "capital" }),
  node("b", [70, 25]),
  node("c", [45, 70]),
  node("d", [80, 80]),
];
const links: [string, string][] = [
  ["a", "b"],
  ["b", "c"],
  ["c", "d"],
  ["a", "c"],
];
const doc = {
  id: "map-1",
  factions: [],
  nodes,
  links,
  terrain: { width: 100, height: 100, heightScale: 10 },
} as unknown as GalaxyDoc;
const galaxyDoc = { ...doc, terrain: undefined } as unknown as GalaxyDoc;

// Slopes up in x and stays above sea level, so every town has dry land.
const SIDE = 101;
const slope: HeightGrid = {
  data: Float32Array.from(
    { length: SIDE * SIDE },
    (_, k) => 0.3 + 0.4 * ((k % SIDE) / (SIDE - 1)),
  ),
  width: SIDE,
  height: SIDE,
};

const opts = {
  maxSegments: 256,
  drawTowns: true,
  routeRivers: false,
  skip: new Set<number>(),
};

describe("layoutLevelledMap", () => {
  it("stands a town on level ground", () => {
    const map = layoutLevelledMap(doc, slope, undefined, opts);
    const t = map.towns![0];
    const h = (dx: number) =>
      map.layout.surface!.groundHeightAtWorld(t.x + dx, t.z);
    expect(h(t.radius * 0.5)).toBeCloseTo(h(-t.radius * 0.5), 3);
  });

  it("leaves a skipped location's ground as it was", () => {
    const raw = layoutStrategicMap(doc, slope, 256).surface!;
    const map = layoutLevelledMap(doc, slope, undefined, {
      ...opts,
      skip: new Set([0]),
    });
    const t = map.towns!.find((town) => town.node === 0)!;
    expect(map.layout.surface!.groundHeightAtWorld(t.x + 1, t.z)).toBe(
      raw.groundHeightAtWorld(t.x + 1, t.z),
    );
    const levelled = layoutLevelledMap(doc, slope, undefined, {
      ...opts,
      skip: new Set<number>(),
    });
    expect(levelled.layout.surface!.groundHeightAtWorld(t.x + 1, t.z)).not.toBe(
      raw.groundHeightAtWorld(t.x + 1, t.z),
    );
  });

  it("hands the same heights on when no towns are drawn", () => {
    const map = layoutLevelledMap(doc, slope, undefined, {
      ...opts,
      drawTowns: false,
    });
    expect(map.heights).toBe(slope);
    expect(map.towns).toBeUndefined();
  });

  it("levels a map with no extension and does not throw", () => {
    expect(() => layoutLevelledMap(doc, slope, undefined, opts)).not.toThrow();
  });

  it("lays a map with no terrain out as before", () => {
    const map = layoutLevelledMap(galaxyDoc, undefined, undefined, opts);
    expect(map.layout.surface).toBeUndefined();
    expect(map.plan).toBeUndefined();
  });
});
