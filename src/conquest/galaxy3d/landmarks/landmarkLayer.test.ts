import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { GalaxyDoc } from "../../model";
import { createTerrainSurface, type HeightGrid } from "../terrain";
import { buildLandmarkLayer, terrainColourReader } from "./landmarkLayer";

const SIDE = 101;
const surfaceAt = (level: number) => {
  const grid: HeightGrid = {
    data: new Float32Array(SIDE * SIDE).fill(level),
    width: SIDE,
    height: SIDE,
  };
  return createTerrainSurface(
    { width: 100, height: 100, heightScale: 10 },
    200,
    grid,
  );
};

const node = (
  id: string,
  pos: [number, number],
  owner: string,
  kind?: "capital",
) =>
  ({ id, name: id, pos, owner, kind }) as unknown as GalaxyDoc["nodes"][number];
const galaxy: Pick<GalaxyDoc, "nodes" | "links"> = {
  nodes: [
    node("home", [20, 50], "me", "capital"),
    node("their", [80, 50], "foe", "capital"),
    node("field", [50, 50], "foe"),
  ],
  links: [
    ["home", "field"],
    ["field", "their"],
  ],
};

const build = (
  level = 0.5,
  identities?: ReadonlyMap<string, { landmark?: "ruin" }>,
) => {
  const scene = new THREE.Scene();
  const disposables: { dispose(): void }[] = [];
  const layer = buildLandmarkLayer(
    scene,
    disposables,
    surfaceAt(level),
    galaxy,
    "me",
    identities,
    undefined,
    undefined,
  );
  return { scene, disposables, layer };
};

const shaded = (scene: THREE.Scene) => {
  const out: THREE.ShaderMaterial[] = [];
  scene.traverse((o) => {
    const m = (o as THREE.Mesh).material;
    if (m instanceof THREE.ShaderMaterial && m.uniforms.uHidden) out.push(m);
  });
  return out;
};

describe("buildLandmarkLayer", () => {
  it("raises a stronghold on the enemy capital only", () => {
    const { layer } = build();
    expect([...layer.nodes]).toEqual([1]);
    expect(layer.anchors).toHaveLength(1);
  });

  it("stands no bigger than its design, and is never picked", () => {
    const { scene } = build();
    const groups = scene.children.filter((o) => o instanceof THREE.Group);
    expect(groups).toHaveLength(1);
    expect(groups[0].scale.x).toBeLessThanOrEqual(1);
    const hits: THREE.Intersection[] = [];
    scene.traverse((o) => {
      if (o instanceof THREE.Mesh) o.raycast(new THREE.Raycaster(), hits);
    });
    expect(hits).toHaveLength(0);
  });

  it("goes grey under fog, and ignores a location with no landmark", () => {
    const { scene, layer } = build();
    layer.setStyle(1, { hidden: true });
    for (const m of shaded(scene)) expect(m.uniforms.uHidden.value).toBe(1);
    expect(() => layer.setStyle(0, { hidden: true })).not.toThrow();
  });

  it("raises a ruin where a run asks for one", () => {
    const { layer } = build(
      0.5,
      new Map([["field", { landmark: "ruin" as const }]]),
    );
    expect([...layer.nodes].sort()).toEqual([1, 2]);
  });

  it("raises nothing where the capital is under the sea", () => {
    const { layer, scene } = build(0);
    expect(layer.nodes.size).toBe(0);
    expect(scene.children).toHaveLength(0);
  });

  it("hands every render target it makes to the disposables", () => {
    const { disposables } = build();
    expect(
      disposables.filter((d) => d instanceof THREE.WebGLRenderTarget),
    ).toHaveLength(1);
    expect(
      disposables.filter((d) => d instanceof THREE.BufferGeometry).length,
    ).toBeGreaterThanOrEqual(4);
  });
});

describe("terrainColourReader", () => {
  const surface = surfaceAt(0.5);

  it("reads raw pixels, and leaves any other picture alone", () => {
    const data = new Uint8ClampedArray(4 * 4 * 4).fill(200);
    const read = terrainColourReader({ data, width: 4, height: 4 }, surface);
    expect(read?.(0, 0)).toEqual([200, 200, 200]);
    const canvas = { width: 4, height: 4 } as unknown as HTMLCanvasElement;
    expect(terrainColourReader(canvas, surface)).toBeUndefined();
    expect(terrainColourReader(undefined, surface)).toBeUndefined();
  });
});
