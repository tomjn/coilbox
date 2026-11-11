import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createTerrainSurface, type HeightGrid } from "../terrain";
import { groundDecal, shadowCamera } from "./shadow";
import { pickSite } from "./site";

const SIDE = 101;
const data = new Float32Array(SIDE * SIDE);
for (let y = 0; y < SIDE; y++)
  for (let x = 0; x < SIDE; x++) data[y * SIDE + x] = 0.3 + x * 0.003;
const grid: HeightGrid = { data, width: SIDE, height: SIDE };
const surface = createTerrainSurface(
  { width: 100, height: 100, heightScale: 10 },
  200,
  grid,
);
const sun = new THREE.Vector3(-1, 1.5, -1).normalize();

describe("shadowCamera", () => {
  it("sees the whole of the box it is fitted to", () => {
    const box = new THREE.Box3(
      new THREE.Vector3(10, 2, -4),
      new THREE.Vector3(14, 9, 1),
    );
    const cam = shadowCamera(box, sun);
    const corner = new THREE.Vector3();
    for (let i = 0; i < 8; i++) {
      corner.set(
        i & 1 ? box.max.x : box.min.x,
        i & 2 ? box.max.y : box.min.y,
        i & 4 ? box.max.z : box.min.z,
      );
      const p = corner.clone().project(cam);
      for (const v of [p.x, p.y, p.z]) {
        expect(v).toBeGreaterThanOrEqual(-1);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe("groundDecal", () => {
  const site = pickSite(surface, [0, 0], [[60, 60]], undefined, 3.79, 0.38);
  if (!site) throw new Error("stands");
  const decal = groundDecal(surface, site, 3.79, null);

  it("lies just above the terrain", () => {
    const pos = decal.mesh.geometry.getAttribute("position");
    for (let i = 0; i < pos.count; i += 37) {
      const ground = surface.groundHeightAtWorld(pos.getX(i), pos.getZ(i));
      expect(pos.getY(i) - ground).toBeCloseTo(0.01, 5);
    }
  });

  it("draws a town's ring at its edge, and none when asked for none", () => {
    const u = (decal.mesh.material as THREE.ShaderMaterial).uniforms;
    decal.setRing({
      color: new THREE.Color(1, 0, 0),
      strength: 0.95,
      thick: true,
    });
    expect(u.uRingStrength.value).toBe(0.95);
    expect(u.uRingThick.value).toBe(1);
    // A town's ring is round and of a town's width.
    expect(u.uRingSides.value).toBe(0);
    expect(u.uRingWeight.value).toBe(1);
    decal.setRing({
      color: new THREE.Color(1, 0, 0),
      strength: 0.8,
      thick: false,
      sides: 3,
      weight: 3.5,
    });
    expect(u.uRingSides.value).toBe(3);
    expect(u.uRingWeight.value).toBe(3.5);
    decal.setRing(undefined);
    expect(u.uRingStrength.value).toBe(0);
  });

  it("dims under fog", () => {
    const u = (decal.mesh.material as THREE.ShaderMaterial).uniforms;
    decal.setHidden(true);
    expect(u.uHidden.value).toBe(1);
  });
});
