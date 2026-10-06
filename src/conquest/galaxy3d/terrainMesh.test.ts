import * as THREE from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PlanetId } from "../planets";
import { apronPicture, apronPixels, commonEdgeColor } from "./handmadeEdge";
import { createTerrainSurface, type HeightGrid } from "./terrain";
import {
  type BiomePixels,
  buildTerrainMesh,
  outerRingColor,
  type TerrainExtension,
} from "./terrainMesh";

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

describe("outerRingColor", () => {
  it("averages only the outermost pixels", () => {
    // 4 by 3: the ring one colour, the middle another.
    const width = 4;
    const height = 3;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const ring = x === 0 || y === 0 || x === width - 1 || y === height - 1;
        data.set(
          ring ? [24, 58, 96, 255] : [200, 200, 0, 255],
          (y * width + x) * 4,
        );
      }
    }
    expect(outerRingColor({ data, width, height })).toEqual([24, 58, 96]);
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
      undefined,
      undefined,
      // Detail reads the generator's weights, so a generated map brings them.
      {
        a: new Uint8Array(64 * 64 * 4),
        b: new Uint8Array(64 * 64 * 4),
        width: 64,
        height: 64,
        planet: "temperate",
      },
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

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("leaves a hand-made picture without procedural detail", () => {
    // A bitmap stands in for a painted picture, which never arrives as pixels.
    // The apron reads it back through a canvas, which this test has none of.
    vi.stubGlobal("document", {
      createElement: () => ({
        getContext: () => ({
          drawImage: () => {},
          getImageData: () => ({
            data: new Uint8ClampedArray(16),
            width: 2,
            height: 2,
          }),
        }),
      }),
    });
    const painted = { width: 2, height: 2 } as unknown as ImageBitmap;
    expect(build(painted, grid).customProgramCacheKey()).toBe("terrain:1:0");
  });

  it("has no relief or detail on a flat sheet", () => {
    // Detail tells sea from land by the height, so with none it stays off
    // rather than reading the whole map as sea.
    expect(build(halves()).customProgramCacheKey()).toBe("terrain:0:0");
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

describe("the sheet's biome weights", () => {
  const grid: HeightGrid = {
    data: new Float32Array([0, 0.5, 0.5, 1]),
    width: 2,
    height: 2,
  };
  const weights = (planet: PlanetId, size = 64): BiomePixels => ({
    a: new Uint8Array(size * size * 4).fill(10),
    b: new Uint8Array(size * size * 4).fill(20),
    width: size,
    height: size,
    planet,
  });
  /** The uniforms the material hands to a compiling shader. */
  const uniformsOf = (
    material: THREE.Material,
  ): Record<string, { value: unknown }> => {
    const shader = {
      uniforms: {},
      vertexShader: "#include <project_vertex>",
      fragmentShader: "#include <color_fragment>",
    } as unknown as THREE.WebGLProgramParametersWithUniforms;
    material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
    return shader.uniforms as Record<string, { value: unknown }>;
  };
  const build = (
    biomes: BiomePixels | undefined,
    detail = true,
    extension?: TerrainExtension,
  ) => {
    const surface = createTerrainSurface({ width: 64, height: 64 }, 100, grid);
    const disposables: { dispose(): void }[] = [];
    const mesh = buildTerrainMesh(
      new THREE.Scene(),
      disposables,
      surface,
      halves(),
      { current: null },
      grid,
      detail,
      extension,
      undefined,
      biomes,
    );
    for (const d of disposables) d.dispose();
    return uniformsOf(mesh.material as THREE.Material);
  };

  it("binds the weights when detail is on and not when it is off", () => {
    const on = build(weights("temperate"));
    expect(on.uBiomeA.value).toBeInstanceOf(THREE.DataTexture);
    expect(on.uBiomeB.value).toBeInstanceOf(THREE.DataTexture);
    expect(on.uTerrainDetail.value).toBe(1);
    const a = on.uBiomeA.value as THREE.DataTexture;
    expect(a.colorSpace).toBe(THREE.NoColorSpace);
    expect(a.flipY).toBe(false);
    expect(a.minFilter).toBe(THREE.LinearMipmapLinearFilter);
    const off = build(weights("temperate"), false);
    expect(off.uTerrainDetail.value).toBe(0);
    // Only the one texel placeholder is bound, never the weights.
    expect((off.uBiomeA.value as THREE.DataTexture).image.width).toBe(1);
    expect((off.uBiomeB.value as THREE.DataTexture).image.width).toBe(1);
  });

  it("widens the weights exactly as the picture is widened", () => {
    const on = build(weights("temperate"));
    const a = on.uBiomeA.value as THREE.DataTexture;
    const b = on.uBiomeB.value as THREE.DataTexture;
    const apron = apronPicture(halves(), 2, 2, apronPixels(grid));
    expect(a.image.width).toBe(apron.width);
    expect(a.image.height).toBe(apron.height);
    expect(b.image.width).toBe(apron.width);
    expect(b.image.height).toBe(apron.height);
  });

  it("uploads the extension's weights when it draws the extension", () => {
    const across = 8;
    const extension: TerrainExtension = {
      margin: 2,
      heights: {
        data: new Float32Array(across * across).fill(0.2),
        width: across,
        height: across,
      },
      image: {
        data: new Uint8ClampedArray(across * across * 4).fill(60),
        width: across,
        height: across,
      },
      biomes: weights("temperate", across),
    };
    const on = build(weights("temperate"), true, extension);
    expect((on.uBiomeA.value as THREE.DataTexture).image.width).toBe(across);
  });

  it("gives each slot its pattern's index, and -1 to a slot with none", () => {
    const u = build(weights("moon"));
    // Moon: regolith, regolith, rock, then five unused slots.
    expect(u.uBiomePattern.value).toEqual([6, 6, 7, -1, -1, -1, -1, -1]);
  });

  it("gives a sea that is not liquid a pattern, and a liquid one none", () => {
    // Dust for the dry basin and regolith for the maria, as their land has.
    expect(build(weights("red")).uSeaPattern.value).toBe(5);
    expect(build(weights("moon")).uSeaPattern.value).toBe(6);
    expect(build(weights("volcanic")).uSeaPattern.value).toBe(19);
    expect(build(weights("ice")).uSeaPattern.value).toBe(20);
    expect(build(weights("temperate")).uSeaPattern.value).toBe(-1);
    expect(build(weights("acid")).uSeaPattern.value).toBe(-1);
  });

  it("turns water effects off on a sea that is not liquid", () => {
    expect(build(weights("moon")).uSeaLiquid.value).toBe(0);
    expect(build(weights("acid")).uSeaLiquid.value).toBe(1);
    expect(build(weights("temperate")).uSeaLiquid.value).toBe(1);
    expect(build(weights("volcanic")).uSeaLiquid.value).toBe(0);
  });

  it("passes the planet's steep and clearing colours in linear", () => {
    const u = build(weights("temperate"));
    const [dark] = u.uBiomeSteep.value as THREE.Color[];
    const expected = new THREE.Color().setRGB(
      122 / 255,
      106 / 255,
      90 / 255,
      THREE.SRGBColorSpace,
    );
    expect(dark.equals(expected)).toBe(true);
    expect((u.uBiomeClearing.value as THREE.Color).g).toBeCloseTo(
      new THREE.Color().setRGB(0, 154 / 255, 0, THREE.SRGBColorSpace).g,
    );
  });

  it("gives a hand-made map no detail", () => {
    const surface = createTerrainSurface({ width: 64, height: 64 }, 100, grid);
    vi.stubGlobal("document", {
      createElement: () => ({
        getContext: () => ({
          drawImage: () => {},
          getImageData: () => ({
            data: new Uint8ClampedArray(16),
            width: 2,
            height: 2,
          }),
        }),
      }),
    });
    const painted = { width: 2, height: 2 } as unknown as ImageBitmap;
    const mesh = buildTerrainMesh(
      new THREE.Scene(),
      [],
      surface,
      painted,
      { current: null },
      grid,
    );
    vi.unstubAllGlobals();
    expect(
      uniformsOf(mesh.material as THREE.Material).uTerrainDetail.value,
    ).toBe(0);
    // No weights passed to a generated-looking picture either.
    expect(build(undefined).uTerrainDetail.value).toBe(0);
  });
});

describe("a generated map with land past its edge", () => {
  // A 4 by 4 map, rising west to east, inside a picture with 2 pixels round it.
  const margin = 2;
  const across = 8;
  const mapGrid: HeightGrid = {
    data: Float32Array.from({ length: 16 }, (_, i) => ((i % 4) + 1) / 10),
    width: 4,
    height: 4,
  };
  const extension: TerrainExtension = {
    margin,
    heights: {
      data: Float32Array.from({ length: across * across }, (_, i) => {
        const x = (i % across) - margin;
        return Math.max(0, (x + 1) / 10);
      }),
      width: across,
      height: across,
    },
    image: {
      data: new Uint8ClampedArray(across * across * 4).fill(60),
      width: across,
      height: across,
    },
  };
  const surface = createTerrainSurface(
    { width: 90, height: 90, heightScale: 30 },
    90,
    mapGrid,
  );
  const scene = new THREE.Scene();
  const disposables: { dispose(): void }[] = [];
  const sheet = buildTerrainMesh(
    scene,
    disposables,
    surface,
    halves(),
    { current: null },
    mapGrid,
    true,
    extension,
  );
  for (const d of disposables) d.dispose();
  const ring = scene.getObjectByName("terrain-margin") as THREE.Mesh;

  it("draws the land past the edge as a ring in the sheet's own material", () => {
    expect(ring).toBeInstanceOf(THREE.Mesh);
    expect(ring.material).toBe(sheet.material);
  });

  it("depth tests the ring like the sheet, since it never lies under it", () => {
    const mat = ring.material as THREE.Material;
    expect(mat.depthTest).toBe(true);
    expect(mat.depthWrite).toBe(true);
  });

  it("leaves picking to the sheet", () => {
    const hits: THREE.Intersection[] = [];
    ring.raycast(new THREE.Raycaster(), hits);
    expect(hits).toHaveLength(0);
  });

  it("moves the sheet's picture coordinates into the middle of the wider picture", () => {
    const uv = sheet.geometry.getAttribute("uv") as THREE.BufferAttribute;
    expect(uv.getX(0)).toBeCloseTo(margin / across);
    expect(uv.getY(0)).toBeCloseTo(margin / across);
    expect(uv.getX(uv.count - 1)).toBeCloseTo((margin + 4) / across);
  });

  it("hazes into the background by the time the land beyond ends", () => {
    const shader = {
      uniforms: {},
      vertexShader: THREE.ShaderLib.basic.vertexShader,
      fragmentShader: THREE.ShaderLib.basic.fragmentShader,
    } as unknown as THREE.WebGLProgramParametersWithUniforms;
    (sheet.material as THREE.Material).onBeforeCompile(
      shader,
      {} as THREE.WebGLRenderer,
    );
    const u = shader.uniforms as Record<string, { value: unknown }>;
    // Three map pixels span the 90 unit sheet, so two reach 60: two thirds.
    expect(u.uTerrainHaze.value).toBeCloseTo(60 / 90);
    expect((u.uTerrainFrame.value as THREE.Vector4).toArray()).toEqual([
      45, 45, 90, 90,
    ]);
    expect(u.uTerrainFar.value).toBe(scene.background);
  });

  it("sets the background to the colour the land beyond hazes to", () => {
    const expected = new THREE.Color().setRGB(
      60 / 255,
      60 / 255,
      60 / 255,
      THREE.SRGBColorSpace,
    );
    expect((scene.background as THREE.Color).equals(expected)).toBe(true);
  });
});

describe("a map with nothing past its edge", () => {
  // A 64 by 64 map raised along its west edge, as a mountain on the frame.
  const mapGrid: HeightGrid = {
    data: Float32Array.from({ length: 64 * 64 }, (_, i) =>
      i % 64 === 0 ? 0.8 : 0.1,
    ),
    width: 64,
    height: 64,
  };
  const surface = createTerrainSurface(
    { width: 90, height: 90, heightScale: 30 },
    90,
    mapGrid,
  );
  const scene = new THREE.Scene();
  const sheet = buildTerrainMesh(
    scene,
    [],
    surface,
    halves(),
    { current: null },
    mapGrid,
  );
  const ring = scene.getObjectByName("terrain-margin") as THREE.Mesh;
  const positions = () =>
    ring.geometry.getAttribute("position") as THREE.BufferAttribute;

  it("draws a short apron round it in the sheet's own material", () => {
    expect(ring).toBeInstanceOf(THREE.Mesh);
    expect(ring.material).toBe(sheet.material);
  });

  it("carries a raised edge on with no gap, then eases it down", () => {
    const p = positions();
    const west = -surface.worldWidth / 2;
    let atEdge = 0;
    let outermost = Number.POSITIVE_INFINITY;
    let outerY = 0;
    for (let i = 0; i < p.count; i++) {
      if (Math.abs(p.getZ(i)) > 1) continue;
      if (Math.abs(p.getX(i) - west) < 1e-6) atEdge = p.getY(i);
      if (p.getX(i) < outermost) {
        outermost = p.getX(i);
        outerY = p.getY(i);
      }
    }
    expect(atEdge).toBeCloseTo(surface.groundHeightAtWorld(west, 0));
    // The lowest ground on the frame, here 0.1 of the 30 unit height scale.
    expect(outerY).toBeCloseTo(0.1 * 30 * surface.scale);
    expect(outerY).toBeLessThan(atEdge);
  });

  it("hazes to the commonest colour on the picture's edge", () => {
    const [r, g, b] = commonEdgeColor(halves());
    const expected = new THREE.Color().setRGB(
      r / 255,
      g / 255,
      b / 255,
      THREE.SRGBColorSpace,
    );
    expect((scene.background as THREE.Color).equals(expected)).toBe(true);
  });

  it("puts the sheet's picture in the middle of the widened one", () => {
    const uv = sheet.geometry.getAttribute("uv") as THREE.BufferAttribute;
    const margin = Math.ceil(0.08 * 64);
    const across = 64 + 2 * margin;
    expect(uv.getX(0)).toBeCloseTo(margin / across);
    expect(uv.getX(uv.count - 1)).toBeCloseTo((margin + 64) / across);
  });

  it("gives a flat map an apron too, lying flat beside the sheet", () => {
    const flat = createTerrainSurface({ width: 90, height: 60 }, 90);
    const plain = new THREE.Scene();
    buildTerrainMesh(plain, [], flat, halves(), { current: null });
    const flatRing = plain.getObjectByName("terrain-margin") as THREE.Mesh;
    const p = flatRing.geometry.getAttribute("position");
    for (let i = 0; i < p.count; i++) expect(p.getY(i)).toBe(0);
  });
});
