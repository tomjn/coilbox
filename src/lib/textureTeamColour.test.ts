import { describe, expect, it } from "vitest";

import {
  forceOpaqueInto,
  hexToRgb,
  mixTeamColourInto,
} from "./textureTeamColour";

describe("hexToRgb", () => {
  it("splits a 0xRRGGBB int into its channels", () => {
    expect(hexToRgb(0x1028cc)).toEqual([0x10, 0x28, 0xcc]);
    expect(hexToRgb(0x000000)).toEqual([0, 0, 0]);
    expect(hexToRgb(0xffffff)).toEqual([255, 255, 255]);
  });
});

describe("mixTeamColourInto", () => {
  const team: [number, number, number] = [0x10, 0x28, 0xcc];

  /** Alpha 0 is the engine's "none of this pixel is team colour". */
  it("leaves rgb untouched at alpha 0", () => {
    const data = Uint8ClampedArray.from([200, 50, 100, 0]);
    mixTeamColourInto(data, team);
    expect([...data]).toEqual([200, 50, 100, 255]);
  });

  /** Alpha 255 is "paint this pixel fully in the team colour". */
  it("replaces rgb with the team colour at alpha 255", () => {
    const data = Uint8ClampedArray.from([200, 50, 100, 255]);
    mixTeamColourInto(data, team);
    expect([...data]).toEqual([0x10, 0x28, 0xcc, 255]);
  });

  /** Halfway is the average of the two, matching `mix(rgb, teamColour, 0.5)`. */
  it("mixes proportionally in between", () => {
    const data = Uint8ClampedArray.from([200, 50, 100, 128]);
    mixTeamColourInto(data, team);
    const a = 128 / 255;
    expect([...data]).toEqual([
      Math.round(200 + (0x10 - 200) * a),
      Math.round(50 + (0x28 - 50) * a),
      Math.round(100 + (0xcc - 100) * a),
      255,
    ]);
  });

  it("forces alpha to 255 on every pixel it touches, not just the first", () => {
    const data = Uint8ClampedArray.from([
      10, 20, 30, 0, 40, 50, 60, 128, 70, 80, 90, 255,
    ]);
    mixTeamColourInto(data, team);
    expect(data[3]).toBe(255);
    expect(data[7]).toBe(255);
    expect(data[11]).toBe(255);
  });
});

describe("forceOpaqueInto", () => {
  it("sets every pixel's alpha to 255 and leaves rgb alone", () => {
    const data = Uint8ClampedArray.from([
      10, 20, 30, 0, 40, 50, 60, 90, 70, 80, 90, 255,
    ]);
    forceOpaqueInto(data);
    expect([...data]).toEqual([
      10, 20, 30, 255, 40, 50, 60, 255, 70, 80, 90, 255,
    ]);
  });
});
