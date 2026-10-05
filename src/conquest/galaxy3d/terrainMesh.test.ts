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

describe("the sea beyond a generated sheet", () => {
  const surface = createTerrainSurface({ width: 1024, height: 1024 }, 100);
  const build = (color: Parameters<typeof buildTerrainMesh>[3]) => {
    const scene = new THREE.Scene();
    const disposables: { dispose(): void }[] = [];
    buildTerrainMesh(scene, disposables, surface, color, { current: null });
    for (const d of disposables) d.dispose();
    return scene.getObjectByName("sea-beyond") as THREE.Mesh | undefined;
  };

  it("lies under the sheet, far past it, in the colour of its edge", () => {
    const sea = build(framed());
    if (!sea) throw new Error("expected a sea beyond the sheet");
    expect(sea.position.y).toBeLessThan(0);
    const geo = sea.geometry as THREE.PlaneGeometry;
    expect(geo.parameters.width).toBeGreaterThan(surface.worldWidth * 10);
    const expected = new THREE.Color().setRGB(
      24 / 255,
      58 / 255,
      96 / 255,
      THREE.SRGBColorSpace,
    );
    expect(
      (sea.material as THREE.MeshBasicMaterial).color.equals(expected),
    ).toBe(true);
  });
});
