import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { GalaxyDoc } from "../../model";
import { NEUTRAL } from "../../model";
import { createTerrainSurface, type HeightGrid } from "../terrain";
import type { RunLandmark } from "./kinds";
import {
  buildLandmarkLayer,
  landmarkNodes,
  terrainColourReader,
} from "./landmarkLayer";

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
    // Nobody holds it, so it keeps its town.
    node("home", [20, 50], NEUTRAL, "capital"),
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
  identities?: ReadonlyMap<string, { landmark?: RunLandmark }>,
) => {
  const scene = new THREE.Scene();
  const disposables: { dispose(): void }[] = [];
  const layer = buildLandmarkLayer(
    scene,
    disposables,
    surfaceAt(level),
    galaxy,
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
  it("raises a stronghold on the capital a faction holds", () => {
    const { layer } = build();
    expect([...layer.nodes]).toEqual([1]);
    expect(layer.anchors).toHaveLength(1);
    // Its top is above the ground it stands on.
    expect(layer.tops.get(1)).toBeGreaterThan(0);
  });

  it("reports its ring round where it stands, not round its location", () => {
    const { layer, scene } = build();
    const ring = layer.rings.get(1);
    const group = scene.children.find((o) => o instanceof THREE.Group);
    expect(ring?.radius).toBeGreaterThan(0);
    expect(ring?.x).toBe(group?.position.x);
    expect(ring?.z).toBe(group?.position.z);
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

  it("raises a depot where a run asks for one", () => {
    const { layer } = build(
      0.5,
      new Map([["field", { landmark: "depot" as const }]]),
    );
    expect([...layer.nodes].sort()).toEqual([1, 2]);
  });

  it("raises a landing pad where a run asks for one", () => {
    const { layer } = build(
      0.5,
      new Map([["field", { landmark: "landing" as const }]]),
    );
    expect([...layer.nodes].sort()).toEqual([1, 2]);
  });

  it("raises a spire in the stronghold's place where a run asks for one", () => {
    const stronghold = build();
    const spire = build(
      0.5,
      new Map([["their", { landmark: "spire" as const }]]),
    );
    expect([...spire.layer.nodes]).toEqual([1]);
    // The two stand on the same location and are not the same model.
    expect(spire.layer.tops.get(1)).not.toBe(stronghold.layer.tops.get(1));
  });

  it("raises no ruin on a moon, where the anomaly keeps its town", () => {
    const layer = buildLandmarkLayer(
      new THREE.Scene(),
      [],
      surfaceAt(0.5),
      galaxy,
      new Map([["field", { landmark: "ruin" as const }]]),
      "moon",
      undefined,
    );
    expect([...layer.nodes]).toEqual([1]);
  });

  it("raises a standing anomaly on a moon, which a ruin is not", () => {
    const layer = buildLandmarkLayer(
      new THREE.Scene(),
      [],
      surfaceAt(0.5),
      galaxy,
      new Map([["field", { landmark: "monolith" as const }]]),
      "moon",
      undefined,
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

describe("landmarkNodes", () => {
  it("names the capital a faction holds, whoever it is", () => {
    const held = galaxy.nodes.map((n) =>
      n.id === "home" ? { ...n, owner: "me" } : n,
    );
    expect([...landmarkNodes(held, undefined, undefined)]).toEqual([0, 1]);
  });

  it("leaves out a capital nobody holds", () => {
    expect([...landmarkNodes(galaxy.nodes, undefined, undefined)]).toEqual([1]);
  });

  it("leaves out a ruin on a moon", () => {
    const identities = new Map([["field", { landmark: "ruin" as const }]]);
    expect([...landmarkNodes(galaxy.nodes, identities, undefined)]).toEqual([
      1, 2,
    ]);
    expect([...landmarkNodes(galaxy.nodes, identities, "moon")]).toEqual([1]);
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
