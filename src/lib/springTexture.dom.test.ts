// @vitest-environment happy-dom

/**
 * Which way up a unit texture samples (#4174). The engine reads v = 0 as the
 * top row of anything but a `.dds`, and as the bottom row of a `.dds`.
 */

import { describe, expect, it } from "vitest";

import { springTexture, vZeroAtTop } from "./springTexture";

/** Where a texture's v = 0 lands, as a fraction of the picture down from the
 *  top, after three's upload flip and the texture's own UV transform. */
function rowOfVZero(url: string): number {
  const texture = springTexture(url);
  texture.updateMatrix();
  const sampled = texture.matrix.elements[7];
  // three's flipY uploads the bottom row first, so a sampled v of 0 is the
  // bottom of the picture. Without it the top row goes first.
  return texture.flipY ? 1 - sampled : sampled;
}

describe("vZeroAtTop", () => {
  it("is true for every format but a .dds", () => {
    expect(vZeroAtTop("esilo.png")).toBe(true);
    expect(vZeroAtTop("ad0_pine_1.tga")).toBe(true);
    expect(vZeroAtTop("coilbox://localhost/legotex/ab12.png?v=2")).toBe(true);
    expect(vZeroAtTop("scavbeacon.dds")).toBe(false);
    expect(vZeroAtTop("SCAVBEACON.DDS")).toBe(false);
  });
});

describe("springTexture", () => {
  it("samples a PNG with v = 0 at the top", () => {
    expect(rowOfVZero("coilbox://localhost/legotex/top.png")).toBe(0);
  });

  it("samples a DDS with v = 0 at the bottom", () => {
    expect(rowOfVZero("coilbox://localhost/legotex/bottom.dds")).toBe(1);
  });
});
