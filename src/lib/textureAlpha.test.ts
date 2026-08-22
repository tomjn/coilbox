import { describe, expect, it } from "vitest";

import { headerHasAlpha } from "./textureAlpha";

function png(colourType: number): Uint8Array {
  const bytes = new Uint8Array(64);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  // IHDR: length, tag, 4 byte width, 4 byte height, bit depth, colour type.
  bytes.set([0, 0, 0, 13], 8);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  bytes[24] = 8;
  bytes[25] = colourType;
  return bytes;
}

function dds(fourCC: string, flags = 0): Uint8Array {
  const bytes = new Uint8Array(128);
  bytes.set([0x44, 0x44, 0x53, 0x20]);
  bytes[80] = flags & 0xff;
  for (let at = 0; at < 4; at += 1) {
    bytes[84 + at] = fourCC.charCodeAt(at) || 0;
  }
  return bytes;
}

describe("headerHasAlpha", () => {
  /**
   * The case the guard exists for: a `.tga` an older coilbox re-encoded to an
   * RGB PNG on the way into its store, cutting the team-colour mask out of it.
   */
  it("reads a PNG's colour type", () => {
    expect(headerHasAlpha(png(6))).toBe(true); // truecolour with alpha
    expect(headerHasAlpha(png(4))).toBe(true); // grey with alpha
    expect(headerHasAlpha(png(2))).toBe(false); // truecolour
    expect(headerHasAlpha(png(0))).toBe(false); // grey
    expect(headerHasAlpha(png(3))).toBe(false); // palette
  });

  /** DXT1's one bit is read as opaque by the engine's own loader, so a model
   *  compressed that way has no mask to paint from. */
  it("counts DXT1 as no alpha and DXT3 upwards as alpha", () => {
    expect(headerHasAlpha(dds("DXT1"))).toBe(false);
    expect(headerHasAlpha(dds("DXT3"))).toBe(true);
    expect(headerHasAlpha(dds("DXT5"))).toBe(true);
  });

  /** An uncompressed DDS says so in its pixel format flags instead. */
  it("reads an uncompressed DDS's alpha flag", () => {
    expect(headerHasAlpha(dds("\0\0\0\0", 0x41))).toBe(true);
    expect(headerHasAlpha(dds("\0\0\0\0", 0x40))).toBe(false);
  });

  it("knows a JPEG never carries one", () => {
    expect(headerHasAlpha(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe(
      false,
    );
  });

  /**
   * Not knowing is not the same as no. The caller goes on painting, because the
   * engine paints from that alpha whatever the file turns out to be.
   */
  it("says nothing about a format it does not read", () => {
    expect(headerHasAlpha(dds("DX10"))).toBeUndefined();
    expect(headerHasAlpha(new Uint8Array([1, 2, 3, 4]))).toBeUndefined();
    expect(headerHasAlpha(new Uint8Array(0))).toBeUndefined();
    // A DDS truncated before its pixel format cannot be read either.
    expect(
      headerHasAlpha(new Uint8Array([0x44, 0x44, 0x53, 0x20])),
    ).toBeUndefined();
  });
});
