import { describe, expect, it } from "vitest";
import type { GalaxyDoc, GalaxyNode } from "../model";
import { buildGroundLayer, planGround } from "./groundLayer";
import { roadLinks } from "./roads";
import { createTerrainSurface } from "./terrain";

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

const doc = {
  id: "map-1",
  factions: [],
  nodes: [
    node("a", [10, 10], { kind: "capital" }),
    node("b", [90, 20]),
    node("c", [50, 90]),
    node("land", [80, 80], { outline: [[[70, 70]]] }),
  ],
  links: [
    ["a", "b"],
    ["b", "c"],
    ["c", "land"],
    ["a", "c"],
  ],
  linkKinds: [["a", "c", "crossing"]],
} as unknown as GalaxyDoc;

const surface = createTerrainSurface(
  { width: 100, height: 100, heightScale: 10 },
  50,
);

describe("planGround", () => {
  it("plans the roads buildGroundLayer paints", () => {
    const plan = planGround(doc, surface, undefined);
    const ground = buildGroundLayer([], doc, surface, undefined);
    expect(plan.roads).toEqual(ground.roads);
    expect(plan.provinceRoads).toEqual(ground.provinceRoads);
    expect(plan.firstProvince).toBe(ground.firstProvince);
    expect(plan.firstExtra).toBe(ground.firstExtra);
    expect(plan.states).toBe(roadLinks(doc).length);
  });

  it("counts the states before shape cuts any road", () => {
    const whole = planGround(doc, surface, undefined);
    const shaped = planGround(doc, surface, undefined, [], (roads) =>
      roads.slice(1),
    );
    expect(shaped.states).toBe(whole.states);
    expect(shaped.roads).toHaveLength(whole.roads.length - 1);
  });
});
