import { describe, expect, it } from "vitest";
import {
  CVD_TARGET,
  deltaE,
  lightness,
  NORMAL_FLOOR,
  type Vision,
} from "./chartPalette";
import { buildHeatField } from "./heatField";
import {
  DEFAULT_HEAT_THRESHOLD,
  HEAT_ALPHA_MAX,
  HEAT_ALPHA_MIN,
  HEAT_KIND_OF_LAYER,
  HEAT_RAMPS,
  type HeatKind,
  heatAlpha,
  heatColour,
  heatGradientCss,
  paintHeatField,
} from "./heatRamp";

const SQUARE = { worldWidth: 8192, worldHeight: 8192 };

const KINDS = Object.keys(HEAT_RAMPS) as HeatKind[];
const visions: (Vision | undefined)[] = [undefined, "protan", "deutan"];
const rgb = (hex: string) =>
  [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));

describe.each(KINDS)("the %s ramp", (kind) => {
  const ramp = HEAT_RAMPS[kind];

  it.each(visions)("gets lighter at every stop, as %s sees it", (vision) => {
    const steps = ramp.map((hex) => lightness(hex, vision));
    for (let i = 1; i < steps.length; i++)
      expect(steps[i]).toBeGreaterThan(steps[i - 1]);
  });

  it("is not a red to green ramp: it never has a red stop and a green stop", () => {
    const stops = ramp.map(rgb);
    const red = stops.some(([r, g, b]) => r > g && r > b);
    const green = stops.some(([r, g, b]) => g > r && g > b);
    expect(red && green).toBe(false);
  });

  it("runs from its first stop to its last", () => {
    expect(heatColour(0, kind)).toEqual(rgb(ramp[0]));
    expect(heatColour(1, kind)).toEqual(rgb(ramp[ramp.length - 1]));
    expect(heatColour(7, kind)).toEqual(heatColour(1, kind));
  });
});

describe("the ramps together", () => {
  it("have as many stops as each other, so stops can be compared", () => {
    for (const kind of KINDS)
      expect(HEAT_RAMPS[kind]).toHaveLength(HEAT_RAMPS.buildings.length);
  });

  // Every pair, at the same stop, with the thresholds chartPalette.ts holds:
  // NORMAL_FLOOR for normal vision and CVD_TARGET for protan and deutan.
  const pairs = KINDS.flatMap((a, i) =>
    KINDS.slice(i + 1).map((b) => [a, b] as const),
  );
  it.each(pairs)("%s and %s stay apart at every stop", (a, b) => {
    HEAT_RAMPS[a].forEach((hex, stop) => {
      const other = HEAT_RAMPS[b][stop];
      expect(deltaE(hex, other)).toBeGreaterThanOrEqual(NORMAL_FLOOR);
      expect(deltaE(hex, other, "protan")).toBeGreaterThanOrEqual(CVD_TARGET);
      expect(deltaE(hex, other, "deutan")).toBeGreaterThanOrEqual(CVD_TARGET);
    });
  });

  it("route every density layer to a ramp, and the same layer to the same ramp", () => {
    expect(HEAT_KIND_OF_LAYER.density).toBe("buildings");
    expect(HEAT_KIND_OF_LAYER.orderDensity).toBe("orders");
    expect(HEAT_KIND_OF_LAYER.deaths).toBe("deaths");
    // The replay's layer and the map page's layer of the same thing agree.
    expect(HEAT_KIND_OF_LAYER.orders).toBe(HEAT_KIND_OF_LAYER.orderDensity);
    expect(HEAT_KIND_OF_LAYER.buildings).toBe(HEAT_KIND_OF_LAYER.density);
  });

  it("draw a legend bar in the layer's own ramp", () => {
    expect(heatGradientCss("orders")).not.toBe(heatGradientCss("buildings"));
    expect(heatGradientCss("orders")).toContain("rgba(10, 90, 80, 0.30) 0%");
    expect(heatGradientCss("deaths")).toContain("rgba(122, 59, 0, 0.30) 0%");
  });

  it("paint the same density in different colours", () => {
    const field = buildHeatField({ positions: [16, 16] }, SQUARE);
    const at = (kind: HeatKind) => [
      ...paintHeatField(field, { kind }).slice(0, 3),
    ];
    expect(at("orders")).not.toEqual(at("buildings"));
    expect(at("deaths")).not.toEqual(at("orders"));
  });
});

describe("opacity", () => {
  it("rises with density, so a quiet area lets the map through", () => {
    expect(heatAlpha(0.1)).toBeLessThan(heatAlpha(0.5));
    expect(heatAlpha(0.5)).toBeLessThan(heatAlpha(1));
    expect(heatAlpha(1)).toBeCloseTo(HEAT_ALPHA_MAX, 10);
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
      0xa0,
      0xcc,
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
    expect([...rgba.slice(last, last + 4)]).toEqual([0x55, 0x1e, 0xa6, 0]);
  });

  it("does not let the threshold change what was counted", () => {
    const positions = [1000, 1000, 6000, 6000, 6000, 6000, 6000, 6000];
    const field = buildHeatField({ positions }, SQUARE);
    const before = { peak: field.peak, counted: field.counted };
    paintHeatField(field, { threshold: 0.9 });
    expect({ peak: field.peak, counted: field.counted }).toEqual(before);
  });
});
