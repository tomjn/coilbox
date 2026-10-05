import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { GalaxyDoc, GalaxyNode } from "../model";
import { buildGroundLayer } from "./groundLayer";
import { ROAD_MODE } from "./groundShader";
import { hashString } from "./layout";
import { planRoads, roadSurface, sceneSeed } from "./roadNetwork";
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

describe("sceneSeed", () => {
  it("uses a generated map's seed and otherwise the document's id", () => {
    expect(sceneSeed({ id: "x", generated: { seed: 42 } } as GalaxyDoc)).toBe(
      42,
    );
    expect(sceneSeed({ id: "map-1" } as GalaxyDoc)).toBe(hashString("map-1"));
  });
});

describe("roadSurface", () => {
  const degree = (id: string) => ({ hub: 4, hub2: 5, lone: 1 })[id] ?? 0;
  const capital = (id: string) => id === "cap";

  it("paves a road into a capital", () => {
    expect(roadSurface(capital, degree, "lone", "cap")).toBe("paved");
  });

  it("gravels a road between two busy places", () => {
    expect(roadSurface(capital, degree, "hub", "hub2")).toBe("gravel");
  });

  it("leaves every other road a dirt track", () => {
    expect(roadSurface(capital, degree, "hub", "lone")).toBe("track");
  });
});

describe("planRoads", () => {
  const roads = planRoads(doc, 100, 100, 10);

  it("routes every road roadLinks draws, in its order", () => {
    const links = roadLinks(doc);
    expect(roads).toHaveLength(links.length);
    expect(roads.map((r) => r.index)).toEqual(links.map((_, k) => k));
  });

  it("runs each road from one end's anchor to the other's", () => {
    const at = new Map(doc.nodes.map((n) => [n.id, n.pos.slice(0, 2)]));
    roadLinks(doc).forEach(({ a, b }, k) => {
      const line = roads[k].line;
      expect(line[0]).toEqual(at.get(a));
      expect(line[line.length - 1]).toEqual(at.get(b));
    });
  });

  it("paves the road into the capital", () => {
    expect(roads[0].surface).toBe("paved");
    expect(roads[1].surface).toBe("track");
  });
});

describe("buildGroundLayer", () => {
  const surface = createTerrainSurface(
    { width: 100, height: 100, heightScale: 10 },
    50,
  );
  const ground = buildGroundLayer([], doc, surface, undefined);
  const state = (ground.shading.roadState as THREE.DataTexture).image
    .data as Uint8Array;
  const columns = ground.roads.length;

  it("draws every road plain until it is styled", () => {
    for (let k = 0; k < columns; k++) {
      expect(state[(columns + k) * 4]).toBe(255);
      expect(state[k * 4 + 3]).toBe(0);
    }
  });

  it("writes a road's style for the shader, colour in sRGB", () => {
    ground.setRoadStyle(1, {
      shown: true,
      mode: ROAD_MODE.glow,
      color: new THREE.Color(0xff8000),
      strength: 0.5,
      emphasised: true,
    });
    expect(Array.from(state.slice(4, 8))).toEqual([255, 128, 0, 128]);
    expect(
      Array.from(state.slice((columns + 1) * 4, (columns + 1) * 4 + 3)),
    ).toEqual([255, ROAD_MODE.glow, 255]);
  });

  it("hides a road, and keeps a plain road's state from showing", () => {
    ground.setRoadStyle(0, {
      shown: false,
      mode: ROAD_MODE.plain,
      color: new THREE.Color(0xffffff),
      strength: 1,
      emphasised: false,
    });
    expect(state[columns * 4]).toBe(0);
    expect(state[3]).toBe(0);
  });
});
