import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createTerrainSurface, type HeightGrid } from "./terrain";
import { beyondPixels, buildTerrainMesh, edgeColor } from "./terrainMesh";

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
  it("averages only the outermost pixels", () => {
    expect(edgeColor(framed())).toEqual([24, 58, 96]);
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

  it("fades to the edge's darkened average far from the map", () => {
    const mean = edgeColor(halves());
    expect(px(0, 0)).toEqual(mean.map((c) => Math.round(c * 0.6)));
    expect(px(beyond.width - 1, beyond.height - 1)).toEqual(
      mean.map((c) => Math.round(c * 0.6)),
    );
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
    const surface = createTerrainSurface({ width: 64, height: 64 }, 100, heights);
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

  it("has no relief to light on a flat sheet", () => {
    expect(build(halves()).customProgramCacheKey()).toBe("terrain:0:1");
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

  it("lies under the sheet and reaches a sheet past every edge", () => {
    expect(plane).toBeInstanceOf(THREE.Mesh);
    expect(plane.position.y).toBeLessThan(0);
    const geo = plane.geometry as THREE.PlaneGeometry;
    expect(geo.parameters.width).toBeCloseTo(surface.worldWidth * 3);
    expect(geo.parameters.height).toBeCloseTo(surface.worldDepth * 3);
  });

  it("fills the rest with the colour the picture fades to", () => {
    const [r, g, b] = edgeColor(halves());
    const expected = new THREE.Color().setRGB(
      (r * 0.6) / 255,
      (g * 0.6) / 255,
      (b * 0.6) / 255,
      THREE.SRGBColorSpace,
    );
    expect((scene.background as THREE.Color).equals(expected)).toBe(true);
  });
});
