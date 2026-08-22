import { describe, expect, it } from "vitest";
import {
  clampUiZoom,
  DEFAULT_UI_ZOOM,
  pixelRatioFor,
  stepUiZoom,
  UI_ZOOM_LEVELS,
} from "./uiZoom";

describe("clampUiZoom", () => {
  it("keeps a level it already offers", () => {
    for (const level of UI_ZOOM_LEVELS) {
      expect(clampUiZoom(level)).toBe(level);
    }
  });

  it("snaps to the nearest level", () => {
    expect(clampUiZoom(1.4)).toBe(1.5);
    expect(clampUiZoom(1.08)).toBe(1.1);
    expect(clampUiZoom(0.7)).toBe(0.67);
  });

  it("pulls anything out of range back to the nearest bound", () => {
    expect(clampUiZoom(5)).toBe(2);
    expect(clampUiZoom(0.1)).toBe(0.5);
    expect(clampUiZoom(-3)).toBe(0.5);
  });

  it("answers with the default for a value that is not a number", () => {
    expect(clampUiZoom(Number.NaN)).toBe(DEFAULT_UI_ZOOM);
    expect(clampUiZoom(Number.POSITIVE_INFINITY)).toBe(DEFAULT_UI_ZOOM);
  });
});

describe("stepUiZoom", () => {
  it("moves one level at a time", () => {
    expect(stepUiZoom(1, 1)).toBe(1.1);
    expect(stepUiZoom(1, -1)).toBe(0.9);
    expect(stepUiZoom(1.5, 1)).toBe(1.75);
  });

  it("stops at the ends rather than leaving the range", () => {
    expect(stepUiZoom(2, 1)).toBe(2);
    expect(stepUiZoom(0.5, -1)).toBe(0.5);
  });

  it("steps off the nearest level when handed one it does not offer", () => {
    expect(stepUiZoom(1.4, 1)).toBe(1.75);
    expect(stepUiZoom(1.4, -1)).toBe(1.25);
  });

  it("walks the whole range in either direction", () => {
    let up = UI_ZOOM_LEVELS[0];
    for (let i = 0; i < UI_ZOOM_LEVELS.length * 2; i++) up = stepUiZoom(up, 1);
    expect(up).toBe(2);
    let down = 2;
    for (let i = 0; i < UI_ZOOM_LEVELS.length * 2; i++)
      down = stepUiZoom(down, -1);
    expect(down).toBe(0.5);
  });
});

describe("pixelRatioFor", () => {
  it("is the display's own ratio at 100%", () => {
    expect(pixelRatioFor(2, 1)).toBe(2);
    expect(pixelRatioFor(1, 1)).toBe(1);
  });

  it("caps the display's scale, not the zoomed number", () => {
    // A retina Mac at 150% reports 3. The view is 1.5x fewer CSS pixels across,
    // so 3 is the ratio that fills it: capping at 2 would lose a third of them.
    expect(pixelRatioFor(3, 1.5)).toBe(3);
    expect(pixelRatioFor(4, 2)).toBe(4);
  });

  it("draws the same number of device pixels at every zoom", () => {
    // 800 CSS pixels wide at 100%, and what a zoom does to that view.
    const deviceScale = 2;
    const cssWidthAt = (zoom: number) => 800 / zoom;
    for (const zoom of UI_ZOOM_LEVELS) {
      const buffer =
        cssWidthAt(zoom) * pixelRatioFor(deviceScale * zoom, zoom, 2);
      expect(buffer).toBeCloseTo(800 * deviceScale, 6);
    }
  });

  it("still caps a display that scales beyond the cap on its own", () => {
    // A 3x display at 100% is capped to 2, which is what the cap is for.
    expect(pixelRatioFor(3, 1)).toBe(2);
    // And at 150% that same display reports 4.5, capped to 2 then re-zoomed.
    expect(pixelRatioFor(4.5, 1.5)).toBe(3);
  });

  it("takes a lower cap for performance mode", () => {
    expect(pixelRatioFor(2, 1, 1)).toBe(1);
    expect(pixelRatioFor(3, 1.5, 1)).toBe(1.5);
  });
});
