import { describe, expect, it } from "vitest";

import type { ImportedPiece, ImportedTexture, S3oImport } from "./bindings";
import type { LegoProject } from "./model";
import {
  blenderTextures,
  importedTextures,
  pngName,
  projectFromImport,
  texturesInUse,
} from "./rawImport";

function piece(
  name: string,
  meshId: string | null,
  children: ImportedPiece[] = [],
): ImportedPiece {
  return { name, offset: [1, 2, 3], meshId, children };
}

function texture(
  key: string | null,
  name: string,
  source: string | null = null,
): ImportedTexture {
  return { key, name, source };
}

function result(overrides: Partial<S3oImport> = {}): S3oImport {
  return {
    radius: 12.5,
    height: 7.25,
    mid: [0, 3, 0],
    root: piece("Base", null, [piece("Hull", "m1", [piece("Gun", "m2")])]),
    texture: texture(
      "aa11.dds",
      "Beacon_1.dds",
      "/game/unittextures/Beacon_1.dds",
    ),
    texture2: texture(
      "bb22.dds",
      "Beacon_2.dds",
      "/game/unittextures/Beacon_2.dds",
    ),
    meshes: 2,
    vertices: 930,
    triangles: 610,
    converted: 0,
    bytes: 4096,
    ...overrides,
  };
}

function build(overrides: Partial<S3oImport> = {}, unpacked = false) {
  let n = 0;
  return projectFromImport(result(overrides), {
    id: "unit-1",
    source: "/game/objects3d/Beacon.s3o",
    name: "Beacon",
    unitName: "Beacon",
    packId: "coilbox-lego",
    packVersion: "1",
    now: "2026-07-31T00:00:00.000Z",
    newId: () => `p${n++}`,
    ...(unpacked ? { unpacked: true } : {}),
  });
}

describe("projectFromImport", () => {
  it("keeps the tree, and names every piece as a script can address it", () => {
    const { project } = build({
      root: piece("Base Plate", null, [
        piece("hull", "m1"),
        // The same name twice, which a shipped model is free to do and a unit
        // script is not.
        piece("Hull", "m2"),
      ]),
    });

    expect(project.pieces.map((p) => p.name)).toEqual([
      "base_plate",
      "hull",
      "hull2",
    ]);
    expect(project.rootPieceId).toBe("p0");
    expect(project.pieces[1].parentId).toBe("p0");
  });

  it("puts geometry on a mesh key and never on a part", () => {
    const { project } = build();

    const hull = project.pieces.find((p) => p.name === "hull");
    expect(hull?.meshId).toBe("m1");
    expect(hull?.partId).toBeNull();
    // A piece with no geometry carries no key at all, which is how the format
    // expresses hierarchy, flares and aim points.
    expect(project.pieces[0].meshId).toBeUndefined();
  });

  it("takes each piece's offset as its position, with no rotation or scale", () => {
    const { project } = build();

    expect(project.pieces[1].position).toEqual([1, 2, 3]);
    expect(project.pieces[1].rotation).toEqual([0, 0, 0]);
    expect(project.pieces[1].scale).toEqual([1, 1, 1]);
  });

  it("pins the header the model came in with", () => {
    const { project } = build();

    expect(project.radius).toBe(12.5);
    expect(project.height).toBe(7.25);
    expect(project.mid).toEqual([0, 3, 0]);
  });

  it("records both textures and where they were read from", () => {
    const { project } = build();

    expect(project.imported?.source).toBe("/game/objects3d/Beacon.s3o");
    expect(project.imported?.texture).toEqual({
      key: "aa11.dds",
      name: "Beacon_1.dds",
      source: "/game/unittextures/Beacon_1.dds",
    });
    expect(project.imported?.texture2?.key).toBe("bb22.dds");
  });

  it("records no source for a model unpacked out of a packed archive", () => {
    const { project } = build(
      {
        texture: texture(
          "aa11.dds",
          "Beacon_1.dds",
          "/tmp/coilbox-lego-model-1/unittextures/Beacon_1.dds",
        ),
      },
      true,
    );

    // The temp folder goes when the operating system decides it does, so a path
    // into it is a promise the unit cannot keep.
    expect(project.imported?.texture).toEqual({
      key: "aa11.dds",
      name: "Beacon_1.dds",
    });
    expect(project.imported?.texture2?.source).toBeUndefined();
    // What the unit is drawn with is unaffected: coilbox has its own copy.
    expect(project.imported?.texture2?.key).toBe("bb22.dds");
  });

  it("remembers the name of a texture that could not be found", () => {
    const { project } = build({
      texture: texture(null, "Beacon_1.dds"),
      texture2: texture(null, ""),
    });

    expect(project.imported?.texture).toBeUndefined();
    expect(project.imported?.missingTexture).toBe("Beacon_1.dds");
    // A model that names no second texture is not missing one.
    expect(project.imported?.missingTexture2).toBeUndefined();
  });

  it("carries the counts the drawer reports", () => {
    const imported = build({ converted: 27, vertices: 4657, triangles: 3044 });

    expect(imported.converted).toBe(27);
    expect(imported.vertices).toBe(4657);
    expect(imported.triangles).toBe(3044);
  });
});

describe("importedTextures", () => {
  it("names and places both textures under the game's own names", () => {
    const { project } = build();

    const out = importedTextures(project.imported as never);

    expect(out.texture1).toBe("Beacon_1.dds");
    expect(out.texture2).toBe("Beacon_2.dds");
    expect(out.place).toEqual([
      { key: "aa11.dds", writeAs: "Beacon_1.dds" },
      { key: "bb22.dds", writeAs: "Beacon_2.dds" },
    ]);
  });

  it("still names a texture it has no copy of, and places nothing", () => {
    const { project } = build({
      texture: texture(null, "Beacon_1.dds"),
      texture2: texture(null, ""),
    });

    const out = importedTextures(project.imported as never);

    // Installing the file later puts the exported unit right without the unit
    // having to change.
    expect(out.texture1).toBe("Beacon_1.dds");
    expect(out.texture2).toBe("");
    expect(out.place).toEqual([]);
  });
});

describe("pngName", () => {
  it("renames whatever the model calls a texture to the PNG it becomes", () => {
    expect(pngName("Beacon_1.dds")).toBe("Beacon_1.png");
    expect(pngName("Beacon_1.PNG")).toBe("Beacon_1.png");
    // A header naming a path, which s3o files out of some games do.
    expect(pngName("unittextures\\Beacon_1.dds")).toBe("Beacon_1.png");
    // A dotless name gains an extension rather than losing its name.
    expect(pngName("Beacon")).toBe("Beacon.png");
  });
});

describe("blenderTextures", () => {
  it("names both as PNGs, since Blender reads no dds", () => {
    const { project } = build();

    const out = blenderTextures(project.imported as never);

    // The role travels with each: Rust reads it to decide what happens to the
    // alpha channel, which the two textures mean different things by.
    expect(out.colour).toEqual({
      key: "aa11.dds",
      writeAs: "Beacon_1.png",
      role: "colour",
    });
    expect(out.mask).toEqual({
      key: "bb22.dds",
      writeAs: "Beacon_2.png",
      role: "mask",
    });
  });

  it("has nothing for a texture the import could not find", () => {
    const { project } = build({
      texture: texture(null, "Beacon_1.dds"),
      texture2: texture(null, ""),
    });

    const out = blenderTextures(project.imported as never);

    expect(out.colour).toBeNull();
    expect(out.mask).toBeNull();
  });

  it("has a colour and no mask for a model carrying one texture", () => {
    const { project } = build({ texture2: texture(null, "") });

    const out = blenderTextures(project.imported as never);

    expect(out.colour?.writeAs).toBe("Beacon_1.png");
    expect(out.mask).toBeNull();
  });
});

describe("texturesInUse", () => {
  it("is every key across every unit, once each", () => {
    const one = build().project;
    const two: LegoProject = {
      ...one,
      id: "unit-2",
      imported: {
        source: "/game/objects3d/Other.s3o",
        // The same texture as the first unit, which is the whole reason the
        // store is shared and keyed by content.
        texture: { key: "aa11.dds", name: "Beacon_1.dds" },
      },
    };

    expect(texturesInUse([one, two]).sort()).toEqual(["aa11.dds", "bb22.dds"]);
    // A unit built out of parts names none.
    expect(texturesInUse([{ ...one, imported: undefined }])).toEqual([]);
  });
});
