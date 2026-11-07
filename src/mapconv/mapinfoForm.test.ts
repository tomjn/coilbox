import { describe, expect, it } from "vitest";
import {
  countMapinfo,
  defaultMapinfoDraft,
  hexToRgb,
  rgbToHex,
  toMapinfoForm,
} from "./mapinfoForm";

describe("toMapinfoForm", () => {
  it("sends nothing for an untouched form", () => {
    expect(toMapinfoForm(defaultMapinfoDraft)).toEqual({
      name: undefined,
      shortname: undefined,
      description: undefined,
      author: undefined,
      skyColor: undefined,
      fogColor: undefined,
      sunColor: undefined,
      sunDir: undefined,
      groundAmbientColor: undefined,
      groundDiffuseColor: undefined,
      waterSurfaceColor: undefined,
      waterSurfaceAlpha: undefined,
      terrainHardness: undefined,
      startPositions: [],
    });
    expect(countMapinfo(defaultMapinfoDraft)).toBe(0);
  });

  it("trims text and parses numbers", () => {
    const form = toMapinfoForm({
      ...defaultMapinfoDraft,
      name: "  My map ",
      waterSurfaceAlpha: "0.4",
      terrainHardness: "2",
    });
    expect(form.name).toBe("My map");
    expect(form.waterSurfaceAlpha).toBe(0.4);
    expect(form.terrainHardness).toBe(2);
  });

  it("drops a start position with a missing or invalid coordinate", () => {
    const form = toMapinfoForm({
      ...defaultMapinfoDraft,
      startPositions: [
        { x: "512", z: "1024" },
        { x: "512", z: "" },
        { x: "abc", z: "5" },
      ],
    });
    expect(form.startPositions).toEqual([{ x: 512, z: 1024 }]);
  });

  it("sends a sun direction only when all three parts are numbers and not all zero", () => {
    const base = defaultMapinfoDraft;
    expect(toMapinfoForm({ ...base, sunDir: ["1", "", "2"] }).sunDir).toBe(
      undefined,
    );
    expect(toMapinfoForm({ ...base, sunDir: ["0", "0", "0"] }).sunDir).toBe(
      undefined,
    );
    expect(toMapinfoForm({ ...base, sunDir: ["0", "1", "2"] }).sunDir).toEqual([
      0, 1, 2,
    ]);
  });

  it("converts a picked colour to values in 0 to 1", () => {
    const form = toMapinfoForm({ ...defaultMapinfoDraft, skyColor: "#ff8000" });
    expect(form.skyColor).toEqual([1, 0.502, 0]);
    expect(countMapinfo({ ...defaultMapinfoDraft, skyColor: "#ff8000" })).toBe(
      1,
    );
  });
});

describe("colour conversion", () => {
  it("round trips the engine's default sky colour to within one step", () => {
    expect(rgbToHex([0.1, 0.15, 0.7])).toBe("#1a26b3");
    expect(hexToRgb("#1a26b3")).toEqual([0.102, 0.149, 0.702]);
  });

  it("rejects text that is not a hex colour", () => {
    expect(hexToRgb("")).toBeUndefined();
    expect(hexToRgb("red")).toBeUndefined();
  });
});
