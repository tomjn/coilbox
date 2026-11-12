import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { PlanetId } from "../../planets";
import { createTerrainSurface, type HeightGrid } from "../terrain";
import type { TerrainExtension } from "../terrainMesh";
import { planTowns, withStreets } from "../towns";
import { buildForestLayer, FOREST_NAME } from "./forestLayer";

const SIDE = 41;
const MARGIN = 4;
const WIDE = SIDE + 2 * MARGIN;

const flat = (side: number): HeightGrid => ({
  data: new Float32Array(side * side).fill(0.5),
  width: side,
  height: side,
});

/** A level map 20 world units a side whose every pixel is one biome slot. */
const build = (
  opts: {
    planet?: PlanetId;
    slot?: number;
    towns?: boolean;
    biomes?: boolean;
  } = {},
) => {
  const surface = createTerrainSurface(
    { width: 100, height: 100, heightScale: 10 },
    20,
    flat(SIDE),
  );
  const a = new Uint8Array(WIDE * WIDE * 4);
  const b = new Uint8Array(WIDE * WIDE * 4);
  // Slot 2 is forest on a temperate planet.
  const slot = opts.slot ?? 2;
  for (let k = 0; k < WIDE * WIDE; k++)
    (slot < 4 ? a : b)[k * 4 + (slot % 4)] = 255;
  const planet = opts.planet ?? "temperate";
  const extension: TerrainExtension = {
    image: {
      data: new Uint8Array(WIDE * WIDE * 4).fill(128),
      width: WIDE,
      height: WIDE,
    },
    heights: flat(WIDE),
    margin: MARGIN,
    biomes:
      opts.biomes === false
        ? undefined
        : { a, b, width: WIDE, height: WIDE, planet },
  };
  const towns = opts.towns
    ? withStreets(planTowns([{ x: 0, z: 0, capital: true, roads: [0] }], 7), [
        [0],
      ])
    : undefined;
  const scene = new THREE.Scene();
  const disposables: { dispose(): void }[] = [];
  const layer = buildForestLayer(scene, disposables, surface, extension, {
    planet,
    seed: 3,
    towns,
    cleared: opts.towns ? [{ x: 6, z: 6, radius: 2 }] : undefined,
    roads: opts.towns
      ? [
          {
            line: [
              [0, 20],
              [100, 20],
            ],
            surface: "paved",
          },
        ]
      : undefined,
  });
  const meshes: THREE.Mesh[] = [];
  scene.traverse((o) => {
    if (o.name === FOREST_NAME) meshes.push(o as THREE.Mesh);
  });
  return { scene, layer, meshes, surface, towns };
};

/** Every tree's place, read back from the meshes drawn near. */
const places = (meshes: THREE.Mesh[]) => {
  const seen = new Set<THREE.BufferAttribute>();
  const out: [number, number][] = [];
  for (const m of meshes) {
    const at = m.geometry.getAttribute("aAt") as THREE.BufferAttribute;
    if (seen.has(at)) continue;
    seen.add(at);
    for (let i = 0; i < at.count; i++) out.push([at.getX(i), at.getZ(i)]);
  }
  return out;
};

describe("buildForestLayer", () => {
  it("draws every tree it plants, once near and once far", () => {
    const { layer, meshes } = build();
    expect(layer).toBeDefined();
    expect(layer?.count).toBeGreaterThan(1000);
    expect(places(meshes).length).toBe(layer?.count);
    let near = 0;
    for (const m of meshes)
      near += (m.geometry as THREE.InstancedBufferGeometry).instanceCount;
    expect(near).toBe((layer?.count ?? 0) * 2);
  });

  it("builds nothing without weights", () => {
    expect(build({ biomes: false }).layer).toBeUndefined();
  });

  /** How many trees each mesh's material draws as rock, and as anything else. */
  const rockAndOther = (meshes: THREE.Mesh[]) => {
    let rock = 0;
    let other = 0;
    for (const m of meshes) {
      const n = (m.geometry as THREE.InstancedBufferGeometry).instanceCount;
      if ((m.material as THREE.ShaderMaterial).uniforms.uRock.value) rock += n;
      else other += n;
    }
    return { rock, other };
  };

  it("scatters rocks and nothing else on a dead world", () => {
    // Slot 2 is rock on a moon, and slot 0 its regolith.
    const rock = rockAndOther(build({ planet: "moon", slot: 2 }).meshes);
    expect(rock.rock).toBeGreaterThan(1000);
    expect(rock.other).toBe(0);
    const regolith = rockAndOther(build({ planet: "moon", slot: 0 }).meshes);
    expect(regolith.rock).toBeGreaterThan(1000);
    expect(regolith.other).toBe(0);
  });

  it("grows a desert's scrub without a forest palette", () => {
    // Slot 3 is scrub on a desert.
    const { rock, other } = rockAndOther(
      build({ planet: "desert", slot: 3 }).meshes,
    );
    expect(other).toBeGreaterThan(1000);
    expect(rock).toBe(0);
  });

  it("stands back from a town, a landmark's site and a road", () => {
    const { meshes, towns, surface } = build({ towns: true });
    const town = towns?.[0];
    if (!town) throw new Error("no town");
    const [, roadZ] = surface.mapToWorldXZ(0, 20);
    const all = places(meshes);
    expect(all.length).toBeGreaterThan(100);
    for (const [x, z] of all) {
      expect(Math.hypot(x - town.x, z - town.z)).toBeGreaterThan(
        town.radius * 0.7,
      );
      expect(Math.hypot(x - 6, z - 6)).toBeGreaterThanOrEqual(2);
      // The road ends at the map's edge, and trees grow on past it.
      if (Math.abs(x) < 10) expect(Math.abs(z - roadZ)).toBeGreaterThan(0.08);
    }
  });

  it("marks the canopy in the cover picture", () => {
    const { layer } = build();
    const data = layer?.cover.image.data as Uint8Array;
    let covered = 0;
    for (let k = 0; k < data.length; k += 2) if (data[k] > 128) covered++;
    expect(covered / (data.length / 2)).toBeGreaterThan(0.2);
  });

  it("shows a tile near or far, never both", () => {
    const { layer, meshes } = build();
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 2500);
    const shown = () => meshes.filter((m) => m.visible).length;
    camera.position.set(0, 400, 0);
    layer?.update(camera, 900);
    expect(shown()).toBe(meshes.length / 2);
    const far = new Set(meshes.filter((m) => m.visible));
    camera.position.set(0, 3, 0);
    layer?.update(camera, 900);
    expect(shown()).toBe(meshes.length / 2);
    expect(meshes.some((m) => m.visible && !far.has(m))).toBe(true);
  });
});
