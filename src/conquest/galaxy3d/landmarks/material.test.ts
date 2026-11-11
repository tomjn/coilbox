import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { glowMaterial, landmarkMaterial, setLandmarkState } from "./material";
import { STRONGHOLD_PALETTES } from "./palettes";
import { insideShield, shieldMesh } from "./shield";

describe("landmarkMaterial", () => {
  it("carries the sun, the shadow and the fog and mist states", () => {
    const m = landmarkMaterial();
    for (const name of [
      "uSun",
      "uAmbient",
      "uSky",
      "uGroundBounce",
      "uShadow",
      "uShadowMatrix",
      "uShadowOn",
      "uHidden",
      "uMist",
      "uMistColour",
    ])
      expect(m.uniforms[name], name).toBeDefined();
  });

  it("draws its patterns from the model's own coordinates, so they scale with it", () => {
    const m = landmarkMaterial();
    expect(m.vertexShader).toMatch(/vLocal\s*=\s*position/);
    expect(m.vertexShader).not.toMatch(/vLocal\s*=.*modelMatrix/);
  });

  it("goes grey under fog and violet in mist", () => {
    const m = landmarkMaterial();
    setLandmarkState(m, { hidden: true, mist: false });
    expect(m.uniforms.uHidden.value).toBe(1);
    expect(m.uniforms.uMist.value).toBe(0);
    setLandmarkState(m, { hidden: false, mist: true });
    expect(m.uniforms.uHidden.value).toBe(0);
    expect(m.uniforms.uMist.value).toBe(1);
    const g = glowMaterial();
    setLandmarkState(g, { hidden: true, mist: false });
    expect(g.uniforms.uHidden.value).toBe(1);
  });
});

describe("shield", () => {
  const radii = new THREE.Vector3(2, 3, 1.5);
  const centre = new THREE.Vector3(0.5, 1, 0);

  it("holds its centre and stops just past each semi-axis", () => {
    expect(insideShield(radii, centre, centre.clone())).toBe(true);
    for (const [x, y, z] of [
      [2.01, 0, 0],
      [0, 3.01, 0],
      [0, 0, 1.51],
    ])
      expect(
        insideShield(
          radii,
          centre,
          centre.clone().add(new THREE.Vector3(x, y, z)),
        ),
      ).toBe(false);
  });

  it("is a dome of those semi-axes over that centre", () => {
    const mesh = shieldMesh(STRONGHOLD_PALETTES.temperate, radii, centre);
    mesh.geometry.computeBoundingBox();
    const bb = mesh.geometry.boundingBox as THREE.Box3;
    expect(bb.max.y + mesh.position.y).toBeCloseTo(centre.y + radii.y, 2);
    expect(bb.max.x + mesh.position.x).toBeCloseTo(centre.x + radii.x, 1);
  });
});
