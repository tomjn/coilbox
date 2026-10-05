import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createTerrainSurface } from "./terrain";
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

  it("starts as bright as the map, so no seam shows at the edge", () => {
    // The sea half runs all the way to the right edge, so just past it the
    // world beyond is the sea, barely begun on its fade.
    const [r, g, b] = px(Math.ceil(2 * third), mid);
    expect(Math.abs(r - 24)).toBeLessThanOrEqual(2);
    expect(Math.abs(g - 58)).toBeLessThanOrEqual(2);
    expect(Math.abs(b - 96)).toBeLessThanOrEqual(2);
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
        data.set(edge ? [24, 58, 96, 255] : [80, 140, 180, 255], (y * width + x) * 4);
      }
    }
    const ringed = beyondPixels({ data, width, height });
    const o = (mid * ringed.width + Math.floor(third) - 1) * 4;
    expect(Array.from(ringed.data.slice(o, o + 3))).toEqual([24, 58, 96]);
  });

  it("fades to the edge's average far from the map", () => {
    const mean = edgeColor(halves()).map((c) => Math.round(c));
    expect(px(0, 0)).toEqual(mean);
    expect(px(beyond.width - 1, beyond.height - 1)).toEqual(mean);
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
