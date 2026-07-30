import { describe, expect, it } from "vitest";

import { exportTextureName, type LegoAtlas, unitAtlas } from "./atlas";
import { newProject } from "./model";

describe("unitAtlas", () => {
  const atlases: LegoAtlas[] = [
    { tex1: "atlas.png", packId: "base", folder: null },
    { tex1: "desert.png", packId: "desert", folder: "desert" },
  ];

  function unit(atlas?: string) {
    return {
      ...newProject({
        id: "u",
        rootPieceId: "root",
        name: "unit",
        packId: "base",
        packVersion: "1",
        now: "2026-01-01",
      }),
      ...(atlas ? { atlas } : {}),
    };
  }

  it("gives the base atlas to a unit that names none", () => {
    expect(unitAtlas(unit(), atlases)).toEqual({
      texture: "atlas.png",
      installed: atlases[0],
      drawWith: atlases[0],
    });
  });

  it("gives a unit the atlas it names", () => {
    expect(unitAtlas(unit("desert.png"), atlases)).toEqual({
      texture: "desert.png",
      installed: atlases[1],
      drawWith: atlases[1],
    });
  });

  it("keeps a missing atlas's name and draws with the base one", () => {
    // The s3o has to keep naming it, so installing the pack later is the fix.
    expect(unitAtlas(unit("arctic.png"), atlases)).toEqual({
      texture: "arctic.png",
      installed: null,
      drawWith: atlases[0],
    });
  });

  it("treats an atlas that is no longer installed as missing", () => {
    expect(unitAtlas(unit("desert.png"), [atlases[0]])).toEqual({
      texture: "desert.png",
      installed: null,
      drawWith: atlases[0],
    });
  });
});

describe("exportTextureName", () => {
  it("writes an atlas under a name a game folder would not already hold", () => {
    // The base pack calls its atlas "atlas.png", which is exactly the name a
    // game plausibly has in unittextures/ already.
    expect(exportTextureName("atlas.png")).toBe("coilbox_atlas.png");
    expect(exportTextureName("atlas.png")).not.toBe("atlas.png");
  });

  it("keeps two atlases apart, as their own names already are", () => {
    expect(exportTextureName("desert.png")).not.toBe(
      exportTextureName("atlas.png"),
    );
  });

  it("gives the same name whether or not the atlas is installed", () => {
    // A unit naming an atlas it has not got still exports against the file that
    // atlas would be written as, so installing the pack later completes it.
    const missing = unitAtlas(
      {
        ...newProject({
          id: "u",
          rootPieceId: "root",
          name: "unit",
          packId: "base",
          packVersion: "1",
          now: "2026-01-01",
        }),
        atlas: "arctic.png",
      },
      [{ tex1: "atlas.png", packId: "base", folder: null }],
    );
    expect(missing.installed).toBeNull();
    expect(exportTextureName(missing.texture)).toBe("coilbox_arctic.png");
  });
});
