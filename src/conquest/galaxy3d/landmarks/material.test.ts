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

  it("draws hazard stripes as painted metal", () => {
    const { fragmentShader } = landmarkMaterial();
    expect(fragmentShader).toMatch(/vKind > 13\.5/);
    expect(fragmentShader).toMatch(
      /step\(12\.5, vKind\)\s*\*\s*step\(vKind, 13\.5\)/,
    );
  });

  it("wears painted metal and pales glass except on an outpost", () => {
    const worn = landmarkMaterial();
    expect(worn.defines).toEqual({});
    const fresh = landmarkMaterial({ outpost: true });
    expect(fresh.defines).toEqual({ OUTPOST: 1 });
    // The scuffs and metal's share of the relief both hang on the one switch.
    expect(fresh.fragmentShader).toMatch(
      /#ifndef OUTPOST\s+if \(\(vKind > 10\.5 && vKind < 12\.5\) \|\| vKind > 13\.5\)/,
    );
    expect(fresh.fragmentShader).toMatch(
      /#ifdef OUTPOST\s+#define RELIEF_BELOW 10\.5[\s\S]*#else\s+#define RELIEF_BELOW 13\.5/,
    );
    // An outpost's glass takes no white from the sky, so it stays dark.
    expect(fresh.fragmentShader).toMatch(
      /#ifdef OUTPOST[\s\S]*#define GLASS_WHITE 0\.0[\s\S]*#else[\s\S]*#define GLASS_WHITE 0\.25/,
    );
    expect(fresh.fragmentShader).toMatch(
      /vKind > 8\.5 && vKind < RELIEF_BELOW/,
    );
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
