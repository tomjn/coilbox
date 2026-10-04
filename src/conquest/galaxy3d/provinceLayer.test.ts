import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { GalaxyDoc, GalaxyNode } from "../model";
import { NEUTRAL } from "../model";
import { buildProvinceLayer } from "./provinceLayer";
import type { Ring } from "./provinces";
import { createTerrainSurface } from "./terrain";

const square = (x: number, y: number, size: number): Ring => [
  [x, y],
  [x + size, y],
  [x + size, y + size],
  [x, y + size],
];

const node = (
  id: string,
  owner: string,
  pos: [number, number],
  extra: Partial<GalaxyNode> = {},
): GalaxyNode =>
  ({ id, name: id, pos, owner, difficulty: 1, ...extra }) as GalaxyNode;

const terrain = { image: "x", width: 100, height: 100 };

/** Two provinces side by side, a city, and bare land to the south. */
const doc = (nodes: GalaxyNode[], withTerrain = true): GalaxyDoc =>
  ({
    nodes,
    links: [],
    factions: [],
    terrain: withTerrain ? terrain : undefined,
  }) as unknown as GalaxyDoc;

const nodes = [
  node("west", "red", [25, 25], {
    outline: [square(0, 0, 50)],
    kind: "capital",
  }),
  node("city", "red", [10, 10]),
  node("east", "blue", [75, 25], { outline: [square(50, 0, 50)] }),
];

const colors: Record<string, number> = { red: 0xff0000, blue: 0x0000ff };
const ownerColor = (owner: string | undefined) =>
  new THREE.Color(owner && owner in colors ? colors[owner] : 0x808080);

function build(galaxy: GalaxyDoc = doc(nodes)) {
  const scene = new THREE.Scene();
  const ownersRef = { current: {} as Record<string, string> };
  const labels = galaxy.nodes.map(() => new THREE.Object3D());
  const layer = buildProvinceLayer(
    scene,
    [],
    galaxy,
    createTerrainSurface(terrain, 200),
    ownerColor,
    ownersRef,
    labels,
  );
  const fill = (id: string) =>
    (scene.getObjectByName(`province-fill:${id}`) as THREE.Mesh)
      .material as THREE.MeshBasicMaterial;
  const strongCount = () =>
    (scene.getObjectByName("province-borders-strong") as THREE.Mesh).geometry
      .index?.count ?? 0;
  return { scene, ownersRef, labels, layer, fill, strongCount };
}

/** A ray straight down onto a map point. */
const rayAt = (mapX: number, mapY: number) =>
  new THREE.Ray(
    new THREE.Vector3((mapX - 50) * 2, 100, (mapY - 50) * 2),
    new THREE.Vector3(0, -1, 0),
  );

describe("buildProvinceLayer", () => {
  it("builds nothing for a map with no provinces", () => {
    const { scene, layer } = build(
      doc([node("a", "red", [1, 1]), node("b", "blue", [2, 2])]),
    );
    expect(layer).toBeUndefined();
    expect(scene.children).toHaveLength(0);
  });

  it("builds nothing when the document has no terrain", () => {
    const { scene, layer } = build(doc(nodes, false));
    expect(layer).toBeUndefined();
    expect(scene.children).toHaveLength(0);
  });

  it("treats only nodes with an outline as provinces", () => {
    const { scene, layer } = build();
    expect(layer?.isProvince(0)).toBe(true);
    expect(layer?.isProvince(1)).toBe(false);
    expect(layer?.isProvince(2)).toBe(true);
    expect(scene.getObjectByName("province-fill:city")).toBeUndefined();
  });

  it("fills each province in its owner's colour", () => {
    const { fill } = build();
    expect(fill("west").color.getHex()).toBe(0xff0000);
    expect(fill("east").color.getHex()).toBe(0x0000ff);
    expect(fill("west").opacity).toBeLessThan(1);
  });

  it("recolours a province when its owner changes", () => {
    const { layer, ownersRef, fill, strongCount } = build();
    // Red and blue meet, so their border is the strong one.
    expect(strongCount()).toBeGreaterThan(0);
    ownersRef.current = { east: "red" };
    layer?.apply();
    expect(fill("east").color.getHex()).toBe(0xff0000);
    // One owner either side now: no strong border left.
    expect(strongCount()).toBe(0);
    ownersRef.current = { east: NEUTRAL };
    layer?.apply();
    expect(fill("east").color.getHex()).toBe(0x808080);
    expect(strongCount()).toBeGreaterThan(0);
  });

  it("picks a province anywhere inside its outline", () => {
    const { layer } = build();
    expect(layer?.pick(rayAt(3, 47))).toBe(0);
    expect(layer?.pick(rayAt(97, 2))).toBe(2);
  });

  it("picks nothing on land that belongs to no province", () => {
    const { layer } = build();
    expect(layer?.pick(rayAt(50, 80))).toBe(-1);
  });

  it("does not pick a hidden province, and picks it again once revealed", () => {
    const { layer } = build();
    layer?.setProvinceState("west", { hidden: true });
    expect(layer?.pick(rayAt(3, 47))).toBe(-1);
    expect(layer?.pick(rayAt(97, 2))).toBe(2);
    layer?.setProvinceState("west", undefined);
    expect(layer?.pick(rayAt(3, 47))).toBe(0);
  });

  it("highlights the hovered and the selected province as a whole", () => {
    const { layer, fill } = build();
    const plain = fill("west").opacity;
    layer?.hover("west");
    const hovered = fill("west").opacity;
    expect(hovered).toBeGreaterThan(plain);
    layer?.hover(null);
    expect(fill("west").opacity).toBe(plain);
    layer?.select("west");
    expect(fill("west").opacity).toBeGreaterThan(hovered);
    // A point location is not this layer's to highlight.
    layer?.select("city");
    expect(fill("west").opacity).toBe(plain);
  });

  it("keeps a highlight through an owner change", () => {
    const { layer, ownersRef, fill } = build();
    layer?.select("east");
    const selected = fill("east").opacity;
    ownersRef.current = { east: "red" };
    layer?.apply();
    expect(fill("east").opacity).toBe(selected);
  });

  it("hides owner colour, name and capital marker for a hidden province", () => {
    const { scene, layer, labels, fill, strongCount } = build();
    const star = scene.getObjectByName("province-capital:west");
    expect(star?.visible).toBe(true);
    layer?.setProvinceState("west", { hidden: true });
    // Nothing changes until the batch is applied.
    expect(fill("west").color.getHex()).toBe(0xff0000);
    layer?.apply();
    expect(fill("west").color.getHex()).toBe(0x808080);
    expect(labels[0].visible).toBe(false);
    expect(star?.visible).toBe(false);
    expect(strongCount()).toBe(0);
    // Revealing it puts everything back.
    layer?.setProvinceState("west", undefined);
    layer?.apply();
    expect(fill("west").color.getHex()).toBe(0xff0000);
    expect(labels[0].visible).toBe(true);
    expect(star?.visible).toBe(true);
    expect(strongCount()).toBeGreaterThan(0);
  });

  it("restyles for the attackable and emphasised states", () => {
    const { layer, fill } = build();
    const plain = fill("east").opacity;
    layer?.setProvinceState("east", { attackable: true });
    layer?.apply();
    expect(fill("east").opacity).toBeGreaterThan(plain);
    layer?.setProvinceState("east", { emphasised: true });
    layer?.apply();
    expect(fill("east").opacity).toBeGreaterThan(plain);
    layer?.setProvinceState("east", undefined);
    layer?.apply();
    expect(fill("east").opacity).toBe(plain);
  });

  it("tints an attackable province gold and one under incursion amber", () => {
    const { layer, fill } = build();
    const plain = fill("east").color.getHex();
    expect(plain).toBe(0x0000ff);
    layer?.setProvinceState("east", { attackable: true });
    layer?.apply();
    const attack = fill("east").color.clone();
    // Blue moves toward the gold: red and green come up.
    expect(attack.r).toBeGreaterThan(0);
    expect(attack.g).toBeGreaterThan(0);
    layer?.setProvinceState("east", { threatened: true });
    layer?.apply();
    expect(fill("east").color.getHex()).not.toBe(attack.getHex());
    expect(fill("east").color.getHex()).not.toBe(plain);
    layer?.setProvinceState("east", undefined);
    layer?.apply();
    expect(fill("east").color.getHex()).toBe(plain);
  });

  it("hands out the border pieces it draws", () => {
    const { layer } = build();
    const shared = layer?.borders.filter((p) => p.neighbour >= 0) ?? [];
    expect(shared.length).toBeGreaterThan(0);
    for (const p of shared) {
      expect([p.province, p.neighbour].sort()).toEqual([0, 2]);
      expect(p.a[0]).toBe(50);
    }
  });

  it("ignores a state for a node that is not a province", () => {
    const { layer } = build();
    expect(layer?.has("west")).toBe(true);
    expect(layer?.has("city")).toBe(false);
    expect(() => {
      layer?.setProvinceState("city", { hidden: true });
      layer?.setProvinceState("nowhere", { hidden: true });
      layer?.apply();
    }).not.toThrow();
  });

  it("puts a province's name on its anchor", () => {
    const { labels } = build();
    // Map (25, 25) on a 100 unit map 200 world units across.
    expect(labels[0].position.toArray()).toEqual([-50, 0, -50]);
    // A point location's label is left where it was.
    expect(labels[1].position.toArray()).toEqual([0, 0, 0]);
  });
});
