import { describe, expect, it } from "vitest";
import { type ParsedDds, skyboxFromDds, skyboxNote } from "./skyboxNote";

/** A cube map DDS as `DDSLoader.parse` reports one: six faces of one mip each. */
function cubeMap(over: Partial<ParsedDds> = {}): ParsedDds {
  return {
    format: 33779,
    isCubemap: true,
    mipmaps: Array.from({ length: 6 }, () => ({})),
    mipmapCount: 1,
    ...over,
  };
}

describe("skyboxFromDds", () => {
  it("takes a six faced cube map as the sky", () => {
    expect(skyboxFromDds(cubeMap())).toBeNull();
    expect(
      skyboxFromDds(
        cubeMap({ mipmaps: Array.from({ length: 24 }), mipmapCount: 4 }),
      ),
    ).toBeNull();
  });

  it("calls a file the loader never worked out unreadable, not flat", () => {
    // What DDSLoader hands back for DX10 and BC7: it logs, gives up, and
    // returns the object it started with, whose isCubemap is false.
    expect(
      skyboxFromDds({
        format: null,
        isCubemap: false,
        mipmaps: [],
        mipmapCount: 1,
      }),
    ).toBe("unreadable");
  });

  it("calls a DDS that read fine but holds one image not a cube map", () => {
    expect(skyboxFromDds(cubeMap({ isCubemap: false, mipmaps: [{}] }))).toBe(
      "not-a-cube-map",
    );
  });

  it("calls a cube map short of faces unreadable", () => {
    expect(skyboxFromDds(cubeMap({ mipmaps: [{}, {}, {}] }))).toBe("unreadable");
  });
});

describe("skyboxNote", () => {
  it("says nothing about a map that declares no skybox", () => {
    expect(skyboxNote()).toBeNull();
    expect(skyboxNote(null)).toBeNull();
  });

  it("says a skybox coilbox could not read is why the sky is flat", () => {
    const note = skyboxNote("unreadable");
    expect(note?.label).toBe("flat sky");
    expect(note?.title).toMatch(/cannot read/i);
  });

  it("keeps an unreadable file apart from one that is not a cube map", () => {
    const unreadable = skyboxNote("unreadable");
    const flat = skyboxNote("not-a-cube-map");
    expect(unreadable?.title).not.toBe(flat?.title);
    expect(flat?.title).toMatch(/not a cube map/i);
  });
});
