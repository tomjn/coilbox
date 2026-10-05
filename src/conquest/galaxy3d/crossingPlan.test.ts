import { describe, expect, it } from "vitest";
import type { GalaxyDoc, GalaxyNode } from "../model";
import { coastOf, planCrossings } from "./crossingPlan";
import { buildGroundLayer } from "./groundLayer";
import { createProvinceIndex, type Ring } from "./provinces";
import { createTerrainSurface, type HeightGrid } from "./terrain";

const rect = (x: number, y: number, w: number, h: number): Ring => [
  [x, y],
  [x + w, y],
  [x + w, y + h],
  [x, y + h],
];

const node = (id: string, pos: [number, number], outline?: Ring[]) =>
  ({
    id,
    name: id,
    pos,
    owner: "neutral",
    difficulty: 1,
    outline,
  }) as GalaxyNode;

/** Land in the top two and bottom two rows of a 3 by 9 heightmap. */
const rows = [1, 1, 0, 0, 0, 0, 0, 1, 1];
const shores: HeightGrid = {
  data: new Float32Array(rows.flatMap((h) => [h, h, h])),
  width: 3,
  height: 9,
};
const surfaceOf = (heights?: HeightGrid) =>
  createTerrainSurface(
    { width: 100, height: 100, heightScale: 10 },
    200,
    heights,
  );

const generated = {
  id: "plan-test",
  nodes: [
    node("north", [50, 5]),
    node("south", [50, 95]),
    node("pier", [20, 5]),
  ],
  links: [
    ["north", "south"],
    ["north", "pier"],
  ],
  linkKinds: [["north", "south", "crossing"]],
  terrain: {
    image: "generated:cities",
    heightmap: "generated:cities",
    width: 100,
    height: 100,
  },
} as unknown as GalaxyDoc;

describe("coastOf", () => {
  it("reads a generated map's coast from its heights", () => {
    const coast = coastOf(generated, surfaceOf(shores), undefined);
    expect(coast?.isLand(50, 5)).toBe(true);
    expect(coast?.isLand(50, 50)).toBe(false);
  });

  it("reads a hand-made map's coast from its provinces, not its heights", () => {
    const index = createProvinceIndex([{ outline: [rect(40, 40, 20, 20)] }]);
    const doc = { ...generated, handmade: {} } as unknown as GalaxyDoc;
    const coast = coastOf(doc, surfaceOf(shores), index);
    expect(coast?.isLand(50, 5)).toBe(false);
    expect(coast?.isLand(50, 50)).toBe(true);
  });

  it("finds no coast on a map with neither", () => {
    const doc = { ...generated, handmade: {} } as unknown as GalaxyDoc;
    expect(coastOf(doc, surfaceOf(shores), undefined)).toBeUndefined();
  });
});

describe("planCrossings", () => {
  it("plans each crossing and leaves the roads out", () => {
    const plan = planCrossings(generated, surfaceOf(shores));
    expect([...plan.crossings.keys()]).toHaveLength(1);
    const [crossing] = plan.crossings.values();
    expect(crossing.a).toBe("north");
    expect(crossing.route?.jettyA[1][1]).toBeCloseTo(25, 0);
    expect(crossing.route?.jettyB[0][1]).toBeCloseTo(75, 0);
  });

  it("hands over a track from each location to its landing point", () => {
    const plan = planCrossings(generated, surfaceOf(shores));
    expect(plan.tracks.map((t) => t.line[0])).toEqual([
      [50, 5],
      plan.tracks[1].line[0],
    ]);
    expect(plan.tracks[1].line[1]).toEqual([50, 95]);
    for (const t of plan.tracks) expect([t.a, t.b]).toEqual(["north", "south"]);
  });

  it("hands over no track for a location already at sea", () => {
    const doc = {
      ...generated,
      nodes: [node("north", [50, 40]), node("south", [50, 95])],
    } as unknown as GalaxyDoc;
    const plan = planCrossings(doc, surfaceOf(shores));
    expect(plan.tracks).toHaveLength(1);
    expect(plan.tracks[0].line[1]).toEqual([50, 95]);
  });

  it("plans a straight crossing where no coast can be found", () => {
    const plan = planCrossings(generated, surfaceOf());
    expect([...plan.crossings.values()][0].route).toBeUndefined();
    expect(plan.tracks).toEqual([]);
  });
});

describe("buildGroundLayer with extra tracks", () => {
  it("numbers the extra tracks after the roads", () => {
    const surface = surfaceOf(shores);
    const plan = planCrossings(generated, surface);
    const ground = buildGroundLayer(
      [],
      generated,
      surface,
      shores,
      plan.tracks,
    );
    // One road, north to pier, then the crossing's two tracks.
    expect(ground.firstExtra).toBe(1);
    expect(ground.roads.map((r) => r.index)).toEqual([0, 1, 2]);
    expect(ground.roads[1].line).toEqual(plan.tracks[0].line);
  });
});
