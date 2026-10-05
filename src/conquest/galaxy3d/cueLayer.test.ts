import * as THREE from "three";
import type { CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import { describe, expect, it } from "vitest";
import type { GalaxyDoc, GalaxyNode } from "../model";
import { buildCityLayer, type MapItemState } from "./cityLayer";
import { buildCueLayer, type CueLine, type CueSource } from "./cueLayer";
import { buildProvinceLayer } from "./provinceLayer";
import type { Ring } from "./provinces";
import { createTerrainSurface, type HeightGrid } from "./terrain";

const rect = (x: number, y: number, w: number, h: number): Ring => [
  [x, y],
  [x + w, y],
  [x + w, y + h],
  [x, y + h],
];

const node = (
  id: string,
  owner: string,
  pos: [number, number],
  outline?: Ring[],
): GalaxyNode =>
  ({ id, name: id, pos, owner, difficulty: 1, outline }) as GalaxyNode;

/**
 * West and mid are the player's and touch along x = 30. East is an enemy
 * across a border at x = 60, and runs down the side of wall too. Isle is an enemy over the water to the south,
 * joined to west by a crossing. Wall touches mid's south side behind a
 * blocked border. Port is the player's city in west, with a road to an enemy
 * fort.
 */
const galaxy = {
  factions: [
    { id: "red", color: "#ff0000" },
    { id: "blue", color: "#0000ff" },
  ],
  nodes: [
    node("west", "red", [15, 15], [rect(0, 0, 30, 30)]),
    node("mid", "red", [45, 15], [rect(30, 0, 30, 30)]),
    node("east", "blue", [75, 15], [rect(60, 0, 30, 60)]),
    node("isle", "blue", [15, 85], [rect(0, 70, 30, 30)]),
    node("wall", "blue", [45, 45], [rect(30, 30, 30, 30)]),
    node("port", "red", [5, 5]),
    node("fort", "blue", [95, 50]),
  ],
  links: [
    ["west", "mid"],
    ["mid", "east"],
    ["west", "isle"],
    ["wall", "east"],
    ["west", "port"],
    ["port", "fort"],
  ],
  linkKinds: [["west", "isle", "crossing"]],
  blockedBorders: [["mid", "wall"]],
  terrain: { image: "x", width: 100, height: 100 },
} as unknown as GalaxyDoc;

/** A ridge across the middle of the map, so the crossing has a hill to climb. */
const ridge: HeightGrid = {
  data: new Float32Array([0, 0, 0, 1, 1, 1, 0, 0, 0]),
  width: 3,
  height: 3,
};

function build(doc: GalaxyDoc = galaxy, heights?: HeightGrid) {
  const scene = new THREE.Scene();
  const surface = createTerrainSurface(
    { width: 100, height: 100, heightScale: 10 },
    200,
    heights,
  );
  const colors = new Map(
    doc.factions.map((f) => [f.id, new THREE.Color(f.color)]),
  );
  const ownerColor = (owner: string | undefined) =>
    (owner ? colors.get(owner) : undefined) ?? new THREE.Color(0x6b7280);
  const ownersRef = { current: {} as Record<string, string> };
  const provinces = buildProvinceLayer(
    scene,
    [],
    doc,
    surface,
    ownerColor,
    ownersRef,
    [],
  );
  const cities = buildCityLayer(
    scene,
    [],
    doc,
    surface,
    ownerColor,
    ownersRef,
    () => 1,
    () => 1,
    [] as CSS2DObject[],
    new THREE.InstancedMesh(
      new THREE.SphereGeometry(1, 8, 6),
      new THREE.MeshBasicMaterial(),
      doc.nodes.length,
    ),
    { setRoadStyle: () => {}, commit: () => {} },
  );
  // Record what the cue layer tells the other two.
  const locationStates = new Map<string, MapItemState | undefined>();
  const roadStates = new Map<string, MapItemState | undefined>();
  const input: ReturnType<CueSource> = {
    owners: ownersRef.current,
    playerFactionId: "red",
    attackable: new Set(["east", "isle", "fort"]),
  };
  const dim = { lane: 1 };
  const layer = buildCueLayer(
    scene,
    [],
    doc,
    surface,
    ownerColor,
    () => dim.lane,
    {
      ...cities,
      setLocationState: (id, state) => {
        locationStates.set(id, state);
        cities.setLocationState(id, state);
      },
      setRoadState: (a, b, state) => {
        roadStates.set(`${a} ${b}`, state);
        cities.setRoadState(a, b, state);
      },
    },
    provinces && {
      ...provinces,
      setProvinceState: (id, state) => {
        locationStates.set(id, state);
        provinces.setProvinceState(id, state);
      },
    },
    () => input,
  );
  layer.apply();
  const mesh = scene.getObjectByName("map-cues") as THREE.Mesh | undefined;
  const line = (type: CueLine["type"], a: string, b: string) => {
    const found = layer.lines.find(
      (l) => l.type === type && l.a === a && l.b === b,
    );
    if (!found) throw new Error(`no ${type} line ${a} ${b}`);
    return found;
  };
  /** A line's colour as a hex number, and its opacity. */
  const paintOf = (l: CueLine): [number, number] => {
    const attr = mesh?.geometry.getAttribute("color");
    if (!attr) throw new Error("no cue mesh");
    return [
      new THREE.Color(
        attr.getX(l.start),
        attr.getY(l.start),
        attr.getZ(l.start),
      ).getHex(),
      attr.getW(l.start),
    ];
  };
  /** The corners of a line's ribbons, as map points with world height. */
  const pointsOf = (l: CueLine): [number, number, number][] => {
    const attr = mesh?.geometry.getAttribute("position");
    if (!attr) throw new Error("no cue mesh");
    const out: [number, number, number][] = [];
    for (let v = l.start; v < l.start + l.count; v++) {
      const [x, y] = surface.worldToMap(attr.getX(v), attr.getZ(v));
      out.push([x, y, attr.getY(v)]);
    }
    return out;
  };
  return {
    scene,
    surface,
    layer,
    mesh,
    input,
    dim,
    line,
    paintOf,
    pointsOf,
    locationStates,
    roadStates,
  };
}

const GOLD = 0xffcf8a;
const GREEN = 0x46e08a;

describe("buildCueLayer lines", () => {
  it("builds a line for each crossing, province border and blocked border", () => {
    const { layer } = build();
    expect(layer.lines.map((l) => `${l.type} ${l.a} ${l.b}`).sort()).toEqual([
      "blocked mid wall",
      "crossing west isle",
      "frontier mid east",
      "frontier wall east",
      "frontier west mid",
    ]);
  });

  it("draws a crossing over the gap between the two provinces", () => {
    const { line, pointsOf } = build();
    const points = pointsOf(line("crossing", "west", "isle"));
    const ys = points.map(([, y]) => y);
    // West ends at y = 30 and isle starts at y = 70. The line runs from the
    // last step inside west to the first inside isle, and a step is 0.25.
    expect(Math.min(...ys)).toBeGreaterThan(29);
    expect(Math.min(...ys)).toBeLessThanOrEqual(30);
    expect(Math.max(...ys)).toBeGreaterThan(68);
    expect(Math.max(...ys)).toBeLessThan(71);
    for (const [x] of points) expect(Math.abs(x - 15)).toBeLessThan(1);
  });

  it("dashes a crossing: its ribbons do not cover the whole stretch", () => {
    const { line, pointsOf } = build();
    const points = pointsOf(line("crossing", "west", "isle"));
    // Four corners per stretch of ribbon. Sum the stretches' lengths in map y.
    let drawn = 0;
    for (let v = 0; v < points.length; v += 4) {
      drawn += Math.abs(points[v + 2][1] - points[v][1]);
    }
    const ys = points.map(([, y]) => y);
    const span = Math.max(...ys) - Math.min(...ys);
    expect(drawn).toBeGreaterThan(span * 0.4);
    expect(drawn).toBeLessThan(span * 0.7);
  });

  it("lays a crossing on the ground it passes over", () => {
    const { line, pointsOf, surface } = build(galaxy, ridge);
    const points = pointsOf(line("crossing", "west", "isle"));
    let highest = 0;
    // The middle of each stretch's end is on the path, so check the pairs.
    for (let v = 0; v < points.length; v += 2) {
      const x = (points[v][0] + points[v + 1][0]) / 2;
      const y = (points[v][1] + points[v + 1][1]) / 2;
      const ground = surface.groundHeightAt(x, y);
      expect(points[v][2] - ground).toBeCloseTo(0.16, 4);
      highest = Math.max(highest, ground);
    }
    // The ridge is really under the line.
    expect(highest).toBeGreaterThan(10);
  });

  it("draws a blocked border along the edge the two provinces share", () => {
    const { line, pointsOf, paintOf } = build();
    const blocked = line("blocked", "mid", "wall");
    const points = pointsOf(blocked);
    const xs = points.map(([x]) => x);
    // Mid and wall share y = 30 from x = 30 to x = 60. The ribbon is 1.1
    // world units wide, which is 0.275 map units either side.
    for (const [, y] of points) expect(Math.abs(y - 30)).toBeLessThan(0.3);
    expect(Math.min(...xs)).toBeCloseTo(30, 5);
    expect(Math.max(...xs)).toBeCloseTo(60, 5);
    const [color, opacity] = paintOf(blocked);
    expect(color).toBe(0x14161c);
    expect(opacity).toBeGreaterThan(0.9);
  });

  it("draws a link between provinces that do not touch as a crossing", () => {
    const doc = {
      ...galaxy,
      links: [["west", "isle"]],
      linkKinds: undefined,
      blockedBorders: undefined,
    } as unknown as GalaxyDoc;
    const { layer } = build(doc);
    expect(layer.lines.map((l) => l.type)).toEqual(["crossing"]);
  });

  it("draws a crossing between two cities from anchor to anchor", () => {
    const doc = {
      ...galaxy,
      links: [["port", "fort"]],
      linkKinds: [["port", "fort", "crossing"]],
      blockedBorders: undefined,
    } as unknown as GalaxyDoc;
    const { line, pointsOf } = build(doc);
    const xs = pointsOf(line("crossing", "port", "fort")).map(([x]) => x);
    expect(Math.min(...xs)).toBeLessThan(6);
    expect(Math.max(...xs)).toBeGreaterThan(90);
  });

  it("builds no mesh for a map with nothing to draw", () => {
    const doc = {
      ...galaxy,
      links: [["port", "fort"]],
      linkKinds: undefined,
      blockedBorders: undefined,
    } as unknown as GalaxyDoc;
    const { layer, mesh } = build(doc);
    expect(layer.lines).toEqual([]);
    expect(mesh).toBeUndefined();
    expect(() => layer.apply()).not.toThrow();
  });
});

describe("buildCueLayer on a conquest", () => {
  it("dashes the player's frontier in gold and leaves quiet borders alone", () => {
    const { line, paintOf } = build();
    expect(paintOf(line("frontier", "mid", "east"))).toEqual([GOLD, 1]);
    // Both the player's.
    expect(paintOf(line("frontier", "west", "mid"))[1]).toBe(0);
    // Both the enemy's.
    expect(paintOf(line("frontier", "wall", "east"))[1]).toBe(0);
  });

  it("draws a contested crossing in gold", () => {
    const { line, paintOf } = build();
    expect(paintOf(line("crossing", "west", "isle"))).toEqual([GOLD, 1]);
  });

  it("moves the frontier when a province is captured", () => {
    const { layer, input, line, paintOf } = build();
    input.owners.east = "red";
    layer.apply();
    expect(paintOf(line("frontier", "mid", "east"))[1]).toBe(0);
    expect(paintOf(line("frontier", "wall", "east"))).toEqual([GOLD, 1]);
  });

  it("draws a crossing inside one faction in its colour, and a plain one pale", () => {
    const { layer, input, line, paintOf } = build();
    input.owners.isle = "red";
    layer.apply();
    const [owned, ownedOpacity] = paintOf(line("crossing", "west", "isle"));
    expect(owned).toBe(0xff0000);
    expect(ownedOpacity).toBeGreaterThan(0.5);
    input.owners.west = "blue";
    input.owners.isle = "green";
    layer.apply();
    const [plain, plainOpacity] = paintOf(line("crossing", "west", "isle"));
    expect(plain).toBe(0xe2dccb);
    expect(plainOpacity).toBeGreaterThan(0.5);
  });

  it("fades and lifts its lines with the hovered location, as roads do", () => {
    const { layer, input, dim, line, paintOf } = build();
    input.owners.west = "blue";
    input.owners.isle = "green";
    layer.apply();
    const plain = paintOf(line("crossing", "west", "isle"))[1];
    dim.lane = 0.4;
    layer.apply();
    expect(paintOf(line("crossing", "west", "isle"))[1]).toBeLessThan(plain);
    dim.lane = 1.6;
    layer.apply();
    expect(paintOf(line("crossing", "west", "isle"))[1]).toBe(1);
  });

  it("tells each province and city whether it can be attacked", () => {
    const { locationStates } = build();
    expect(locationStates.get("east")?.attackable).toBe(true);
    expect(locationStates.get("isle")?.attackable).toBe(true);
    expect(locationStates.get("fort")?.attackable).toBe(true);
    expect(locationStates.get("wall")).toBeUndefined();
    expect(locationStates.get("west")).toBeUndefined();
  });

  it("restyles the province fills", () => {
    const { scene } = build();
    const fill = (id: string) =>
      (scene.getObjectByName(`province-fill:${id}`) as THREE.Mesh)
        .material as THREE.MeshBasicMaterial;
    // East can be attacked and wall cannot, and both are blue.
    expect(fill("east").color.getHex()).not.toBe(0x0000ff);
    expect(fill("wall").color.getHex()).toBe(0x0000ff);
  });

  it("emphasises the selected province's neighbours, over a crossing too", () => {
    const { layer, input, locationStates, line, paintOf } = build();
    input.selectedId = "west";
    layer.apply();
    expect(locationStates.get("mid")?.emphasised).toBe(true);
    expect(locationStates.get("isle")?.emphasised).toBe(true);
    expect(locationStates.get("port")?.emphasised).toBe(true);
    expect(locationStates.get("east")?.emphasised).toBe(false);
    // The crossing out of the selection is whitened.
    expect(paintOf(line("crossing", "west", "isle"))[0]).not.toBe(GOLD);
    input.selectedId = null;
    layer.apply();
    expect(locationStates.get("mid")).toBeUndefined();
    expect(paintOf(line("crossing", "west", "isle"))[0]).toBe(GOLD);
  });

  it("marks the province under incursion", () => {
    const { layer, input, locationStates } = build();
    input.incursionNodeId = "mid";
    layer.apply();
    expect(locationStates.get("mid")?.threatened).toBe(true);
    input.incursionNodeId = undefined;
    layer.apply();
    expect(locationStates.get("mid")).toBeUndefined();
  });

  it("marks a contested road attackable and clears a quiet one", () => {
    const { roadStates } = build();
    expect(roadStates.get("port fort")).toMatchObject({ attackable: true });
    expect(roadStates.get("west port")).toBeUndefined();
  });
});

describe("buildCueLayer under fog of war", () => {
  // The player sees their own provinces, their city and east.
  const fogged = () => {
    const built = build();
    built.input.visible = new Set(["west", "mid", "port", "east"]);
    built.layer.apply();
    return built;
  };
  const fill = (scene: THREE.Scene, id: string) =>
    (scene.getObjectByName(`province-fill:${id}`) as THREE.Mesh)
      .material as THREE.MeshBasicMaterial;

  it("tells each hidden province and city it is hidden, and nothing else", () => {
    const { locationStates } = fogged();
    for (const id of ["isle", "wall", "fort"]) {
      expect(locationStates.get(id)).toEqual({
        attackable: false,
        emphasised: false,
        threatened: false,
        hidden: true,
      });
    }
    expect(locationStates.get("east")?.hidden).toBe(false);
  });

  it("takes the owner colour off a hidden province and keeps its shape", () => {
    const { scene } = fogged();
    // Isle and wall are blue. Hidden, they take the neutral grey.
    expect(fill(scene, "isle").color.getHex()).toBe(0x6b7280);
    expect(fill(scene, "wall").color.getHex()).toBe(0x6b7280);
    expect(fill(scene, "isle").opacity).toBeGreaterThan(0);
    expect(scene.getObjectByName("province-fill:isle")?.visible).toBe(true);
  });

  it("does not draw a frontier or crossing between two hidden provinces", () => {
    const built = build();
    built.input.owners.wall = "red";
    built.layer.apply();
    expect(built.paintOf(built.line("frontier", "wall", "east"))[1]).toBe(1);
    built.input.visible = new Set(["west", "mid", "port"]);
    built.layer.apply();
    expect(built.paintOf(built.line("frontier", "wall", "east"))[1]).toBe(0);
  });

  it("draws a crossing into the fog plain, and no frontier onto hidden land", () => {
    const { line, paintOf } = fogged();
    const [color, opacity] = paintOf(line("crossing", "west", "isle"));
    expect(color).toBe(0xe2dccb);
    expect(opacity).toBeGreaterThan(0);
    const built = build();
    built.input.visible = new Set(["west", "mid", "port"]);
    built.layer.apply();
    expect(built.paintOf(built.line("frontier", "mid", "east"))[1]).toBe(0);
  });

  it("keeps a blocked border with one visible side and drops one with none", () => {
    const { line, paintOf } = fogged();
    expect(paintOf(line("blocked", "mid", "wall"))[1]).toBeGreaterThan(0.9);
    const built = build();
    built.input.visible = new Set(["west", "port"]);
    built.layer.apply();
    expect(built.paintOf(built.line("blocked", "mid", "wall"))[1]).toBe(0);
  });

  it("marks a road between two hidden cities hidden", () => {
    const built = build();
    built.input.visible = new Set(["west", "mid"]);
    built.layer.apply();
    expect(built.roadStates.get("port fort")).toMatchObject({ hidden: true });
  });

  it("restores colour, cues and lines when the fog lifts, with no rebuild", () => {
    const built = fogged();
    const mesh = built.mesh;
    built.input.visible = new Set([
      "west",
      "mid",
      "port",
      "east",
      "isle",
      "wall",
      "fort",
    ]);
    built.layer.apply();
    expect(fill(built.scene, "wall").color.getHex()).toBe(0x0000ff);
    expect(built.locationStates.get("isle")).toMatchObject({
      attackable: true,
      hidden: false,
    });
    expect(built.paintOf(built.line("crossing", "west", "isle"))).toEqual([
      GOLD,
      1,
    ]);
    expect(built.scene.getObjectByName("map-cues")).toBe(mesh);
    built.input.visible = undefined;
    built.layer.apply();
    expect(built.locationStates.get("wall")).toBeUndefined();
  });
});

describe("buildCueLayer on a Warpath run", () => {
  // The player came from west and stands on mid.
  const run = () => {
    const built = build();
    Object.assign(built.input, {
      owners: {
        west: "taken",
        mid: "red",
        east: "blue",
        isle: "blue",
        wall: "blue",
        port: "taken",
        fort: "blue",
      },
      attackable: undefined,
      run: { pathLinks: new Set(["west mid"]) },
    });
    built.layer.apply();
    return built;
  };

  it("draws the border already crossed in green and the open one in gold", () => {
    const { line, paintOf } = run();
    expect(paintOf(line("frontier", "west", "mid"))).toEqual([GREEN, 1]);
    expect(paintOf(line("frontier", "mid", "east"))).toEqual([GOLD, 1]);
    expect(paintOf(line("frontier", "wall", "east"))[1]).toBe(0);
  });

  it("marks the provinces the open choices lead to", () => {
    const { locationStates } = run();
    expect(locationStates.get("east")?.attackable).toBe(true);
    expect(locationStates.get("isle")).toBeUndefined();
  });

  it("marks a road already travelled", () => {
    const built = run();
    built.input.run = { pathLinks: new Set(["west mid", "west port"]) };
    built.layer.apply();
    expect(built.roadStates.get("west port")).toMatchObject({
      travelled: true,
      attackable: false,
    });
  });
});
