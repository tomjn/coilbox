/**
 * The heatmap layer puts a field's cells on the right ground and frees what it
 * made.
 *
 * Nothing renders here, there is no WebGL in the test environment. The scene
 * is a bag to hang objects off, and what is asserted is the mesh, the texture
 * bytes and the calls to `dispose`. The registration test goes the long way
 * round on purpose: world position, to scene position by the shared
 * `worldToScene`, to a UV by the terrain's own geometry, to a texel. A layer
 * that mirrored or transposed the field would fail it.
 */

import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";

import { worldToScene } from "@/placement/scene";
import { buildHeatField } from "./heatField";
import { createHeatmapLayer } from "./heatmapLayer";
import { HEAT_ALPHA_MAX } from "./heatRamp";
import type { MapScene3D } from "./mapScene";

const WORLD = { worldWidth: 16384, worldHeight: 8192 };
/** The preview normalises the longer side to 100 scene units. */
const SCALE = 100 / 16384;
const PLANE_W = WORLD.worldWidth * SCALE;
const PLANE_D = WORLD.worldHeight * SCALE;

/** A terrain built the way `MapPreview3D` builds its own. */
function terrain() {
  const geometry = new THREE.PlaneGeometry(PLANE_W, PLANE_D, 8, 8);
  geometry.rotateX(-Math.PI / 2);
  const relief = new THREE.Texture();
  const material = new THREE.MeshStandardMaterial({
    displacementMap: relief,
    displacementScale: 3.5,
    displacementBias: -0.25,
  });
  return { mesh: new THREE.Mesh(geometry, material), relief };
}

function scene(withTerrain = true) {
  const built = withTerrain ? terrain() : null;
  const render = vi.fn();
  const handle = {
    scene: new THREE.Scene(),
    scale: SCALE,
    planeWidth: PLANE_W,
    planeDepth: PLANE_D,
    render,
    ...(built ? { terrain: built.mesh } : {}),
  } as unknown as MapScene3D;
  return { handle, render, built };
}

const meshOf = (root: THREE.Object3D) =>
  root.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;

const heatOf = (root: THREE.Object3D) =>
  meshOf(root).material.uniforms.heat.value as THREE.DataTexture | null;

/** The UV the geometry gives a scene position, read off its own vertices. */
function uvAt(geometry: THREE.BufferGeometry, x: number, z: number) {
  const position = geometry.getAttribute("position");
  const uv = geometry.getAttribute("uv");
  let west = 0;
  let east = 0;
  let north = 0;
  let south = 0;
  for (let i = 0; i < position.count; i++) {
    if (position.getX(i) < position.getX(west)) west = i;
    if (position.getX(i) > position.getX(east)) east = i;
    if (position.getZ(i) < position.getZ(north)) north = i;
    if (position.getZ(i) > position.getZ(south)) south = i;
  }
  const along = (at: number, a: number, b: number) => (at - a) / (b - a);
  const fx = along(x, position.getX(west), position.getX(east));
  const fz = along(z, position.getZ(north), position.getZ(south));
  return {
    u: uv.getX(west) + (uv.getX(east) - uv.getX(west)) * fx,
    v: uv.getY(north) + (uv.getY(south) - uv.getY(north)) * fz,
  };
}

/** The alpha the texture holds at a UV. A data texture's first row is v = 0. */
function alphaAtUv(texture: THREE.DataTexture, u: number, v: number): number {
  const { data, width, height } = texture.image;
  const col = Math.min(width - 1, Math.floor(u * width));
  const row = Math.min(height - 1, Math.floor(v * height));
  return (data as Uint8ClampedArray)[(row * width + col) * 4 + 3];
}

describe("where the field lands on the terrain", () => {
  it("puts a point at the ground under its world position, not a mirror of it", () => {
    const { handle, built } = scene();
    const layer = createHeatmapLayer(handle);
    // North-east of the middle: 73% of the way east, 24% of the way south.
    const point = { x: 12000, z: 2000 };
    layer.draw(buildHeatField({ positions: [point.x, point.z] }, WORLD));

    const texture = heatOf(layer.root) as THREE.DataTexture;
    const geometry = (built as NonNullable<typeof built>).mesh.geometry;
    const read = (world: { x: number; z: number }) => {
      const at = worldToScene(
        world,
        WORLD.worldWidth,
        WORLD.worldHeight,
        SCALE,
      );
      const { u, v } = uvAt(geometry, at.x, at.z);
      return alphaAtUv(texture, u, v);
    };

    expect(read(point)).toBe(Math.round(HEAT_ALPHA_MAX * 255));
    // Mirrored east to west, mirrored north to south, and both.
    expect(read({ x: 16384 - 12000, z: 2000 })).toBe(0);
    expect(read({ x: 12000, z: 8192 - 2000 })).toBe(0);
    expect(read({ x: 16384 - 12000, z: 8192 - 2000 })).toBe(0);
  });

  it("puts the map's north-west corner at scene negative x and negative z", () => {
    const { handle, built } = scene();
    const geometry = (built as NonNullable<typeof built>).mesh.geometry;
    const at = worldToScene({ x: 0, z: 0 }, 16384, 8192, SCALE);
    expect(at).toEqual({ x: -50, z: -25 });
    // The terrain's UVs put north at v = 1, which is why the field is painted
    // south first.
    expect(uvAt(geometry, at.x, at.z)).toEqual({ u: 0, v: 1 });
    createHeatmapLayer(handle).dispose();
  });
});

describe("lying on the terrain", () => {
  it("shares the terrain's plane and is lifted by the terrain's own heights", () => {
    const { handle, built } = scene();
    const layer = createHeatmapLayer(handle);
    const mesh = meshOf(layer.root);
    const made = built as NonNullable<typeof built>;
    expect(mesh.geometry).toBe(made.mesh.geometry);
    expect(mesh.material.uniforms.relief.value).toBe(made.relief);
    expect(mesh.material.uniforms.reliefScale.value).toBe(3.5);
    expect(mesh.material.uniforms.reliefBias.value).toBe(-0.25);
    expect(mesh.material.uniforms.hasRelief.value).toBe(true);
  });

  it("draws flat on a scene with no terrain", () => {
    const { handle } = scene(false);
    const layer = createHeatmapLayer(handle);
    const mesh = meshOf(layer.root);
    expect(mesh.material.uniforms.hasRelief.value).toBe(false);
    const position = mesh.geometry.getAttribute("position");
    expect(position.count).toBe(4);
  });
});

describe("what is drawn", () => {
  it("draws nothing, and makes no texture, for no field or an empty one", () => {
    const { handle, render } = scene();
    const layer = createHeatmapLayer(handle);
    expect(meshOf(layer.root).visible).toBe(false);

    layer.draw(null);
    expect(heatOf(layer.root)).toBeNull();
    expect(meshOf(layer.root).visible).toBe(false);

    layer.draw(buildHeatField({ positions: [] }, WORLD));
    expect(heatOf(layer.root)).toBeNull();
    expect(meshOf(layer.root).visible).toBe(false);
    expect(render).toHaveBeenCalledTimes(2);
  });

  it("shows a field and asks for a frame", () => {
    const { handle, render } = scene();
    const layer = createHeatmapLayer(handle);
    layer.draw(buildHeatField({ positions: [100, 100] }, WORLD));
    const texture = heatOf(layer.root) as THREE.DataTexture;
    expect(meshOf(layer.root).visible).toBe(true);
    expect(texture.image.width).toBe(256);
    expect(texture.image.height).toBe(128);
    expect(render).toHaveBeenCalledTimes(1);
  });
});

describe("freeing what it made", () => {
  it("disposes the old texture when a new field is drawn", () => {
    const { handle } = scene();
    const layer = createHeatmapLayer(handle);
    layer.draw(buildHeatField({ positions: [100, 100] }, WORLD));
    const first = heatOf(layer.root) as THREE.DataTexture;
    const freed = vi.spyOn(first, "dispose");
    layer.draw(buildHeatField({ positions: [900, 900] }, WORLD));
    expect(freed).toHaveBeenCalledTimes(1);
    expect(heatOf(layer.root)).not.toBe(first);
  });

  it("disposes its texture and material, and leaves the terrain's geometry alone", () => {
    const { handle, built } = scene();
    const layer = createHeatmapLayer(handle);
    layer.draw(buildHeatField({ positions: [100, 100] }, WORLD));
    const mesh = meshOf(layer.root);
    const texture = vi.spyOn(
      heatOf(layer.root) as THREE.DataTexture,
      "dispose",
    );
    const material = vi.spyOn(mesh.material, "dispose");
    const shared = vi.spyOn(
      (built as NonNullable<typeof built>).mesh.geometry,
      "dispose",
    );

    layer.dispose();
    expect(texture).toHaveBeenCalledTimes(1);
    expect(material).toHaveBeenCalledTimes(1);
    expect(shared).not.toHaveBeenCalled();
    expect(handle.scene.getObjectByName("map-heatmap")).toBeUndefined();
  });

  it("disposes the plane it made itself when there was no terrain", () => {
    const { handle } = scene(false);
    const layer = createHeatmapLayer(handle);
    const plane = vi.spyOn(meshOf(layer.root).geometry, "dispose");
    layer.dispose();
    expect(plane).toHaveBeenCalledTimes(1);
  });
});
