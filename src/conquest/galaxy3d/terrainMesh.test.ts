import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createTerrainSurface, type HeightGrid } from "./terrain";
import {
  beyondFrame,
  beyondPixels,
  buildTerrainMesh,
  edgeColor,
} from "./terrainMesh";

/** A 4 by 3 picture: the edge one colour, the middle another. */
function framed(): { data: Uint8ClampedArray; width: number; height: number } {
  const width = 4;
  const height = 3;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const edge = x === 0 || y === 0 || x === width - 1 || y === height - 1;
      data.set(edge ? [24, 58, 96, 255] : [200, 200, 0, 255], i);
    }
  }
  return { data, width, height };
}

describe("edgeColor", () => {
  it("reads only the outermost pixels", () => {
    expect(edgeColor(framed())).toEqual([24, 58, 96]);
  });

  it("is the sea when land runs off one side, not a blend with the land", () => {
    // 8 by 8, sea everywhere except a column of land down the left edge.
    const width = 8;
    const height = 8;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        data.set(
          x === 0 ? [100, 160, 80, 255] : [24, 58, 96, 255],
          (y * width + x) * 4,
        );
      }
    }
    expect(edgeColor({ data, width, height })).toEqual([24, 58, 96]);
  });
});

/** A 64 by 64 picture, green land on the left half and blue sea on the right. */
function halves(): { data: Uint8ClampedArray; width: number; height: number } {
  const width = 64;
  const height = 64;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      data.set(
        x < 32 ? [100, 160, 80, 255] : [24, 58, 96, 255],
        (y * width + x) * 4,
      );
    }
  }
  return { data, width, height };
}

describe("beyondPixels", () => {
  const beyond = beyondPixels(halves());
  const px = (x: number, y: number) =>
    Array.from(
      beyond.data.slice(
        (y * beyond.width + x) * 4,
        (y * beyond.width + x) * 4 + 3,
      ),
    );
  // The picture spans three sheets, so the map's own place is the middle third.
  const third = beyond.width / 3;
  const mid = Math.floor(beyond.height / 2);

  it("carries land on past an edge where land meets it, and sea where sea does", () => {
    const left = px(Math.floor(third) - 1, mid);
    const right = px(Math.ceil(2 * third), mid);
    expect(left[1]).toBeGreaterThan(left[2]);
    expect(right[2]).toBeGreaterThan(right[1]);
  });

  it("starts as bright as the map, so no seam shows at the edge", () => {
    // The sea half runs all the way to the right edge, so just past it the
    // world beyond is the sea, under a twentieth of the way into its fade.
    const sea = [24, 58, 96];
    const far = edgeColor(halves());
    const got = px(Math.ceil(2 * third), mid);
    for (let c = 0; c < 3; c++) {
      expect(Math.abs(got[c] - sea[c])).toBeLessThanOrEqual(
        Math.abs(far[c] - sea[c]) / 20 + 1,
      );
    }
  });

  it("takes its colour from the edge itself, not from inside the map", () => {
    // Sea at every edge and a lighter ring just inside, as round an island
    // near the frame. The world beyond must match the deep sea at the edge.
    const width = 64;
    const height = 64;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const edge = x === 0 || y === 0 || x === width - 1 || y === height - 1;
        data.set(
          edge ? [24, 58, 96, 255] : [80, 140, 180, 255],
          (y * width + x) * 4,
        );
      }
    }
    const ringed = beyondPixels({ data, width, height });
    const o = (mid * ringed.width + Math.floor(third) - 1) * 4;
    expect(Array.from(ringed.data.slice(o, o + 3))).toEqual([24, 58, 96]);
  });

  it("blurs only a few pixels beside the edge, and widely further out", () => {
    // Sea everywhere but the top half of the left edge, so that edge changes
    // colour halfway down and the sea is the colour far out.
    const width = 64;
    const height = 64;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const land = x === 0 && y < 32;
        data.set(land ? [100, 160, 80, 255] : [24, 58, 96, 255], (y * width + x) * 4);
      }
    }
    const out = beyondPixels({ data, width, height });
    const px = (x: number, y: number) =>
      Array.from(out.data.slice((y * out.width + x) * 4, (y * out.width + x) * 4 + 3));
    // Eight rows above the change, just left of the edge: land, not a blend.
    const row = Math.floor(third) + 23;
    const [r, g, b] = px(Math.floor(third) - 1, row);
    expect(Math.abs(r - 100)).toBeLessThanOrEqual(4);
    expect(Math.abs(g - 160)).toBeLessThanOrEqual(4);
    expect(Math.abs(b - 80)).toBeLessThanOrEqual(4);
    // Far out the same row is blurred with the sea below it.
    const [, farGreen] = px(Math.floor(third) - 12, row);
    expect(farGreen).toBeLessThan(150);
  });

  it("carries alpha out the same way when asked for four channels", () => {
    // Alpha as height: land (200) on the left half, sea (0) on the right.
    const width = 64;
    const height = 64;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        data.set([128, 255, 128, x < 32 ? 200 : 0], (y * width + x) * 4);
      }
    }
    const carried = beyondPixels({ data, width, height }, 4);
    const alpha = (x: number, y: number) =>
      carried.data[(y * carried.width + x) * 4 + 3];
    expect(alpha(Math.floor(third) - 1, mid)).toBeGreaterThan(150);
    // Sea just past the right edge, under a twentieth of the way into its fade.
    expect(alpha(Math.ceil(2 * third), mid)).toBeLessThanOrEqual(200 / 20 + 1);
    // Without the fourth channel the picture is opaque, as before.
    expect(beyondPixels({ data, width, height }).data[3]).toBe(255);
  });

  it("fades to the edge's most common colour far from the map", () => {
    const far = edgeColor(halves());
    expect(px(0, 0)).toEqual(far);
    expect(px(beyond.width - 1, beyond.height - 1)).toEqual(far);
  });
});

describe("the sheet's shader", () => {
  const grid: HeightGrid = {
    data: new Float32Array([0, 0.5, 0.5, 1]),
    width: 2,
    height: 2,
  };
  const build = (
    color: Parameters<typeof buildTerrainMesh>[3],
    heights?: HeightGrid,
    detail?: boolean,
  ) => {
    const surface = createTerrainSurface(
      { width: 64, height: 64 },
      100,
      heights,
    );
    const disposables: { dispose(): void }[] = [];
    const mesh = buildTerrainMesh(
      new THREE.Scene(),
      disposables,
      surface,
      color,
      { current: null },
      heights,
      detail,
    );
    for (const d of disposables) d.dispose();
    return mesh.material as THREE.MeshBasicMaterial;
  };

  it("lights the slopes and adds detail on a generated map", () => {
    expect(build(halves(), grid).customProgramCacheKey()).toBe("terrain:1:1");
  });

  it("drops the detail when asked, as performance mode does", () => {
    expect(build(halves(), grid, false).customProgramCacheKey()).toBe(
      "terrain:1:0",
    );
  });

  it("leaves a hand-made picture without procedural detail", () => {
    // A bitmap stands in for a painted picture, which never arrives as pixels.
    const painted = { width: 2, height: 2 } as unknown as ImageBitmap;
    expect(build(painted, grid).customProgramCacheKey()).toBe("terrain:1:0");
  });

  it("has no relief or detail on a flat sheet", () => {
    // Detail tells sea from land by the height, so with none it stays off
    // rather than reading the whole map as sea.
    expect(build(halves()).customProgramCacheKey()).toBe("terrain:0:0");
  });

  it("carries the sheet's shading onto the world beyond, fading past the edge", () => {
    const surface = createTerrainSurface({ width: 64, height: 64 }, 100, grid);
    const scene = new THREE.Scene();
    const disposables: { dispose(): void }[] = [];
    buildTerrainMesh(scene, disposables, surface, halves(), { current: null }, grid);
    for (const d of disposables) d.dispose();
    const beyond = scene.getObjectByName("beyond-the-map") as THREE.Mesh;
    const mat = beyond.material as THREE.MeshBasicMaterial;
    expect(mat.customProgramCacheKey()).toBe("terrain:1:1");
    const shader = {
      uniforms: {},
      vertexShader: THREE.ShaderLib.basic.vertexShader,
      fragmentShader: THREE.ShaderLib.basic.fragmentShader,
    } as unknown as THREE.WebGLProgramParametersWithUniforms;
    mat.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
    const u = shader.uniforms as Record<string, { value: unknown }>;
    expect(u.uTerrainFade.value).toBe(beyondFrame(surface).fade);
    expect((u.uTerrainFrame.value as THREE.Vector4).toArray()).toEqual([
      50, 50, 100, 100,
    ]);
  });

  it("leaves the world beyond plain when the sheet has no relief", () => {
    const surface = createTerrainSurface({ width: 64, height: 64 }, 100);
    const scene = new THREE.Scene();
    const disposables: { dispose(): void }[] = [];
    buildTerrainMesh(scene, disposables, surface, halves(), { current: null });
    for (const d of disposables) d.dispose();
    const beyond = scene.getObjectByName("beyond-the-map") as THREE.Mesh;
    expect((beyond.material as THREE.Material).onBeforeCompile.toString()).not.toContain(
      "uTerrain",
    );
  });

  it("finds the places it patches in three.js's own shader", () => {
    // A three.js upgrade that renamed these would silently drop the detail.
    const mat = build(halves(), grid);
    const shader = {
      uniforms: {},
      vertexShader: THREE.ShaderLib.basic.vertexShader,
      fragmentShader: THREE.ShaderLib.basic.fragmentShader,
    } as unknown as THREE.WebGLProgramParametersWithUniforms;
    mat.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
    expect(shader.vertexShader).toContain("vTerrainPos = (modelMatrix");
    expect(shader.fragmentShader).toContain("texture2D(uTerrainNormals");
    expect(Object.keys(shader.uniforms)).toContain("uTerrainNormals");
  });
});

describe("the world beyond a generated sheet", () => {
  const surface = createTerrainSurface({ width: 1024, height: 1024 }, 100);
  const scene = new THREE.Scene();
  const disposables: { dispose(): void }[] = [];
  buildTerrainMesh(scene, disposables, surface, halves(), { current: null });
  for (const d of disposables) d.dispose();
  const plane = scene.getObjectByName("beyond-the-map") as THREE.Mesh;

  it("is drawn before the sheet and never contests its depth", () => {
    // A plane a little under the sea fought the sea for depth at a far zoom
    // and showed through as dark lines across it.
    const sheet = scene.getObjectByName("terrain") as THREE.Mesh;
    const mat = plane.material as THREE.Material;
    expect(mat.depthTest).toBe(false);
    expect(mat.depthWrite).toBe(false);
    expect(plane.renderOrder).toBeLessThan(sheet.renderOrder);
  });

  it("reaches a sheet past every edge", () => {
    expect(plane).toBeInstanceOf(THREE.Mesh);
    const geo = plane.geometry as THREE.PlaneGeometry;
    expect(geo.parameters.width).toBeCloseTo(surface.worldWidth * 3);
    expect(geo.parameters.height).toBeCloseTo(surface.worldDepth * 3);
  });

  it("fills the rest with the colour the picture fades to", () => {
    const [r, g, b] = edgeColor(halves());
    const expected = new THREE.Color().setRGB(
      r / 255,
      g / 255,
      b / 255,
      THREE.SRGBColorSpace,
    );
    expect((scene.background as THREE.Color).equals(expected)).toBe(true);
  });
});
