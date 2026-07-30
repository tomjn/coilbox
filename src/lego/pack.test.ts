import { describe, expect, it, vi } from "vitest";

// pack.ts reaches the `lego_packs` command through bindings.ts, and the
// published plugin-sdk dist uses extensionless relative imports that Vitest's
// node resolver will not load from node_modules. Only the pure merge and
// validation live here, so stubbing the leaf is enough to let the module load.
// Same stub src/lobby-servers/config.test.ts uses, for the same reason.
vi.mock("@picoframe/plugin-sdk", () => ({
  defineCommand: () => async () => ({}),
}));

import { newProject } from "./model";
import {
  extensionProblem,
  type LegoPackManifest,
  type LegoPartInfo,
  type LoadedPack,
  mergePacks,
  type PackSource,
  projectPackProblems,
  type RawPackManifest,
} from "./pack";

/** Eight floats per vertex, so a part of n vertices is 8n floats. */
const FLOATS_PER_VERTEX = 8;

function part(overrides: Partial<LegoPartInfo> & { id: string }): LegoPartInfo {
  return {
    packId: "unset",
    shapeId: overrides.id,
    name: overrides.id,
    category: "grey",
    colourway: "grey",
    shape: "beam",
    material: "metal",
    tags: [],
    vFirst: 0,
    vCount: 1,
    iFirst: 0,
    iCount: 3,
    bbox: { min: [0, 0, 0], max: [1, 1, 1] },
    uvBox: { min: [0, 0], max: [1, 1] },
    pivot: [0, 0, 0],
    sourceNames: [],
    aliasCount: 0,
    ...overrides,
  };
}

function manifest(
  id: string,
  parts: LegoPartInfo[],
  overrides: Partial<LegoPackManifest> = {},
): LegoPackManifest {
  return {
    schemaVersion: 1,
    id,
    version: "1",
    licence: "",
    atlas: { width: 2048, height: 2048 },
    textures: { tex1: "atlas.png" },
    geometry: {
      file: "parts.bin.gz",
      encoding: "gzip",
      bytes: 0,
      vertexStride: 32,
    },
    categories: [{ id: "grey", label: "Grey" }],
    parts,
    ...overrides,
  };
}

/**
 * A pack whose geometry is one float run per part, so a merged offset can be
 * read straight off the numbers rather than inferred.
 */
function source(
  id: string,
  parts: LegoPartInfo[],
  overrides: Partial<LegoPackManifest> = {},
): PackSource {
  const vertexCount = parts.reduce((sum, p) => sum + p.vCount, 0);
  const indexCount = parts.reduce((sum, p) => sum + p.iCount, 0);
  return {
    manifest: manifest(id, parts, overrides),
    vertices: new Float32Array(vertexCount * FLOATS_PER_VERTEX),
    indices: new Uint16Array(indexCount),
  };
}

describe("extensionProblem", () => {
  const base = manifest("base", []);

  it("accepts a pack that extends the base pack and shares its atlas", () => {
    const raw: RawPackManifest = { ...manifest("aliens", []), extends: "base" };
    expect(extensionProblem(base, raw, "aliens")).toBeNull();
  });

  it("accepts a pack that names no texture at all, which inherits one", () => {
    const { textures: _dropped, ...rest } = manifest("aliens", []);
    expect(
      extensionProblem(base, { ...rest, extends: "base" }, "aliens"),
    ).toBeNull();
  });

  it("rejects a pack that names no base pack", () => {
    const raw: RawPackManifest = manifest("aliens", []);
    expect(extensionProblem(base, raw, "aliens")).toMatch(/names no base pack/);
  });

  it("rejects a pack that extends something else", () => {
    const raw: RawPackManifest = {
      ...manifest("aliens", []),
      extends: "other",
    };
    expect(extensionProblem(base, raw, "aliens")).toMatch(/extends "other"/);
  });

  it("rejects a pack that reuses the base pack's id", () => {
    const raw: RawPackManifest = { ...manifest("base", []), extends: "base" };
    expect(extensionProblem(base, raw, "clone")).toMatch(/base pack's own id/);
  });

  it("rejects a pack that brings its own atlas", () => {
    const raw: RawPackManifest = {
      ...manifest("reskin", [], { textures: { tex1: "reskin.png" } }),
      extends: "base",
    };
    // An s3o names one texture, so this could never be exported as one unit.
    expect(extensionProblem(base, raw, "reskin")).toMatch(/its own texture/);
  });

  it("rejects a pack built for another schema", () => {
    const raw: RawPackManifest = {
      ...manifest("aliens", [], { schemaVersion: 99 }),
      extends: "base",
    };
    expect(extensionProblem(base, raw, "aliens")).toMatch(/schema 99/);
  });
});

describe("mergePacks", () => {
  it("leaves a lone pack's parts and buffers exactly as they were", () => {
    const only = source("base", [part({ id: "a" }), part({ id: "b" })]);
    const merged = mergePacks([only]);

    expect(merged.parts.map((p) => p.id)).toEqual(["a", "b"]);
    expect(merged.parts.map((p) => p.vFirst)).toEqual([0, 0]);
    // Reused rather than copied, so one pack pays nothing for the merge.
    expect(merged.vertices).toBe(only.vertices);
    expect(merged.indices).toBe(only.indices);
    expect(merged.problems).toEqual([]);
  });

  it("stamps every part with the pack it came from", () => {
    const merged = mergePacks([
      source("base", [part({ id: "a" })]),
      source("aliens", [part({ id: "z" })]),
    ]);

    expect(merged.byId.get("a")?.packId).toBe("base");
    expect(merged.byId.get("z")?.packId).toBe("aliens");
  });

  it("rebases a later pack's offsets onto the merged buffers", () => {
    const base = source("base", [
      part({ id: "a", vCount: 2, iCount: 6 }),
      part({ id: "b", vFirst: 2, vCount: 3, iFirst: 6, iCount: 3 }),
    ]);
    const extra = source("aliens", [
      part({ id: "x", vCount: 4, iCount: 6 }),
      part({ id: "y", vFirst: 4, vCount: 1, iFirst: 6, iCount: 3 }),
    ]);

    const merged = mergePacks([base, extra]);

    // The base pack keeps its own offsets, the extension moves past it.
    expect(merged.parts.map((p) => p.vFirst)).toEqual([0, 2, 5, 9]);
    expect(merged.parts.map((p) => p.iFirst)).toEqual([0, 6, 9, 15]);
    expect(merged.vertices.length).toBe(10 * FLOATS_PER_VERTEX);
    expect(merged.indices.length).toBe(18);
  });

  it("keeps the first claim on a part id and reports the rest", () => {
    const base = source("base", [part({ id: "beam", name: "base beam" })]);
    const extra = source("aliens", [
      part({ id: "beam", name: "alien beam" }),
      part({ id: "spike" }),
    ]);

    const merged = mergePacks([base, extra]);

    // The id still means what it always meant, so a saved unit is unchanged.
    expect(merged.byId.get("beam")?.name).toBe("base beam");
    expect(merged.parts.map((p) => p.id)).toEqual(["beam", "spike"]);
    expect(merged.problems).toEqual([
      '"aliens" reuses 1 part id an earlier pack already uses. Those parts were skipped, so a part id always means the same geometry.',
    ]);
  });

  it("counts a run of collisions as one problem", () => {
    const base = source("base", [part({ id: "a" }), part({ id: "b" })]);
    const extra = source("aliens", [part({ id: "a" }), part({ id: "b" })]);

    expect(mergePacks([base, extra]).problems).toEqual([
      '"aliens" reuses 2 part ids an earlier pack already uses. Those parts were skipped, so a part id always means the same geometry.',
    ]);
  });

  it("merges categories by id, first label winning", () => {
    const base = source("base", [part({ id: "a", category: "grey" })], {
      categories: [{ id: "grey", label: "Grey" }],
    });
    const extra = source(
      "aliens",
      [
        part({ id: "x", category: "grey" }),
        part({ id: "y", category: "chitin" }),
      ],
      {
        categories: [
          { id: "grey", label: "Alien grey" },
          { id: "chitin", label: "Chitin" },
        ],
      },
    );

    expect(mergePacks([base, extra]).manifest.categories).toEqual([
      { id: "grey", label: "Grey" },
      { id: "chitin", label: "Chitin" },
    ]);
  });

  it("drops a category no surviving part is in", () => {
    const base = source("base", [part({ id: "a", category: "grey" })], {
      categories: [{ id: "grey", label: "Grey" }],
    });
    // Every part collides, so the pack's own category filters down to nothing.
    const extra = source("aliens", [part({ id: "a", category: "chitin" })], {
      categories: [{ id: "chitin", label: "Chitin" }],
    });

    expect(mergePacks([base, extra]).manifest.categories).toEqual([
      { id: "grey", label: "Grey" },
    ]);
  });

  it("keeps the base pack's atlas and texture, whatever joins it", () => {
    const base = source("base", []);
    const extra = source("aliens", []);

    const merged = mergePacks([base, extra]);

    // One texture for the whole library, which is what an s3o can name.
    expect(merged.manifest.textures.tex1).toBe("atlas.png");
    expect(merged.manifest.id).toBe("base");
  });
});

describe("projectPackProblems", () => {
  function library(packs: LegoPackManifest[]): LoadedPack["library"] {
    return { packs, dir: "/data/lego/packs", problems: [] };
  }

  function loaded(parts: LegoPartInfo[], packs: string[]): LoadedPack {
    const merged = mergePacks(
      packs.map((id) =>
        source(
          id,
          parts.filter((p) => p.packId === id),
        ),
      ),
    );
    return {
      ...merged,
      library: library(packs.map((id) => manifest(id, []))),
    };
  }

  function unit(partIds: (string | null)[], packId: string) {
    const project = newProject({
      id: "u",
      rootPieceId: "root",
      name: "unit",
      packId,
      packVersion: "1",
      now: "2026-01-01",
    });
    return {
      ...project,
      pieces: [
        ...project.pieces,
        ...partIds.map((partId, i) => ({
          id: `p${i}`,
          name: `p${i}`,
          parentId: "root",
          partId,
          position: [0, 0, 0] as [number, number, number],
          rotation: [0, 0, 0] as [number, number, number],
          scale: [1, 1, 1] as [number, number, number],
        })),
      ],
    };
  }

  const pack = loaded([part({ id: "a", packId: "base" })], ["base"]);

  it("says nothing when every part resolves and the pack is installed", () => {
    expect(projectPackProblems(unit(["a", null], "base"), pack)).toEqual([]);
  });

  it("names the pack a unit was built against when it is not installed", () => {
    expect(projectPackProblems(unit(["a"], "aliens"), pack)[0]).toMatch(
      /"aliens" pack, and that pack is not installed/,
    );
  });

  it("counts the pieces whose part no installed pack has", () => {
    const problems = projectPackProblems(
      unit(["a", "gone", "also"], "base"),
      pack,
    );
    expect(problems).toEqual([
      "2 pieces name parts no installed pack has, so they show no geometry.",
    ]);
  });

  it("reads as one piece when only one is missing", () => {
    expect(projectPackProblems(unit(["gone"], "base"), pack)).toEqual([
      "1 piece names a part no installed pack has, so it shows no geometry.",
    ]);
  });

  it("ignores empty pieces, which never had a part", () => {
    expect(projectPackProblems(unit([null, null], "base"), pack)).toEqual([]);
  });
});
