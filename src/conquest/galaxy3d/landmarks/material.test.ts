import { describe, expect, it } from "vitest";
import { glowMaterial, landmarkMaterial, setLandmarkState } from "./material";

describe("landmarkMaterial", () => {
  it("carries the sun, the shadow and the fog state", () => {
    const m = landmarkMaterial();
    for (const name of [
      "uSun",
      "uSunLight",
      "uSky",
      "uGroundBounce",
      "uShadow",
      "uShadowMatrix",
      "uShadowOn",
      "uHidden",
    ])
      expect(m.uniforms[name], name).toBeDefined();
  });

  it("draws its patterns from the model's own coordinates, so they scale with it", () => {
    const m = landmarkMaterial();
    expect(m.vertexShader).toMatch(/vLocal\s*=\s*position/);
    expect(m.vertexShader).not.toMatch(/vLocal\s*=.*modelMatrix/);
  });

  it("goes grey under fog", () => {
    const m = landmarkMaterial();
    setLandmarkState(m, { hidden: true });
    expect(m.uniforms.uHidden.value).toBe(1);
    setLandmarkState(m, { hidden: false });
    expect(m.uniforms.uHidden.value).toBe(0);
    const g = glowMaterial();
    setLandmarkState(g, { hidden: true });
    expect(g.uniforms.uHidden.value).toBe(1);
  });

  it("never draws an anomaly's haze over the model", () => {
    for (const m of [landmarkMaterial(), glowMaterial()]) {
      expect(m.uniforms.uMist).toBeUndefined();
      expect(m.fragmentShader).not.toMatch(/uMist/);
    }
  });
});
