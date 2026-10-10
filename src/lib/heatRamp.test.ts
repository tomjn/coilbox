import { describe, expect, it } from "vitest";
import { lightness, type Vision } from "./chartPalette";
import { buildHeatField } from "./heatField";
import {
  DEFAULT_HEAT_THRESHOLD,
  HEAT_ALPHA_MAX,
  HEAT_ALPHA_MIN,
  HEAT_RAMP,
  heatAlpha,
  heatColour,
  paintHeatField,
} from "./heatRamp";

const SQUARE = { worldWidth: 8192, worldHeight: 8192 };

describe("the ramp", () => {
  const visions: (Vision | undefined)[] = [undefined, "protan", "deutan"];

  it.each(visions)("gets lighter at every stop, as %s sees it", (kind) => {
    const steps = HEAT_RAMP.map((hex) => lightness(hex, kind));
    for (let i = 1; i < steps.length; i++)
      expect(steps[i] - steps[i - 1]).toBeGreaterThan(5);
  });

  it("is not a red to green ramp: no stop has more green than red or blue", () => {
    for (const hex of HEAT_RAMP) {
      const [r, g, b] = [1, 3, 5].map((i) =>
        Number.parseInt(hex.slice(i, i + 2), 16),
      );
      expect(g).toBeLessThan(r);
      expect(g).toBeLessThan(b);
    }
  });

  it("runs from the first stop to the last", () => {
    expect(heatColour(0)).toEqual([0x3d, 0x14, 0x66]);
    expect(heatColour(1)).toEqual([0xff, 0x6f, 0xb5]);
    expect(heatColour(7)).toEqual(heatColour(1));
  });
});

describe("opacity", () => {
  it("rises with density, so a quiet area lets the map through", () => {
    expect(heatAlpha(0.1)).toBeLessThan(heatAlpha(0.5));
    expect(heatAlpha(0.5)).toBeLessThan(heatAlpha(1));
    expect(heatAlpha(1)).toBe(HEAT_ALPHA_MAX);
    expect(heatAlpha(DEFAULT_HEAT_THRESHOLD)).toBeGreaterThan(HEAT_ALPHA_MIN);
  });

  it("is nothing under the threshold, and the threshold is a parameter", () => {
    expect(heatAlpha(0.03)).toBe(0);
    expect(heatAlpha(0.03, 0)).toBeGreaterThan(0);
    expect(heatAlpha(0.3, 0.5)).toBe(0);
    expect(heatAlpha(0)).toBe(0);
  });
});

describe("painting a field", () => {
  it("draws nothing for an empty field", () => {
    const rgba = paintHeatField(buildHeatField({ positions: [] }, SQUARE));
    expect(rgba.length).toBe(256 * 256 * 4);
    for (let i = 3; i < rgba.length; i += 4) expect(rgba[i]).toBe(0);
  });

  it("draws the peak in the last stop at full strength", () => {
    const field = buildHeatField({ positions: [16, 16] }, SQUARE);
    const rgba = paintHeatField(field);
    expect([...rgba.slice(0, 4)]).toEqual([
      0xff,
      0x6f,
      0xb5,
      Math.round(HEAT_ALPHA_MAX * 255),
    ]);
  });

  it("is relative to the peak: forty times the points paints the same picture", () => {
    const once = buildHeatField({ positions: [4000, 4000] }, SQUARE);
    const many = buildHeatField(
      { positions: [4000, 4000], weights: [40] },
      SQUARE,
    );
    expect([...paintHeatField(many)]).toEqual([...paintHeatField(once)]);
  });

  it("puts north first by default and south first when asked", () => {
    // A point in the north-west corner.
    const field = buildHeatField({ positions: [16, 16] }, SQUARE);
    const north = paintHeatField(field);
    const south = paintHeatField(field, { southFirst: true });
    const alphaAt = (rgba: Uint8ClampedArray, row: number, col: number) =>
      rgba[(row * 256 + col) * 4 + 3];
    expect(alphaAt(north, 0, 0)).toBeGreaterThan(0);
    expect(alphaAt(north, 255, 0)).toBe(0);
    expect(alphaAt(south, 255, 0)).toBeGreaterThan(0);
    expect(alphaAt(south, 0, 0)).toBe(0);
    // West stays west either way.
    expect(alphaAt(south, 255, 255)).toBe(0);
  });

  it("leaves the lowest colour under a cell it does not draw", () => {
    const field = buildHeatField({ positions: [16, 16] }, SQUARE);
    const rgba = paintHeatField(field);
    const last = rgba.length - 4;
    expect([...rgba.slice(last, last + 4)]).toEqual([0x3d, 0x14, 0x66, 0]);
  });

  it("does not let the threshold change what was counted", () => {
    const positions = [1000, 1000, 6000, 6000, 6000, 6000, 6000, 6000];
    const field = buildHeatField({ positions }, SQUARE);
    const before = { peak: field.peak, counted: field.counted };
    paintHeatField(field, { threshold: 0.9 });
    expect({ peak: field.peak, counted: field.counted }).toEqual(before);
  });
});
