import { describe, expect, it } from "vitest";

import { isLoose, modelSource, textureMember } from "./gameImport";

const files = [
  { path: "unittextures/ARMCOM.png", size: 1 },
  { path: "unittextures/sub/armcom.dds", size: 1 },
  { path: "unittextures/corcom.dds", size: 1 },
  { path: "objects3d/armcom.s3o", size: 1 },
  { path: "bitmaps/armcom.dds", size: 1 },
];

describe("isLoose", () => {
  it("is only a .sdd, whatever case it is written in", () => {
    expect(isLoose("SplinterFaction.SDD")).toBe(true);
    expect(isLoose("balanced_annihilation-v15.9.8.sdz")).toBe(false);
    expect(isLoose("abc123.sdp")).toBe(false);
  });
});

describe("modelSource", () => {
  it("is the archive's own path with the member on the end", () => {
    expect(
      modelSource({
        archive: "Game.sdd",
        archivePath: "/games/Game.sdd",
        member: "objects3d/armcom.s3o",
      }),
    ).toBe("/games/Game.sdd/objects3d/armcom.s3o");
  });

  it("falls back to the archive's name when its path did not resolve", () => {
    expect(
      modelSource({ archive: "Game.sdz", member: "objects3d/armcom.s3o" }),
    ).toBe("Game.sdz/objects3d/armcom.s3o");
  });
});

describe("textureMember", () => {
  it("matches the name a header gives without regard to case", () => {
    expect(textureMember(files, "armcom.png")).toBe("unittextures/ARMCOM.png");
  });

  it("takes the same stem under another extension, as the loose walk does", () => {
    expect(textureMember(files, "armcom.dds")).toBe("unittextures/ARMCOM.png");
  });

  it("ignores a header's path and keeps only the file name", () => {
    expect(textureMember(files, "arm\\corcom.dds")).toBe(
      "unittextures/corcom.dds",
    );
  });

  it("looks nowhere but unittextures, and not below it", () => {
    // `bitmaps/armcom.dds` and `unittextures/sub/armcom.dds` are both invisible
    // to the loose walk, so neither may be unpacked in its place.
    expect(textureMember(files, "nothere.dds")).toBeNull();
    expect(
      textureMember(
        [{ path: "unittextures/sub/only.dds", size: 1 }],
        "only.dds",
      ),
    ).toBeNull();
  });

  it("has nothing to find for a header naming no texture", () => {
    expect(textureMember(files, "   ")).toBeNull();
  });
});
