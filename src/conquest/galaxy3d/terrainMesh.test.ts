import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createTerrainSurface } from "./terrain";
import { buildTerrainMesh, edgeColor } from "./terrainMesh";

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

describe("the sea around a generated sheet", () => {
  it("fills the scene's background with the colour of the sheet's edge", () => {
    const surface = createTerrainSurface({ width: 1024, height: 1024 }, 100);
    const scene = new THREE.Scene();
    const disposables: { dispose(): void }[] = [];
    buildTerrainMesh(scene, disposables, surface, framed(), {
      current: null,
    });
    for (const d of disposables) d.dispose();
    const expected = new THREE.Color().setRGB(
      24 / 255,
      58 / 255,
      96 / 255,
      THREE.SRGBColorSpace,
    );
    expect(scene.background).toBeInstanceOf(THREE.Color);
    expect((scene.background as THREE.Color).equals(expected)).toBe(true);
  });
});
