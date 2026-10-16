import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { readPng, withTeamColourMask, writePng } from "./atlas.mjs";

const BUNDLED_ATLAS = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../src-tauri/legoparts/atlas.png",
);

/** Two by two, a different colour in every pixel, so a row or channel slip shows. */
const RGB_PIXELS = Uint8Array.from([
  255, 0, 0, 0, 255, 0, 0, 0, 255, 10, 20, 30,
]);

describe("withTeamColourMask", () => {
  it("gives an atlas with no alpha an alpha of 0 and keeps its colours", () => {
    const { bytes, addedAlpha } = withTeamColourMask(
      writePng(2, 2, RGB_PIXELS, 3),
    );
    const png = readPng(bytes);

    expect(addedAlpha).toBe(true);
    expect(png.channels).toBe(4);
    expect([...png.pixels]).toEqual([
      255, 0, 0, 0, 0, 255, 0, 0, 0, 0, 255, 0, 10, 20, 30, 0,
    ]);
  });

  it("keeps an atlas that already has an alpha channel exactly as it is", () => {
    // A mask somebody drew: the second pixel is all team colour.
    const drawn = writePng(
      2,
      1,
      Uint8Array.from([1, 2, 3, 0, 4, 5, 6, 255]),
      4,
    );
    const { bytes, addedAlpha } = withTeamColourMask(drawn);

    expect(addedAlpha).toBe(false);
    expect(bytes).toBe(drawn);
  });

  it("refuses a PNG it cannot read rather than guessing", () => {
    expect(() => withTeamColourMask(Uint8Array.from([1, 2, 3]))).toThrow(
      "the atlas must be a PNG",
    );
  });
});

describe("the bundled atlas", () => {
  // An export copies this file into the game as it stands, and the engine
  // reads its alpha as the team colour mask. With no alpha channel every pixel
  // reads as 1, and the unit is drawn entirely in team colour (#4164).
  it("carries an alpha channel of 0, so the engine draws no team colour", () => {
    const png = readPng(readFileSync(BUNDLED_ATLAS));

    expect(png.channels).toBe(4);
    let teamColour = 0;
    for (let i = 3; i < png.pixels.length; i += 4) {
      if (png.pixels[i] !== 0) teamColour++;
    }
    expect(teamColour).toBe(0);
  });
});
