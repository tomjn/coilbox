import { describe, expect, it } from "vitest";
import { glowMaterial, landmarkMaterial, setLandmarkState } from "./material";

describe("landmarkMaterial", () => {
  it("carries the sun, the shadow and the fog and mist states", () => {
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
