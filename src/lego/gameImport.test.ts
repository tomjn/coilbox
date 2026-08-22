import { describe, expect, it } from "vitest";

import { modelSource, textureMember } from "./gameImport";

const files = [
  { path: "unittextures/ARMCOM.png", size: 1 },
  { path: "unittextures/sub/armcom.dds", size: 1 },
  { path: "unittextures/corcom.dds", size: 1 },
  { path: "objects3d/armcom.s3o", size: 1 },
  { path: "bitmaps/armcom.dds", size: 1 },
];

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
  const model = "objects3d/armcom.s3o";

  it("matches the name a header gives without regard to case", () => {
    expect(textureMember(files, "armcom.png", model)).toBe(
      "unittextures/ARMCOM.png",
    );
  });

  it("takes the same stem under another extension, as the loose walk does", () => {
    expect(textureMember(files, "armcom.dds", model)).toBe(
      "unittextures/ARMCOM.png",
    );
  });

  it("ignores a header's path and keeps only the file name", () => {
    expect(textureMember(files, "arm\\corcom.dds", model)).toBe(
      "unittextures/corcom.dds",
    );
  });

  it("looks in no folder the loose walk would not reach", () => {
    // `bitmaps/armcom.dds` is neither a unittextures folder above the model nor
    // the model's own folder, so it may not be unpacked in its place.
    expect(textureMember(files, "nothere.dds", model)).toBeNull();
    expect(
      textureMember(
        [{ path: "unittextures/sub/only.dds", size: 1 }],
        "only.dds",
        model,
      ),
    ).toBeNull();
  });

  it("falls back to the model's own folder, which is where a map's features keep theirs", () => {
    expect(
      textureMember(
        [
          { path: "objects3d/rock.s3o", size: 1 },
          { path: "objects3d/rock.png", size: 1 },
        ],
        "rock.dds",
        "objects3d/rock.s3o",
      ),
    ).toBe("objects3d/rock.png");
  });

  it("prefers a unittextures above the model to the folder it sits in", () => {
    expect(
      textureMember(
        [
          { path: "objects3d/rock.s3o", size: 1 },
          { path: "objects3d/rock.dds", size: 1 },
          { path: "unittextures/rock.dds", size: 1 },
        ],
        "rock.dds",
        "objects3d/rock.s3o",
      ),
    ).toBe("unittextures/rock.dds");
  });

  it("takes the nearest unittextures when a model sits deeper in", () => {
    expect(
      textureMember(
        [
          { path: "objects3d/arm/com.s3o", size: 1 },
          { path: "objects3d/arm/unittextures/com.dds", size: 1 },
          { path: "unittextures/com.dds", size: 1 },
        ],
        "com.dds",
        "objects3d/arm/com.s3o",
      ),
    ).toBe("objects3d/arm/unittextures/com.dds");
  });

  it("has nothing to find for a header naming no texture", () => {
    expect(textureMember(files, "   ", model)).toBeNull();
  });
});
