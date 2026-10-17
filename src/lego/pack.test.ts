import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { problemTexts } from "./problems";

// pack.ts reaches the `lego_packs` command through bindings.ts, and the
// published plugin-sdk dist uses extensionless relative imports that Vitest's
// node resolver will not load from node_modules. Only the pure merge and
// validation live here, so stubbing the leaf is enough to let the module load.
// Same stub src/lobby-servers/config.test.ts uses, for the same reason.
vi.mock("@picoframe/plugin-sdk", () => ({
  defineCommand: () => async () => ({}),
}));

import type { LegoAtlas } from "./atlas";
import { newProject } from "./model";
import {
  colourwayLabel,
  DEFAULT_PART_UNIT,
  extensionProblem,
  type LegoPackManifest,
  type LegoPartInfo,
  type LoadedPack,
  mergePacks,
  type PackSource,
  partUnit,
  projectPackProblems,
  type RawAtlasManifest,
  type RawPackManifest,
  readAtlasPack,
  readRoundPanels,
  readSwatches,
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

describe("readAtlasPack", () => {
  const base = manifest("base", []);
  const installed: LegoAtlas[] = [
    { tex1: "atlas.png", packId: "base", folder: null },
  ];

  function raw(overrides: Partial<RawAtlasManifest> = {}): RawAtlasManifest {
    return {
      schemaVersion: 1,
      id: "desert",
      version: "1",
      reskins: "base",
      atlas: { width: 2048, height: 2048 },
      textures: { tex1: "desert.png" },
      ...overrides,
    };
  }

  it("accepts a pack that reskins the base pack with its own texture", () => {
    expect(readAtlasPack(base, raw(), "desert", installed)).toEqual({
      atlas: { tex1: "desert.png", packId: "desert", folder: "desert" },
    });
  });

  it("rejects a pack that reskins something else", () => {
    expect(
      readAtlasPack(base, raw({ reskins: "other" }), "desert", installed),
    ).toEqual({ problem: expect.stringMatching(/reskins "other"/) });
  });

  it("rejects a pack that brings parts as well as an atlas", () => {
    // That would be a second parts library, and a unit cannot mix two.
    expect(
      readAtlasPack(base, raw({ parts: [] }), "desert", installed),
    ).toEqual({
      problem: expect.stringMatching(/brings parts as well as an atlas/),
    });
  });

  it("rejects a pack that ships geometry", () => {
    expect(
      readAtlasPack(
        base,
        raw({ geometry: { file: "parts.bin.gz" } }),
        "desert",
        installed,
      ),
    ).toEqual({
      problem: expect.stringMatching(/brings parts as well as an atlas/),
    });
  });

  it("rejects a pack that names no texture, since there is no atlas to use", () => {
    const { textures: _dropped, ...rest } = raw();
    expect(readAtlasPack(base, rest, "desert", installed)).toEqual({
      problem: expect.stringMatching(/names no texture/),
    });
  });

  it("rejects a texture file name another atlas already uses", () => {
    // Both would land on the same path in a game's unittextures folder.
    expect(
      readAtlasPack(
        base,
        raw({ textures: { tex1: "atlas.png" } }),
        "desert",
        installed,
      ),
    ).toEqual({
      problem: expect.stringMatching(/"base" already calls its own/),
    });
  });

  it("rejects a pack built for another schema", () => {
    expect(
      readAtlasPack(base, raw({ schemaVersion: 99 }), "desert", installed),
    ).toEqual({ problem: expect.stringMatching(/schema 99/) });
  });

  it("rejects a pack with no id", () => {
    expect(readAtlasPack(base, raw({ id: "" }), "desert", installed)).toEqual({
      problem: expect.stringMatching(/no pack id/),
    });
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
    return {
      packs,
      atlases: [{ tex1: "atlas.png", packId: packs[0].id, folder: null }],
      dir: "/data/lego/packs",
      problems: [],
    };
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
    expect(projectPackProblems(unit(["a"], "aliens"), pack)[0].message).toMatch(
      /"aliens" pack, and that pack is not installed/,
    );
  });

  it("counts the pieces whose part no installed pack has", () => {
    const problems = projectPackProblems(
      unit(["a", "gone", "also"], "base"),
      pack,
    );
    expect(problemTexts(problems)).toEqual([
      "2 pieces name parts no installed pack has, so they show no geometry.",
    ]);
  });

  it("names a piece whose shape kind this build cannot make (#3325)", () => {
    const base = unit([null, null], "base");
    const shaped = {
      ...base,
      pieces: base.pieces.map((piece) =>
        piece.id === "p0"
          ? {
              ...piece,
              shape: { kind: "torus", size: [1, 1, 1], swatch: "green" },
            }
          : piece.id === "p1"
            ? {
                ...piece,
                shape: {
                  kind: "cylinder",
                  size: [1, 1, 1],
                  swatch: "green",
                },
              }
            : piece,
      ),
    } as typeof base;
    const problems = projectPackProblems(shaped, pack);
    expect(problemTexts(problems)).toEqual([
      "1 piece is a shape this version of coilbox cannot make, so it shows no geometry.",
    ]);
    expect(problems[0].pieceIds).toEqual(["p0"]);
  });

  it("names the pieces whose part is missing", () => {
    const [missing] = projectPackProblems(
      unit(["a", "gone", "also"], "base"),
      pack,
    );
    expect(missing.source).toBe("pack");
    expect(missing.pieceIds).toHaveLength(2);
  });

  it("has no piece for a pack that is not installed", () => {
    expect(
      projectPackProblems(unit(["a"], "aliens"), pack)[0].pieceIds,
    ).toEqual([]);
  });

  it("reads as one piece when only one is missing", () => {
    expect(
      problemTexts(projectPackProblems(unit(["gone"], "base"), pack)),
    ).toEqual([
      "1 piece names a part no installed pack has, so it shows no geometry.",
    ]);
  });

  it("ignores empty pieces, which never had a part", () => {
    expect(projectPackProblems(unit([null, null], "base"), pack)).toEqual([]);
  });

  it("says a unit's atlas is missing, and what it is drawn with instead", () => {
    const project = { ...unit(["a"], "base"), atlas: "desert.png" };
    expect(projectPackProblems(project, pack)[0].message).toMatch(
      /"desert\.png", is not installed, so it is drawn with "atlas\.png"/,
    );
  });
});

describe("part connectors in a merged library", () => {
  const top = {
    id: "top",
    position: [0, 0.5, 0] as [number, number, number],
    facing: [0, 1, 0] as [number, number, number],
    up: [0, 0, 1] as [number, number, number],
  };

  it("keeps the connectors a part states", () => {
    const merged = mergePacks([
      source("base", [part({ id: "a", connectors: [top] })]),
    ]);
    expect(merged.parts[0].connectors).toEqual([top]);
    expect(merged.problems).toEqual([]);
  });

  it("leaves a part that states none without a list, so it derives them", () => {
    const merged = mergePacks([source("base", [part({ id: "a" })])]);
    expect(merged.parts[0].connectors).toBeUndefined();
  });

  it("drops an invalid list, reports it and names the part", () => {
    const bad = { ...top, facing: [0, 2, 0] as [number, number, number] };
    const merged = mergePacks([
      source("base", [part({ id: "a", name: "grey beam", connectors: [bad] })]),
    ]);
    expect(merged.parts[0].connectors).toBeUndefined();
    expect(merged.problems).toHaveLength(1);
    expect(merged.problems[0]).toMatch(/"base"/);
    expect(merged.problems[0]).toMatch(/grey beam/);
    expect(merged.problems[0]).toMatch(/facing/);
  });

  it("counts every part with an invalid list in one problem per pack", () => {
    const bad = { ...top, id: "" };
    const merged = mergePacks([
      source("base", [
        part({ id: "a", connectors: [bad] }),
        part({ id: "b", connectors: [bad] }),
      ]),
    ]);
    expect(merged.problems).toHaveLength(1);
    expect(merged.problems[0]).toMatch(/2 parts/);
  });

  it("applies the same rules to an extension pack's parts", () => {
    const merged = mergePacks([
      source("base", [part({ id: "a" })]),
      source("extra", [
        part({ id: "b", connectors: [top] }),
        part({ id: "c", connectors: [{ ...top, up: [0, 1, 0] }] }),
      ]),
    ]);
    expect(merged.byId.get("b")?.connectors).toEqual([top]);
    expect(merged.byId.get("c")?.connectors).toBeUndefined();
    expect(merged.problems).toHaveLength(1);
    expect(merged.problems[0]).toMatch(/"extra"/);
  });
});

describe("the part unit", () => {
  function loadedWith(unit: number | undefined, extra?: PackSource) {
    const base = source(
      "base",
      [part({ id: "a" })],
      unit === undefined ? {} : { unit },
    );
    const merged = mergePacks(extra ? [base, extra] : [base]);
    return merged;
  }

  it("is the unit the base pack states", () => {
    const merged = loadedWith(0.5);
    expect(partUnit(merged)).toBe(0.5);
    expect(merged.problems).toEqual([]);
  });

  it("is the default for a pack that states none", () => {
    expect(partUnit(loadedWith(undefined))).toBe(DEFAULT_PART_UNIT);
  });

  it("is 0.25, the step most of the bundled pack's parts sit on", () => {
    expect(DEFAULT_PART_UNIT).toBe(0.25);
  });

  for (const unit of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    it(`falls back to the default for a stated unit of ${unit} and says so`, () => {
      const merged = loadedWith(unit);
      expect(partUnit(merged)).toBe(DEFAULT_PART_UNIT);
      expect(merged.problems).toHaveLength(1);
      expect(merged.problems[0]).toMatch(/"base"/);
      expect(merged.problems[0]).toMatch(/unit/);
    });
  }

  it("is the base pack's when an extension pack states another", () => {
    const merged = loadedWith(
      0.5,
      source("extra", [part({ id: "b" })], { unit: 0.25 }),
    );
    expect(partUnit(merged)).toBe(0.5);
    expect(merged.problems).toHaveLength(1);
    expect(merged.problems[0]).toMatch(/"extra"/);
  });

  it("accepts an extension pack that states the base pack's unit", () => {
    const merged = loadedWith(
      0.5,
      source("extra", [part({ id: "b" })], { unit: 0.5 }),
    );
    expect(merged.problems).toEqual([]);
  });

  it("compares an extension pack's unit with the default when the base states none", () => {
    const merged = loadedWith(
      undefined,
      source("extra", [part({ id: "b" })], { unit: 0.5 }),
    );
    expect(partUnit(merged)).toBe(DEFAULT_PART_UNIT);
    expect(merged.problems).toHaveLength(1);
  });
});

describe("the bundled pack", () => {
  const bundled = JSON.parse(
    readFileSync(
      fileURLToPath(
        new URL("../../src-tauri/legoparts/pack.json", import.meta.url),
      ),
      "utf8",
    ),
  ) as LegoPackManifest;

  it("states the default unit and merges with no problems", () => {
    expect(bundled.unit).toBe(DEFAULT_PART_UNIT);
    const merged = mergePacks([
      {
        manifest: bundled,
        vertices: new Float32Array(),
        indices: new Uint16Array(),
      },
    ]);
    expect(merged.problems).toEqual([]);
    expect(partUnit(merged)).toBe(DEFAULT_PART_UNIT);
  });

  it("lists a swatch for each colourway, as #3326 measured them", () => {
    expect(bundled.swatches).toEqual([
      {
        id: "green",
        uv: { min: [0.168, 0.9492], max: [0.1992, 0.9805] },
        tile: 1.56,
      },
      {
        id: "tan",
        uv: { min: [0.5796, 0.9492], max: [0.6108, 0.9805] },
        tile: 1.56,
      },
      {
        id: "grey",
        uv: { min: [0.9639, 0.2813], max: [0.9951, 0.3125] },
        tile: 1.56,
      },
    ]);
    const colourways = new Set(bundled.parts.map((p) => p.colourway));
    for (const swatch of bundled.swatches ?? []) {
      expect(colourways.has(swatch.id)).toBe(true);
    }
  });

  // The first atlas column is KaiserJ's red team colour set, not green. Its id
  // stays "green" because a saved unit names a shape's swatch by it (#4466).
  it("names the red column team colour wherever a person reads it (#4466)", () => {
    expect(bundled.categories).toContainEqual({
      id: "green",
      label: "Team colour",
    });
    const red = bundled.parts.filter((p) => p.colourway === "green");
    expect(red.length).toBeGreaterThan(0);
    for (const p of red) expect(p.name).toMatch(/^team colour /);
    for (const p of bundled.parts) expect(p.name).not.toMatch(/green/);
  });
});

describe("colourwayLabel", () => {
  const pack = {
    manifest: manifest("base", [], {
      categories: [
        { id: "green", label: "Team colour" },
        { id: "tan", label: "Tan" },
      ],
    }),
  };

  it("reads a colourway by its category's label (#4466)", () => {
    expect(colourwayLabel(pack, "green")).toBe("Team colour");
    expect(colourwayLabel(pack, "tan")).toBe("Tan");
  });

  it("falls back to the id for a colourway no category names", () => {
    expect(colourwayLabel(pack, "chitin")).toBe("chitin");
  });
});

describe("round panels (#4398)", () => {
  const panel = { id: "grey", centre: [0.5, 0.25], radius: 0.03 };

  it("lists a wheel for each colourway in the bundled pack", () => {
    const pack = JSON.parse(
      readFileSync(
        fileURLToPath(
          new URL("../../src-tauri/legoparts/pack.json", import.meta.url),
        ),
        "utf8",
      ),
    ) as LegoPackManifest;
    expect(readRoundPanels(pack.roundPanels)).toEqual({
      usable: pack.roundPanels,
      problem: null,
    });
    expect(pack.roundPanels?.map((p) => p.id)).toEqual(
      pack.swatches?.map((s) => s.id),
    );
  });

  it("keeps the base pack's and ignores an extension pack's", () => {
    const merged = mergePacks([
      source("base", [part({ id: "a" })], {
        roundPanels: [panel] as LegoPackManifest["roundPanels"],
      }),
      source("extra", [part({ id: "b" })], {
        extends: "base",
        roundPanels: [
          { ...panel, id: "pink" },
        ] as LegoPackManifest["roundPanels"],
      }),
    ]);
    expect(merged.manifest.roundPanels).toEqual([panel]);
    expect(merged.problems).toEqual([]);
  });

  it("leaves a pack that lists none without any", () => {
    const merged = mergePacks([source("base", [part({ id: "a" })])]);
    expect(merged.manifest.roundPanels).toBeUndefined();
    expect(readRoundPanels(undefined)).toEqual({ usable: [], problem: null });
  });

  it("drops a panel it cannot use and says how many", () => {
    const read = readRoundPanels([
      panel,
      { ...panel },
      { ...panel, id: "a", radius: 0 },
      { ...panel, id: "b", centre: [0.99, 0.5] },
      { ...panel, id: "c", centre: [0.5] },
      { ...panel, id: "d", radius: "big" },
      { ...panel, id: "" },
      null,
    ]);
    expect(read.usable).toEqual([panel]);
    expect(read.problem).toBe(
      "states 7 round panels that cannot be used, so shapes cannot show them.",
    );
  });

  it("refuses round panels that are not a list", () => {
    expect(readRoundPanels({ grey: panel })).toEqual({
      usable: [],
      problem:
        'states "roundPanels" that are not a list, so shapes cannot show them.',
    });
  });

  it("reports a base pack's broken panel when the packs merge", () => {
    const merged = mergePacks([
      source("base", [part({ id: "a" })], {
        roundPanels: [
          { ...panel, radius: -1 },
        ] as LegoPackManifest["roundPanels"],
      }),
    ]);
    expect(merged.manifest.roundPanels).toEqual([]);
    expect(merged.problems).toEqual([
      '"base" states 1 round panel that cannot be used, so shapes cannot show it.',
    ]);
  });
});

describe("swatches", () => {
  const swatch = {
    id: "grey",
    uv: { min: [0.1, 0.2], max: [0.2, 0.3] },
    tile: 1.5,
  };

  it("keeps the base pack's and ignores an extension pack's", () => {
    const merged = mergePacks([
      source("base", [part({ id: "a" })], {
        swatches: [swatch] as LegoPackManifest["swatches"],
      }),
      source("extra", [part({ id: "b" })], {
        extends: "base",
        swatches: [{ ...swatch, id: "pink" }] as LegoPackManifest["swatches"],
      }),
    ]);
    expect(merged.manifest.swatches).toEqual([swatch]);
    expect(merged.problems).toEqual([]);
  });

  it("leaves a pack that lists none without any", () => {
    const merged = mergePacks([source("base", [part({ id: "a" })])]);
    expect(merged.manifest.swatches).toBeUndefined();
    expect(readSwatches(undefined)).toEqual({ usable: [], problem: null });
  });

  it("drops a swatch it cannot use and says how many", () => {
    const read = readSwatches([
      swatch,
      { ...swatch },
      { ...swatch, id: "a", tile: 0 },
      { ...swatch, id: "b", uv: { min: [0.3, 0.2], max: [0.2, 0.3] } },
      { ...swatch, id: "c", uv: { min: [0.1, 0.2], max: [1.2, 0.3] } },
      { ...swatch, id: "" },
      null,
    ]);
    expect(read.usable).toEqual([swatch]);
    expect(read.problem).toBe(
      "states 6 swatches that cannot be used, so shapes cannot take them.",
    );
  });

  it("refuses swatches that are not a list", () => {
    expect(readSwatches({ grey: swatch }).usable).toEqual([]);
  });

  it("reports a base pack's broken swatch when the packs merge", () => {
    const merged = mergePacks([
      source("base", [part({ id: "a" })], {
        swatches: [{ ...swatch, tile: -1 }] as LegoPackManifest["swatches"],
      }),
    ]);
    expect(merged.manifest.swatches).toEqual([]);
    expect(merged.problems).toEqual([
      '"base" states 1 swatch that cannot be used, so shapes cannot take it.',
    ]);
  });
});
