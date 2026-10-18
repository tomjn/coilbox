/**
 * A colourway chip's colour, read from the atlas under its swatch (#4538).
 */

import { describe, expect, it } from "vitest";

import { TEAM_COLOUR } from "../lib/springTexture";
import { hexToRgb } from "../lib/textureTeamColour";
import { swatchColour } from "./colourwayColours";

/** A 2 by 2 atlas: red over green on the left, blue over white on the right. */
function atlas(alpha = 255) {
  // Rows from the top left.
  const rows = [
    [255, 0, 0, alpha, 0, 0, 255, alpha],
    [0, 255, 0, alpha, 255, 255, 255, alpha],
  ];
  return { width: 2, height: 2, data: new Uint8ClampedArray(rows.flat()) };
}

const swatch = (min: [number, number], max: [number, number]) => ({
  id: "x",
  uv: { min, max },
  tile: 1,
});

describe("swatchColour", () => {
  it("reads v up from the bottom, as three draws the atlas", () => {
    // The bottom left pixel is the green one.
    expect(swatchColour(atlas(0), swatch([0, 0], [0.5, 0.5]), false)).toBe(
      "rgb(0 255 0)",
    );
    expect(swatchColour(atlas(0), swatch([0.5, 0.5], [1, 1]), false)).toBe(
      "rgb(0 0 255)",
    );
  });

  it("averages the pixels under the swatch", () => {
    expect(swatchColour(atlas(0), swatch([0, 0], [0.5, 1]), false)).toBe(
      "rgb(128 128 0)",
    );
  });

  it("mixes in the team colour where the alpha masks it", () => {
    const [r, g, b] = hexToRgb(TEAM_COLOUR);
    expect(swatchColour(atlas(255), swatch([0, 0], [0.5, 0.5]), true)).toBe(
      `rgb(${r} ${g} ${b})`,
    );
    expect(swatchColour(atlas(0), swatch([0, 0], [0.5, 0.5]), true)).toBe(
      "rgb(0 255 0)",
    );
  });

  it("has no colour for a swatch off the atlas", () => {
    expect(
      swatchColour(atlas(), swatch([2, 2], [3, 3]), false),
    ).toBeUndefined();
  });
});
