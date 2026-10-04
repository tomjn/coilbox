import * as THREE from "three";
import type { CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import { describe, expect, it } from "vitest";
import type { GalaxyDoc, GalaxyNode } from "../model";
import { NEUTRAL } from "../model";
import { buildCityLayer } from "./cityLayer";
import {
  createTerrainSurface,
  GALAXY_MAX_DISTANCE,
  type HeightGrid,
  MARKER_LIFT,
} from "./terrain";

/** A 3 by 3 grid with a single peak in the middle. */
const peak: HeightGrid = {
  data: new Float32Array([0, 0, 0, 0, 1, 0, 0, 0, 0]),
  width: 3,
  height: 3,
};

const node = (
  id: string,
  pos: [number, number],
  owner: string,
  extra: Partial<GalaxyNode> = {},
): GalaxyNode => ({
  id,
  name: id,
  pos,
  owner,
  difficulty: 1,
  battle: {} as GalaxyNode["battle"],
  ...extra,
});

const RED = "#ff0000";
const BLUE = "#0000ff";
const GREY = "#6b7280";

function build(labels = true) {
  const galaxy = {
    factions: [
      { id: "red", color: RED },
      { id: "blue", color: BLUE },
    ],
    nodes: [
      node("west", [0, 50], "red", { kind: "capital" }),
      node("mid", [50, 50], "red"),
      node("east", [100, 50], "blue"),
      node("land", [50, 90], "blue", { outline: [[[40, 80]]] }),
      node("free", [10, 10], NEUTRAL),
    ],
    links: [
      ["west", "mid"],
      ["mid", "east"],
      ["east", "land"],
    ],
  } as unknown as GalaxyDoc;
  const surface = createTerrainSurface(
    { width: 100, height: 100, heightScale: 10 },
    200,
    peak,
  );
  const scene = new THREE.Scene();
  const disposables: { dispose(): void }[] = [];
  const ownersRef = { current: {} as Record<string, string> };
  const colors = new Map(
    galaxy.factions.map((f) => [f.id, new THREE.Color(f.color)]),
  );
  const ownerColor = (owner: string | undefined) =>
    (owner ? colors.get(owner) : undefined) ?? new THREE.Color(GREY);
  const labelObjects = (labels
    ? galaxy.nodes.map(() => ({
        position: new THREE.Vector3(),
        center: new THREE.Vector2(0.5, 0.5),
        visible: true,
      }))
    : []) as unknown as CSS2DObject[];
  const geo = new THREE.SphereGeometry(1, 8, 6);
  const cores = new THREE.InstancedMesh(
    geo,
    new THREE.MeshBasicMaterial(),
    galaxy.nodes.length,
  );
  const dims = { lane: 1, node: 1 };
  const layer = buildCityLayer(
    scene,
    disposables,
    galaxy,
    surface,
    ownerColor,
    ownersRef,
    () => dims.lane,
    () => dims.node,
    labelObjects,
    cores,
  );
  layer.apply();
  const groups = scene.children.filter(
    (c): c is THREE.Group => c instanceof THREE.Group,
  );
  const roads = scene.getObjectByName("roads") as THREE.Mesh;
  const roadColor = (road: number) => {
    // The mesh has cells of 50 map units, so a road is sampled every 25. The
    // first two roads are 50 long: 3 points, 6 vertices each.
    const attr = roads.geometry.getAttribute("color");
    const firstVertex = [0, 6, 12][road];
    return [
      attr.getX(firstVertex),
      attr.getY(firstVertex),
      attr.getZ(firstVertex),
      attr.getW(firstVertex),
    ];
  };
  const tops = groups.map(
    (g) =>
      ((g.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial[])[1],
  );
  const sidesOf = (g: THREE.Group) =>
    ((g.children[0] as THREE.Mesh).geometry as THREE.CylinderGeometry)
      .parameters.radialSegments;
  return {
    layer,
    surface,
    scene,
    groups,
    tops,
    sidesOf,
    roads,
    roadColor,
    ownersRef,
    labelObjects,
    cores,
    dims,
    disposables,
  };
}

const hex = (c: THREE.Color) => `#${c.getHexString()}`;

describe("buildCityLayer", () => {
  it("stands a marker on the ground at each point location's anchor", () => {
    const { groups, surface, layer } = build();
    // Four point locations. The province is not this layer's to draw.
    expect(groups).toHaveLength(4);
    expect(layer.has("mid")).toBe(true);
    expect(layer.has("land")).toBe(false);
    const mid = groups[1];
    expect(mid.position.toArray()).toEqual(surface.mapToWorld(50, 50));
    expect(mid.position.y).toBeCloseTo(10 * surface.scale, 5);
    expect(groups[0].position.y).toBe(0);
  });

  it("gives each marker its owner's colour and faction shape", () => {
    const { tops, groups, sidesOf } = build();
    expect(hex(tops[0].color)).toBe(RED);
    expect(hex(tops[2].color)).toBe(BLUE);
    expect(hex(tops[3].color)).toBe(GREY);
    // The first faction is a circle, the second a hexagon, neutral a circle.
    expect(sidesOf(groups[0])).toBe(32);
    expect(sidesOf(groups[2])).toBe(6);
    expect(sidesOf(groups[3])).toBe(32);
  });

  it("marks a capital with a second tier and a bigger block", () => {
    const { groups } = build();
    expect(groups[0].children).toHaveLength(2);
    expect(groups[1].children).toHaveLength(1);
    expect(groups[0].scale.x).toBeGreaterThan(groups[1].scale.x);
  });

  it("recolours a marker and its roads when it changes hands", () => {
    const { layer, tops, groups, sidesOf, roadColor, ownersRef } = build();
    const red = new THREE.Color(RED);
    const blue = new THREE.Color(BLUE);
    // west to mid shares red. mid to east does not share an owner.
    expect(roadColor(0).slice(0, 3)).toEqual([red.r, red.g, red.b]);
    expect(roadColor(1).slice(0, 3)).not.toEqual([blue.r, blue.g, blue.b]);
    ownersRef.current = { mid: "blue" };
    layer.apply();
    expect(hex(tops[1].color)).toBe(BLUE);
    expect(sidesOf(groups[1])).toBe(6);
    expect(roadColor(0).slice(0, 3)).not.toEqual([red.r, red.g, red.b]);
    expect(roadColor(1).slice(0, 3)).toEqual([blue.r, blue.g, blue.b]);
  });

  it("draws a road from a point location to a province's anchor", () => {
    const { roads, surface } = build();
    const position = roads.geometry.getAttribute("position");
    const last = position.count - 1;
    const [x, , z] = surface.mapToWorld(50, 90);
    // The last two vertices sit either side of the province's anchor.
    expect((position.getX(last) + position.getX(last - 1)) / 2).toBeCloseTo(x);
    expect((position.getZ(last) + position.getZ(last - 1)) / 2).toBeCloseTo(z);
  });

  it("grows the selected marker and the hovered one", () => {
    const { layer, groups, tops } = build();
    const plain = groups[1].scale.x;
    layer.select("mid");
    expect(groups[1].scale.x).toBeCloseTo(plain * 1.3, 5);
    expect(hex(tops[1].color)).not.toBe(RED);
    layer.hover("east");
    expect(groups[2].scale.x).toBeCloseTo(plain * 1.15, 5);
    layer.select(null);
    layer.hover(null);
    expect(groups[1].scale.x).toBe(plain);
    expect(groups[2].scale.x).toBe(plain);
    expect(hex(tops[1].color)).toBe(RED);
  });

  it("fades roads with the lane dimming the view passes in", () => {
    const { layer, roadColor, dims } = build();
    const full = roadColor(1)[3];
    dims.lane = 0.5;
    layer.apply();
    expect(roadColor(1)[3]).toBeCloseTo(full * 0.5, 5);
  });

  it("holds marker size past the galaxy view's furthest zoom", () => {
    const { layer, groups, cores, surface } = build();
    const plain = groups[1].scale.x;
    layer.fitToCamera(GALAXY_MAX_DISTANCE / 2);
    expect(groups[1].scale.x).toBe(plain);
    layer.fitToCamera(GALAXY_MAX_DISTANCE * 2);
    expect(groups[1].scale.x).toBeCloseTo(plain * 2, 5);
    // The hit target grows with it and stays on the anchor.
    const m = new THREE.Matrix4();
    cores.getMatrixAt(1, m);
    const at = new THREE.Vector3();
    const scale = new THREE.Vector3();
    m.decompose(at, new THREE.Quaternion(), scale);
    expect(scale.x).toBeCloseTo(4, 5);
    const anchor = surface.mapToWorld(50, 50, MARKER_LIFT);
    at.toArray().forEach((v, axis) => {
      expect(v).toBeCloseTo(anchor[axis], 4);
    });
  });

  it("puts each name below its marker and keeps it clear as markers grow", () => {
    const { layer, labelObjects, groups } = build();
    const label = labelObjects[1];
    expect(label.center.toArray()).toEqual([0.5, 0]);
    expect(label.position.x).toBe(groups[1].position.x);
    const gap = label.position.z - groups[1].position.z;
    expect(gap).toBeGreaterThan(1.35);
    layer.fitToCamera(GALAXY_MAX_DISTANCE * 2);
    expect(label.position.z - groups[1].position.z).toBeCloseTo(gap * 2, 5);
  });

  it("works with no labels, as in performance mode", () => {
    const { layer } = build(false);
    expect(() => {
      layer.apply();
      layer.fitToCamera(GALAXY_MAX_DISTANCE * 3);
    }).not.toThrow();
  });

  it("strips colour, shape, name and capital tier from a hidden location", () => {
    const { layer, tops, groups, sidesOf, labelObjects, roadColor } = build();
    layer.setLocationState("east", { hidden: true });
    layer.setLocationState("west", { hidden: true });
    layer.apply();
    expect(hex(tops[2].color)).not.toBe(BLUE);
    expect(sidesOf(groups[2])).toBe(32);
    expect(labelObjects[2].visible).toBe(false);
    expect(groups[0].children[1].visible).toBe(false);
    // One hidden end leaves a road drawn. A road is gone when its state says
    // so, or when both of its ends are hidden.
    expect(roadColor(1)[3]).toBeGreaterThan(0);
    layer.setRoadState("east", "mid", { hidden: true });
    layer.setLocationState("mid", { hidden: true });
    layer.apply();
    expect(roadColor(1)[3]).toBe(0);
    expect(roadColor(0)[3]).toBe(0);
    // Clearing the states puts everything back without a rebuild.
    for (const id of ["east", "west", "mid"]) {
      layer.setLocationState(id, undefined);
    }
    layer.setRoadState("mid", "east", undefined);
    layer.apply();
    expect(hex(tops[2].color)).toBe(BLUE);
    expect(sidesOf(groups[2])).toBe(6);
    expect(labelObjects[2].visible).toBe(true);
    expect(groups[0].children[1].visible).toBe(true);
    expect(roadColor(1)[3]).toBeGreaterThan(0);
  });

  it("picks out attackable and emphasised locations and roads", () => {
    const { layer, groups, roadColor } = build();
    const plain = groups[2].scale.x;
    const wall = (
      (groups[2].children[0] as THREE.Mesh)
        .material as THREE.MeshBasicMaterial[]
    )[0];
    const before = hex(wall.color);
    const opacity = roadColor(1)[3];
    layer.setLocationState("east", { attackable: true, emphasised: true });
    layer.setRoadState("mid", "east", { attackable: true, emphasised: true });
    layer.apply();
    expect(hex(wall.color)).not.toBe(before);
    expect(groups[2].scale.x).toBeGreaterThan(plain);
    expect(roadColor(1)[3]).toBeGreaterThan(opacity);
  });

  it("gives a location under incursion the warning colour, over the attack one", () => {
    const { layer, groups } = build();
    const wall = (
      (groups[2].children[0] as THREE.Mesh)
        .material as THREE.MeshBasicMaterial[]
    )[0];
    layer.setLocationState("east", { attackable: true });
    layer.apply();
    const attack = hex(wall.color);
    layer.setLocationState("east", { attackable: true, threatened: true });
    layer.apply();
    expect(hex(wall.color)).toBe("#ffb020");
    expect(hex(wall.color)).not.toBe(attack);
  });

  it("draws a road already travelled in the path green", () => {
    const { layer, roadColor } = build();
    layer.setRoadState("west", "mid", { travelled: true });
    layer.apply();
    const [r, g, b] = roadColor(0);
    const green = new THREE.Color(0x46e08a);
    expect(r).toBeCloseTo(green.r);
    expect(g).toBeCloseTo(green.g);
    expect(b).toBeCloseTo(green.b);
  });
});
