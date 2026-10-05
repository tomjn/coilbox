import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createTerrainSurface } from "./terrain";
import { BEYOND_SHADE, buildTerrainMesh, edgeColor } from "./terrainMesh";

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

describe("the world beyond a generated sheet", () => {
  const surface = createTerrainSurface({ width: 1024, height: 1024 }, 100);
  const scene = new THREE.Scene();
  const disposables: { dispose(): void }[] = [];
  buildTerrainMesh(scene, disposables, surface, framed(), { current: null });
  for (const d of disposables) d.dispose();
  const beyond = scene.getObjectByName("beyond-the-map") as THREE.Mesh;

  it("mirrors the picture past every edge, darker, under the sheet", () => {
    expect(beyond).toBeInstanceOf(THREE.Mesh);
    expect(beyond.position.y).toBeLessThan(0);
    const mat = beyond.material as THREE.MeshBasicMaterial;
    expect(mat.map?.wrapS).toBe(THREE.MirroredRepeatWrapping);
    expect(mat.map?.wrapT).toBe(THREE.MirroredRepeatWrapping);
    expect(mat.color.r).toBe(BEYOND_SHADE);
  });

  it("lays the middle copy exactly under the sheet, top of the picture first", () => {
    // Rotated flat, the plane's first vertex is the far left corner, which is
    // the picture's top left on the sheet. Two copies lie out past it.
    const uv = beyond.geometry.getAttribute("uv");
    expect([uv.getX(0), uv.getY(0)]).toEqual([-2, -2]);
    expect([uv.getX(uv.count - 1), uv.getY(uv.count - 1)]).toEqual([3, 3]);
    const pos = beyond.geometry.getAttribute("position");
    const corner = new THREE.Vector3()
      .fromBufferAttribute(pos, 0)
      .applyMatrix4(
        beyond.matrix.compose(beyond.position, beyond.quaternion, beyond.scale),
      );
    expect(corner.x).toBeCloseTo(-surface.worldWidth * 2.5);
    expect(corner.z).toBeCloseTo(-surface.worldDepth * 2.5);
  });

  it("fills the rest with the darkened colour of the sheet's edge", () => {
    const expected = new THREE.Color()
      .setRGB(24 / 255, 58 / 255, 96 / 255, THREE.SRGBColorSpace)
      .multiplyScalar(BEYOND_SHADE);
    expect(scene.background).toBeInstanceOf(THREE.Color);
    expect((scene.background as THREE.Color).equals(expected)).toBe(true);
  });
});
