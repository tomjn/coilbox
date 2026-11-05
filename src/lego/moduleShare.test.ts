import { describe, expect, it } from "vitest";

import {
  bytesToBase64Url,
  encodeContainerCode,
  identify,
} from "@/container/container";
import {
  type LegoPiece,
  type LegoProject,
  newProject,
  pieceTextures,
} from "./model";
import {
  moduleShareCode,
  moduleSharePayload,
  readSharedModule,
  sharedModuleToSave,
} from "./moduleShare";
import { encodeRawGeometry, type RawGeometry } from "./rawGeometry";

function module(extra: Partial<LegoPiece> = {}): LegoProject {
  const base = newProject({
    id: "m1",
    rootPieceId: "root",
    name: "Turret",
    packId: "lego",
    packVersion: "1",
    now: "2026-10-17T00:00:00Z",
  });
  return {
    ...base,
    pieces: [
      ...base.pieces,
      {
        id: "p1",
        name: "barrel",
        parentId: "root",
        partId: "part1",
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
        ...extra,
      },
    ],
  };
}

const lifted = {
  partId: null,
  meshId: "m0",
  lifted: {
    game: { name: "Beyond All Reason", archive: "bar.sdd" },
    member: "objects3d/armcom.s3o",
  },
};

/** One triangle under `m0`, and a second mesh no piece names. */
function geometry(): RawGeometry {
  const triangle = (id: string, vFirst: number, iFirst: number) => ({
    id,
    vFirst,
    vCount: 3,
    iFirst,
    iCount: 3,
    bbox: {
      min: [0, 0, 0] as [number, number, number],
      max: [1, 1, 0] as [number, number, number],
    },
  });
  return {
    byId: new Map([
      ["m0", triangle("m0", 0, 0)],
      ["m9", triangle("m9", 3, 3)],
    ]),
    vertices: Float32Array.from({ length: 48 }, (_, i) => i / 4),
    indices: Uint32Array.from([0, 1, 2, 2, 1, 0]),
  };
}

/** The maker's own mesh, as the file dialog's import records it (#4360). */
const own = {
  partId: null,
  meshId: "m0",
  ownMesh: { file: "hull.s3o" },
};

/** A module code built by hand, the way one from outside coilbox would be. */
function handMade(payload: unknown): string {
  return encodeContainerCode("module", 1, payload);
}

describe("moduleShareCode", () => {
  it("makes a module code that names the kind", () => {
    const made = moduleShareCode(module(), null);
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    expect(identify(made.code).kind).toBe("module");
  });

  it("refuses a module holding a lifted piece and says why", () => {
    expect(moduleShareCode(module(lifted), null)).toEqual({
      ok: false,
      reason:
        "This module holds a piece from Beyond All Reason: barrel. Geometry lifted from a game cannot be uploaded to the hub.",
    });
  });
});

describe("sharing the maker's own meshes (#4360)", () => {
  it("carries only the meshes the pieces name", () => {
    const payload = moduleSharePayload(module(own), geometry());
    expect(typeof payload.geometry).toBe("string");
    const made = moduleShareCode(module(own), geometry());
    if (!made.ok) throw new Error(made.reason);
    const read = readSharedModule(made.code, new Set());
    if (!read.ok) throw new Error(read.reason);
    expect([...(read.geometry?.byId.keys() ?? [])]).toEqual(["m0"]);
  });

  it("round trips the mesh and its record through a code", () => {
    const source = module(own);
    const made = moduleShareCode(source, geometry());
    if (!made.ok) throw new Error(made.reason);
    const read = readSharedModule(made.code, new Set());
    if (!read.ok) throw new Error(read.reason);
    expect(read.project).toEqual(source);
    expect(read.project.pieces[1].ownMesh).toEqual({ file: "hull.s3o" });
    const mesh = read.geometry?.byId.get("m0");
    expect(mesh && { ...mesh, vFirst: 0, iFirst: 0 }).toEqual(
      geometry().byId.get("m0"),
    );
    expect(Array.from(read.geometry?.vertices ?? [])).toEqual(
      Array.from(geometry().vertices.subarray(0, 24)),
    );
    expect(Array.from(read.geometry?.indices ?? [])).toEqual([0, 1, 2]);
  });

  it("does not put the meshes in the module document", () => {
    const made = moduleShareCode(module(own), geometry());
    if (!made.ok) throw new Error(made.reason);
    const read = readSharedModule(made.code, new Set());
    expect(read.ok && "geometry" in read.project).toBe(false);
  });

  it("refuses a mesh with no record, whatever the code carries", () => {
    const bare = module({ partId: null, meshId: "m0" });
    expect(moduleShareCode(bare, geometry())).toEqual({
      ok: false,
      reason:
        "This module holds meshes with no record of where they came from: barrel. Only meshes imported from your own model file can be shared.",
    });
    const code = handMade({
      ...bare,
      geometry: bytesToBase64Url(encodeRawGeometry(geometry())),
    });
    expect(readSharedModule(code, new Set()).ok).toBe(false);
  });

  it("still refuses lifted geometry, even beside a geometry file", () => {
    const both = module({ ...own, ...lifted });
    expect(moduleShareCode(both, geometry())).toMatchObject({ ok: false });
    const code = handMade({
      ...both,
      geometry: bytesToBase64Url(encodeRawGeometry(geometry())),
    });
    expect(readSharedModule(code, new Set()).ok).toBe(false);
  });

  it("refuses to share an own mesh its geometry file lacks", () => {
    const missing = module({ ...own, meshId: "m5" });
    expect(moduleShareCode(missing, geometry())).toEqual({
      ok: false,
      reason: "This module names meshes it does not carry: barrel.",
    });
    expect(moduleShareCode(module(own), null)).toMatchObject({ ok: false });
  });

  it("refuses a code whose meshes reach past their arrays", () => {
    const bad = geometry();
    const mesh = bad.byId.get("m0");
    if (mesh) bad.byId.set("m0", { ...mesh, vCount: 400 });
    const code = handMade({
      ...module(own),
      geometry: bytesToBase64Url(encodeRawGeometry(bad)),
    });
    expect(readSharedModule(code, new Set())).toEqual({
      ok: false,
      reason: "The meshes in this module could not be read.",
    });
  });

  it("refuses a code whose indices point past the mesh's vertices", () => {
    const bad = geometry();
    bad.indices[1] = 7;
    const code = handMade({
      ...module(own),
      geometry: bytesToBase64Url(encodeRawGeometry(bad)),
    });
    expect(readSharedModule(code, new Set()).ok).toBe(false);
  });

  it("refuses a code whose geometry is not a geometry file", () => {
    const code = handMade({ ...module(own), geometry: "bm90IGEgYmxvYg" });
    expect(readSharedModule(code, new Set()).ok).toBe(false);
  });
});

describe("sharing the textures own meshes record (#5073)", () => {
  const hull = { key: "aa11.png", name: "hull.png" };
  const glow = { key: "bb22.png", name: "hull_2.png" };
  const textured = module({
    ...own,
    ownMesh: { file: "hull.s3o", texture: hull, texture2: glow },
  });
  /** Bytes that deflate as badly as a real compressed texture does. */
  function noise(length: number): Uint8Array {
    let seed = 7;
    return Uint8Array.from({ length }, () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed >> 16;
    });
  }

  it("carries a texture that fits, and the far end draws with it", () => {
    const bytes = noise(2048);
    const made = moduleShareCode(
      textured,
      geometry(),
      new Map([
        [hull.key, bytes],
        [glow.key, Uint8Array.of(1, 2, 3)],
      ]),
    );
    if (!made.ok) throw new Error(made.reason);
    expect(made.leftOut).toEqual([]);
    const read = readSharedModule(made.code, new Set());
    if (!read.ok) throw new Error(read.reason);
    expect(read.textures).toEqual([
      { key: hull.key, bytes },
      { key: glow.key, bytes: Uint8Array.of(1, 2, 3) },
    ]);
    expect(pieceTextures(read.project.pieces[1])).toEqual({
      texture: hull,
      texture2: glow,
    });
  });

  it("leaves out a texture over the ceiling, and the far end draws without it", () => {
    // 400,000 bytes is 533,334 as base64, over the 524,288 a code inflates to.
    const made = moduleShareCode(
      textured,
      geometry(),
      new Map([
        [hull.key, noise(400_000)],
        [glow.key, Uint8Array.of(1, 2, 3)],
      ]),
    );
    if (!made.ok) throw new Error(made.reason);
    expect(made.leftOut).toEqual(["hull.png"]);
    const read = readSharedModule(made.code, new Set());
    if (!read.ok) throw new Error(read.reason);
    expect(read.textures.map((texture) => texture.key)).toEqual([glow.key]);
    expect(read.project.pieces[1].ownMesh).toEqual({
      file: "hull.s3o",
      texture2: glow,
    });
  });

  it("leaves out a texture the store no longer holds", () => {
    const made = moduleShareCode(textured, geometry(), new Map());
    if (!made.ok) throw new Error(made.reason);
    expect(made.leftOut).toEqual(["hull.png", "hull_2.png"]);
    const read = readSharedModule(made.code, new Set());
    expect(read.ok && pieceTextures(read.project.pieces[1])).toBe(null);
  });

  it("takes only the textures the pieces name off a hand made code", () => {
    const code = handMade({
      ...textured,
      geometry: bytesToBase64Url(encodeRawGeometry(geometry())),
      textures: {
        [hull.key]: bytesToBase64Url(Uint8Array.of(9)),
        "cc33.png": bytesToBase64Url(Uint8Array.of(8)),
      },
    });
    const read = readSharedModule(code, new Set());
    if (!read.ok) throw new Error(read.reason);
    expect(read.textures).toEqual([{ key: hull.key, bytes: Uint8Array.of(9) }]);
  });
});

describe("readSharedModule", () => {
  it("round trips a module of parts", () => {
    const source = module();
    const made = moduleShareCode(source, null);
    if (!made.ok) throw new Error(made.reason);
    const read = readSharedModule(made.code, new Set(["part1"]));
    expect(read).toEqual({
      ok: true,
      project: source,
      missingParts: [],
      geometry: null,
      textures: [],
    });
  });

  it("lists the pieces whose part the loaded pack lacks", () => {
    const made = moduleShareCode(module(), null);
    if (!made.ok) throw new Error(made.reason);
    const read = readSharedModule(made.code, new Set());
    expect(read.ok && read.missingParts).toEqual(["barrel"]);
  });

  it("never loads a module holding a lifted piece", () => {
    // Built by hand, the way a code from somewhere other than coilbox would be.
    const code = JSON.stringify({
      format: "coilbox",
      container: 1,
      kind: "module",
      kindVersion: 1,
      payload: module(lifted),
    });
    expect(readSharedModule(code, new Set())).toEqual({
      ok: false,
      reason:
        "This module holds geometry from a game, or meshes with no record that they are the maker's own, which a shared module cannot carry.",
    });
  });

  it("refuses something that is not a module", () => {
    expect(readSharedModule("hello", new Set())).toEqual({
      ok: false,
      reason: "That is not a coilbox module.",
    });
  });
});

describe("sharedModuleToSave", () => {
  const fresh = { id: "fresh", now: "2026-10-18T00:00:00Z" };

  it("keeps a module whose id and name are new as it came", () => {
    const made = moduleShareCode(module(), null);
    if (!made.ok) throw new Error(made.reason);
    const saved = sharedModuleToSave(made.code, [], new Set(["part1"]), fresh);
    expect(saved.ok && saved.project.id).toBe("m1");
  });

  it("never replaces a module already there", () => {
    const made = moduleShareCode(module(), null);
    if (!made.ok) throw new Error(made.reason);
    const saved = sharedModuleToSave(made.code, [module()], new Set(), fresh);
    expect(saved.ok && [saved.project.id, saved.project.name]).toEqual([
      "fresh",
      "Turret 2",
    ]);
  });
});
