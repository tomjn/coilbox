import * as THREE from "three";
import type { CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import { describe, expect, it } from "vitest";
import type { GalaxyDoc, GalaxyNode } from "../model";
import { NEUTRAL } from "../model";
import {
  BADGE_RADIUS,
  buildCityLayer,
  type MapItemState,
  markerLook,
  markerZoom,
} from "./cityLayer";
import type { RoadStyle, TownStyle } from "./groundLayer";
import { ROAD_MODE } from "./groundShader";
import {
  createTerrainSurface,
  GALAXY_MIN_DISTANCE,
  type HeightGrid,
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
/** The badge's parts, as `cityLayer.ts` orders its materials. */
const RIM = 0;
const FILL = 1;
const STAR = 2;
const BRACKETS = 3;

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
  // The ground the roads and towns are painted on, recording their styles.
  const styles: RoadStyle[] = [];
  const towns: TownStyle[] = [];
  let commits = 0;
  const ground = {
    setRoadStyle: (k: number, style: RoadStyle) => {
      styles[k] = style;
    },
    setTownStyle: (i: number, style: TownStyle) => {
      towns[i] = style;
    },
    // The middle city's town reaches 3 world units.
    towns: galaxy.nodes.map((_, i) => ({
      node: i,
      x: 0,
      z: 0,
      radius: i === 1 ? 3 : 1,
      capital: false,
      seed: 0,
      axis: 0,
      aspect: 1,
    })),
    commit: () => {
      commits++;
    },
  };
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
    ground,
  );
  layer.apply();
  const groups = scene.children.filter(
    (c): c is THREE.Group => c instanceof THREE.Group,
  );
  const badge = (g: THREE.Group) => g.children[1] as THREE.Mesh;
  const part = (g: THREE.Group, k: number) =>
    (badge(g).material as THREE.MeshBasicMaterial[])[k];
  // The rim's geometry group is one triangle per side.
  const sidesOf = (g: THREE.Group) => {
    const n = badge(g).geometry.groups[RIM].count / 3;
    return n === 32 ? 0 : n;
  };
  return {
    layer,
    surface,
    groups,
    badge,
    part,
    sidesOf,
    road: (k: number) => styles[k],
    town: (i: number) => towns[i],
    commits: () => commits,
    ownersRef,
    labelObjects,
    cores,
    dims,
  };
}

const hex = (c: THREE.Color) => `#${c.getHexString()}`;

describe("buildCityLayer", () => {
  it("stands a badge on a pole at each point location's anchor", () => {
    const { groups, surface, layer, badge } = build();
    // Four point locations. The province is not this layer's to draw.
    expect(groups).toHaveLength(4);
    expect(layer.has("mid")).toBe(true);
    expect(layer.has("land")).toBe(false);
    const mid = groups[1];
    expect(mid.position.toArray()).toEqual(surface.mapToWorld(50, 50));
    expect(mid.position.y).toBeCloseTo(10 * surface.scale, 5);
    expect(badge(mid).position.y).toBeGreaterThan(BADGE_RADIUS);
    expect(badge(mid).scale.x).toBeCloseTo(BADGE_RADIUS, 5);
  });

  it("gives each badge its owner's colour and faction shape", () => {
    const { part, groups, sidesOf } = build();
    expect(hex(part(groups[0], FILL).color)).toBe(RED);
    expect(hex(part(groups[2], FILL).color)).toBe(BLUE);
    // The first faction is round, the second a hexagon, and no owner round.
    expect(sidesOf(groups[0])).toBe(0);
    expect(sidesOf(groups[2])).toBe(6);
    expect(sidesOf(groups[3])).toBe(0);
    expect(hex(part(groups[3], FILL).color)).not.toBe(RED);
  });

  it("marks a capital with a star and a bigger badge", () => {
    const { groups, part, badge } = build();
    expect(part(groups[0], STAR).visible).toBe(true);
    expect(part(groups[1], STAR).visible).toBe(false);
    expect(badge(groups[0]).scale.x).toBeGreaterThan(badge(groups[1]).scale.x);
  });

  it("edges a road in its owner's colour, and moves it when a city changes hands", () => {
    const { layer, part, groups, sidesOf, road, ownersRef, commits } = build();
    // west to mid shares red. mid to east does not share an owner.
    expect(road(0).mode).toBe(ROAD_MODE.edges);
    expect(hex(road(0).color)).toBe(RED);
    expect(road(1).mode).toBe(ROAD_MODE.plain);
    ownersRef.current = { mid: "blue" };
    layer.apply();
    expect(hex(part(groups[1], FILL).color)).toBe(BLUE);
    expect(sidesOf(groups[1])).toBe(6);
    expect(road(0).mode).toBe(ROAD_MODE.plain);
    expect(road(1).mode).toBe(ROAD_MODE.edges);
    expect(hex(road(1).color)).toBe(BLUE);
    // Each restyle sends the states to the GPU once.
    expect(commits()).toBe(2);
  });

  it("styles a road from a point location to a province's anchor", () => {
    const { road } = build();
    // east and land share blue.
    expect(road(2).mode).toBe(ROAD_MODE.edges);
    expect(hex(road(2).color)).toBe(BLUE);
  });

  it("grows the selected badge and the hovered one, and rings their towns", () => {
    const { layer, groups, badge, part, town } = build();
    const plain = badge(groups[1]).scale.x;
    expect(town(1).ring).toBeUndefined();
    layer.select("mid");
    expect(badge(groups[1]).scale.x).toBeCloseTo(plain * 1.3, 5);
    expect(hex(part(groups[1], RIM).color)).toBe("#ffffff");
    expect(town(1).ring?.thick).toBe(true);
    layer.hover("east");
    expect(badge(groups[2]).scale.x).toBeCloseTo(plain * 1.15, 5);
    expect(town(2).ring?.thick).toBe(false);
    layer.select(null);
    layer.hover(null);
    expect(badge(groups[1]).scale.x).toBe(plain);
    expect(badge(groups[2]).scale.x).toBe(plain);
    expect(hex(part(groups[1], FILL).color)).toBe(RED);
    expect(town(1).ring).toBeUndefined();
    expect(town(2).ring).toBeUndefined();
  });

  it("fades roads with the lane dimming the view passes in", () => {
    const { layer, road, dims } = build();
    const full = road(0).strength;
    dims.lane = 0.5;
    layer.apply();
    expect(road(0).strength).toBeCloseTo(full * 0.5, 5);
    // A plain road gains edges while an end is hovered.
    expect(road(1).mode).toBe(ROAD_MODE.plain);
    dims.lane = 1.6;
    layer.apply();
    expect(road(1).mode).toBe(ROAD_MODE.edges);
    expect(road(1).strength).toBeGreaterThan(0);
  });

  it("grows badges with the camera's distance, with hit targets over badge and town", () => {
    const { layer, groups, badge, cores, surface } = build();
    const plain = badge(groups[1]).scale.x;
    layer.fitToCamera(GALAXY_MIN_DISTANCE * 4);
    const zoom = markerZoom(GALAXY_MIN_DISTANCE * 4);
    expect(zoom).toBeGreaterThan(2);
    expect(badge(groups[1]).scale.x).toBeCloseTo(plain * zoom, 5);
    const m = new THREE.Matrix4();
    const at = new THREE.Vector3();
    const size = new THREE.Vector3();
    cores.getMatrixAt(1, m);
    m.decompose(at, new THREE.Quaternion(), size);
    // Across, it covers most of the town. Upward, from the ground to the
    // top of the badge.
    expect(size.x).toBeCloseTo(3 * 0.85, 5);
    const [x, y, z] = surface.mapToWorld(50, 50);
    expect(at.x).toBeCloseTo(x, 4);
    expect(at.z).toBeCloseTo(z, 4);
    const top = badge(groups[1]).position.y + badge(groups[1]).scale.x;
    expect(at.y - size.y).toBeLessThanOrEqual(y + 1e-6);
    expect(at.y + size.y).toBeGreaterThanOrEqual(y + top);
  });

  it("hangs each name below its badge and keeps it clear as badges grow", () => {
    const { layer, labelObjects, groups, badge } = build();
    const label = labelObjects[1];
    expect(label.center.toArray()).toEqual([0.5, 0]);
    expect(label.position.x).toBe(groups[1].position.x);
    // Looking straight down with north up, below on screen is south.
    const gap = label.position.z - groups[1].position.z;
    expect(gap).toBeGreaterThan(badge(groups[1]).scale.x);
    layer.fitToCamera(GALAXY_MIN_DISTANCE * 4);
    expect(label.position.z - groups[1].position.z).toBeCloseTo(
      gap * markerZoom(GALAXY_MIN_DISTANCE * 4),
      5,
    );
  });

  it("works with no labels, as in performance mode", () => {
    const { layer } = build(false);
    expect(() => {
      layer.apply();
      layer.fitToCamera(GALAXY_MIN_DISTANCE * 3);
    }).not.toThrow();
  });

  it("strips colour, shape, name and capital star from a hidden location", () => {
    const { layer, part, groups, sidesOf, labelObjects, road, town } = build();
    layer.setLocationState("east", { hidden: true });
    layer.setLocationState("west", { hidden: true });
    layer.apply();
    expect(hex(part(groups[2], FILL).color)).not.toBe(BLUE);
    expect(sidesOf(groups[2])).toBe(0);
    expect(labelObjects[2].visible).toBe(false);
    expect(part(groups[0], STAR).visible).toBe(false);
    expect(town(2).hidden).toBe(true);
    // One hidden end leaves a road drawn. A road is gone when its state says
    // so, or when both of its ends are hidden.
    expect(road(1).shown).toBe(true);
    layer.setRoadState("east", "mid", { hidden: true });
    layer.setLocationState("mid", { hidden: true });
    layer.apply();
    expect(road(1).shown).toBe(false);
    expect(road(0).shown).toBe(false);
    // Clearing the states puts everything back without a rebuild.
    for (const id of ["east", "west", "mid"]) {
      layer.setLocationState(id, undefined);
    }
    layer.setRoadState("mid", "east", undefined);
    layer.apply();
    expect(hex(part(groups[2], FILL).color)).toBe(BLUE);
    expect(sidesOf(groups[2])).toBe(6);
    expect(labelObjects[2].visible).toBe(true);
    expect(part(groups[0], STAR).visible).toBe(true);
    expect(town(2).hidden).toBe(false);
    expect(road(1).shown).toBe(true);
  });

  it("brackets an attackable badge and grows an emphasised one", () => {
    const { layer, groups, badge, part, road } = build();
    const plain = badge(groups[2]).scale.x;
    expect(part(groups[2], BRACKETS).visible).toBe(false);
    layer.setLocationState("east", { attackable: true, emphasised: true });
    layer.setRoadState("mid", "east", { attackable: true, emphasised: true });
    layer.apply();
    expect(part(groups[2], BRACKETS).visible).toBe(true);
    expect(hex(part(groups[2], RIM).color)).toBe("#ffcf8a");
    expect(badge(groups[2]).scale.x).toBeGreaterThan(plain);
    expect(road(1).mode).toBe(ROAD_MODE.glow);
    expect(road(1).emphasised).toBe(true);
  });

  it("gives a location under incursion the warning rim, over the attack one", () => {
    const { layer, groups, part } = build();
    layer.setLocationState("east", { attackable: true, threatened: true });
    layer.apply();
    expect(hex(part(groups[2], RIM).color)).toBe("#ffb020");
    expect(part(groups[2], BRACKETS).visible).toBe(true);
  });

  it("draws a road already travelled in the path green", () => {
    const { layer, road } = build();
    layer.setRoadState("west", "mid", { travelled: true });
    layer.apply();
    expect(road(0).mode).toBe(ROAD_MODE.filled);
    expect(hex(road(0).color)).toBe("#46e08a");
  });
});

describe("markerLook", () => {
  // Every state a location takes, from `mapCues.ts` and the view.
  const states: [
    string,
    MapItemState,
    { selected?: boolean; hovered?: boolean },
  ][] = [
    ["plain", {}, {}],
    ["attackable", { attackable: true }, {}],
    ["emphasised", { emphasised: true }, {}],
    ["threatened", { threatened: true }, {}],
    ["hidden", { hidden: true }, {}],
    ["selected", {}, { selected: true }],
    ["hovered", {}, { hovered: true }],
  ];
  const looks = states.map(([name, state, view]) => {
    const look = markerLook({
      state,
      owner: new THREE.Color(BLUE),
      sides: 6,
      capital: false,
      selected: !!view.selected,
      hovered: !!view.hovered,
      dim: 1,
    });
    // Everything that tells the state apart without its colour.
    const shape = [
      look.sides,
      look.brackets,
      look.scale.toFixed(2),
      look.label,
      look.town.hidden,
      look.town.ring?.thick ?? "none",
      look.town.ring?.strength ?? 0,
    ].join(" ");
    return { name, look, shape };
  });

  it("tells every state from plain by more than colour", () => {
    const plain = looks[0].shape;
    for (const { name, shape } of looks.slice(1)) {
      // An incursion has its own warning sign over the place, so its badge
      // differs from plain by its rim alone.
      if (name === "threatened") continue;
      expect([name, shape]).not.toEqual([name, plain]);
    }
  });

  it("keeps the owner off a hidden location", () => {
    const hidden = looks.find((l) => l.name === "hidden")?.look;
    expect(hidden?.sides).toBe(0);
    expect(hidden?.label).toBe(false);
    expect(hex(hidden?.fill ?? new THREE.Color())).not.toBe(BLUE);
  });

  it("dims the whole badge with the view's emphasis", () => {
    const faded = markerLook({
      state: undefined,
      owner: new THREE.Color(BLUE),
      sides: 6,
      capital: true,
      selected: false,
      hovered: false,
      dim: 0.5,
    });
    expect(faded.fill.b).toBeCloseTo(0.5, 5);
    expect(faded.star).toBe(true);
  });
});
