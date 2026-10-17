import { createHash } from "node:crypto";
import type * as THREE from "three";
import { describe, expect, it } from "vitest";

import { buildGlbScene } from "./exportGlb";
import { buildObj } from "./exportObj";
import { bundledSwatches } from "./fixtures/bundledSwatches";
import { type LegoPiece, type LegoProject, newProject } from "./model";
import type { LegoPartInfo, LoadedPack } from "./pack";
import type { RawGeometry } from "./rawGeometry";
import { bakedPieces, buildS3o, type S3oPiece } from "./s3oBuild";
import { setShapeSwatches } from "./shapes";
import {
  cropUv,
  planSheet,
  SHEET_GUTTER,
  SHEET_MAX_SIDE,
  type SheetPlan,
  sheetBounds,
  sheetSources,
  sheetTextureNames,
  sheetUvMap,
} from "./textureSheet";

/** One part: a triangle whose UVs cover the whole atlas, v up from the bottom. */
function pack(): LoadedPack {
  const part: LegoPartInfo = {
    id: "tri",
    packId: "lego",
    shapeId: "tri",
    name: "tri",
    category: "grey",
    colourway: "grey",
    shape: "tri",
    material: "metal",
    tags: [],
    vFirst: 0,
    vCount: 3,
    iFirst: 0,
    iCount: 3,
    bbox: { min: [0, 0, 0], max: [1, 0, 1] },
    uvBox: { min: [0, 0], max: [1, 1] },
    pivot: [0, 0, 0],
    sourceNames: [],
    aliasCount: 0,
  };
  // x, y, z, nx, ny, nz, u, v
  const vertices = new Float32Array([
    0, 0, 0, 0, 1, 0, 0.25, 0.25, 1, 0, 0, 0, 1, 0, 0.5, 0.25, 0, 0, 1, 0, 1, 0,
    0.25, 0.5,
  ]);
  return {
    manifest: {} as LoadedPack["manifest"],
    library: {
      packs: [],
      atlases: [{ tex1: "atlas.png", packId: "lego", folder: null }],
      dir: "",
      problems: [],
    },
    parts: [part],
    byId: new Map([["tri", part]]),
    vertices,
    indices: new Uint16Array([0, 1, 2]),
  };
}

/** Two lifted meshes, each a triangle with its own UVs. */
function raw(): RawGeometry {
  return {
    byId: new Map([
      [
        "mod/m0",
        {
          id: "mod/m0",
          vFirst: 0,
          vCount: 3,
          iFirst: 0,
          iCount: 3,
          bbox: { min: [0, 0, 0], max: [0, 2, 2] },
        },
      ],
      [
        "mod/m1",
        {
          id: "mod/m1",
          vFirst: 3,
          vCount: 3,
          iFirst: 3,
          iCount: 3,
          bbox: { min: [0, 0, 0], max: [0, 2, 2] },
        },
      ],
    ]),
    // x, y, z, nx, ny, nz, u, v
    vertices: new Float32Array([
      0, 0, 0, 1, 0, 0, 0, 0, 0, 2, 0, 1, 0, 0, 0.5, 0, 0, 0, 2, 1, 0, 0, 0.5,
      0.5, 0, 0, 0, 1, 0, 0, 0.75, 0.75, 0, 2, 0, 1, 0, 0, 1, 0.75, 0, 0, 2, 1,
      0, 0, 1, 1,
    ]),
    indices: new Uint32Array([0, 1, 2, 0, 1, 2]),
  };
}

const sf = { name: "Splinter Faction", archive: "sf.sdz" };

function lifted(texture: string, texture2?: string): LegoPiece["lifted"] {
  return {
    game: sf,
    member: "objects3d/armcom.s3o",
    unit: "armcom",
    texture: { key: texture, name: `name-of-${texture}` },
    ...(texture2 ? { texture2: { key: texture2, name: "tex2.dds" } } : {}),
  };
}

function project(pieces: Partial<LegoPiece>[]): LegoProject {
  const base = newProject({
    id: "p",
    rootPieceId: "root",
    name: "probe",
    unitName: "probe",
    packId: "lego",
    packVersion: "1",
    now: "2026-07-28T00:00:00Z",
  });
  return {
    ...base,
    pieces: [
      ...base.pieces,
      ...pieces.map((piece, i) => ({
        id: `piece${i}`,
        name: `piece${i}`,
        parentId: "root",
        partId: "tri",
        position: [0, 0, 0] as [number, number, number],
        rotation: [0, 0, 0] as [number, number, number],
        scale: [1, 1, 1] as [number, number, number],
        ...piece,
      })),
    ],
  };
}

/** A unit of parts with a turret lifted from a game on it. */
function mixed(texture2?: string): LegoProject {
  return project([
    {},
    {
      id: "turret",
      name: "turret",
      partId: null,
      meshId: "mod/m0",
      lifted: lifted("aaaa.dds", texture2),
    },
  ]);
}

function sha(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

describe("a unit with no lifted pieces", () => {
  const parts = project([
    {},
    { position: [3, 0, 1], rotation: [0, 0.5, 0], scale: [2, 1, 1] },
  ]);

  it("gets no sheet", () => {
    expect(sheetSources(parts, pack(), null)).toBeNull();
    expect(sheetSources(parts, pack(), raw())).toBeNull();
  });

  it("builds exactly the model and the .obj it built before the sheet existed", () => {
    // Pinned on main before #3260 touched the builder, so any change to the
    // bake of a unit with no lifted pieces fails here.
    const model = buildS3o(parts, pack(), null, { texture1: "coilbox_a.png" });
    expect(sha(model)).toBe(
      "0aaf9248c32f3706d0b1ac6e740c900cb8993c99a5dbdc6ecd1f52f8bf496f78",
    );
    const obj = buildObj(parts, pack(), null, {
      unitName: "probe",
      textureName: "coilbox_a.png",
    });
    expect(sha(obj)).toBe(
      "153f4053a9a7189537b4ee905da3512bbc744a1231405886e4dceb5d11274e92",
    );
  });

  it("leaves a unit opened whole from a model alone", () => {
    const opened = {
      ...mixed(),
      imported: { source: "/x.s3o" },
    } as LegoProject;
    expect(sheetSources(opened, pack(), raw())).toBeNull();
  });
});

describe("sheetSources", () => {
  it("puts the parts on the atlas and the lifted piece on its game's texture", () => {
    const found = sheetSources(mixed(), pack(), raw());
    expect(found).toEqual({
      sources: [
        {
          id: "atlas",
          label: "atlas.png, the parts atlas",
          part: true,
          colour: {
            atlas: {
              name: "atlas.png",
              pack: null,
              writeAs: "coilbox_atlas.png",
            },
            flipY: false,
          },
          shading: null,
          pieceIds: ["piece0"],
        },
        {
          id: "aaaa.dds\n",
          label: "name-of-aaaa.dds (From Splinter Faction, unit armcom)",
          part: false,
          colour: { key: "aaaa.dds", flipY: true },
          shading: null,
          pieceIds: ["turret"],
        },
      ],
    });
  });

  it("puts a generated shape on the atlas with the parts (#3325)", () => {
    const doc = mixed();
    const shaped = project([
      {},
      {
        id: "wheel",
        partId: null,
        shape: { kind: "cylinder", size: [1, 1, 1], swatch: "grey" },
      },
      doc.pieces[2],
    ]);
    const found = sheetSources(shaped, pack(), raw());
    if (!found || "refused" in found) throw new Error("no sources");
    expect(found.sources[0].pieceIds).toEqual(["piece0", "wheel"]);
  });

  it("reads the second texture of a lifted piece, turned by its own format", () => {
    const found = sheetSources(mixed("bbbb.png"), pack(), raw());
    if (!found || "refused" in found) throw new Error("no sources");
    expect(found.sources[1].shading).toEqual({ key: "bbbb.png", flipY: false });
  });

  it("gives two pieces painted with the same texture one place on the sheet", () => {
    const doc = project([
      { partId: null, meshId: "mod/m0", lifted: lifted("aaaa.dds") },
      { partId: null, meshId: "mod/m1", lifted: lifted("aaaa.dds") },
      { partId: null, meshId: "mod/m1", lifted: lifted("cccc.png") },
    ]);
    const found = sheetSources(doc, pack(), raw());
    if (!found || "refused" in found) throw new Error("no sources");
    // No part in the unit has geometry, so the atlas is not on the sheet.
    expect(found.sources.map((s) => [s.id, s.pieceIds])).toEqual([
      ["aaaa.dds\n", ["piece0", "piece1"]],
      ["cccc.png\n", ["piece2"]],
    ]);
  });

  it("refuses a lifted piece that has no texture to put on the sheet", () => {
    const doc = project([
      {
        name: "dish",
        partId: null,
        meshId: "mod/m0",
        lifted: { game: sf, member: "objects3d/armcom.s3o" },
      },
    ]);
    const found = sheetSources(doc, pack(), raw());
    expect(found && "refused" in found && found.refused).toMatch(/dish/);
  });

  it("names the sheet after the unit", () => {
    expect(sheetTextureNames("probe")).toEqual({
      texture1: "coilbox_probe_sheet.png",
      texture2: "coilbox_probe_sheet2.png",
    });
  });
});

describe("sheetBounds", () => {
  it("measures a part in the engine's UVs and a lifted mesh in its own", () => {
    const doc = mixed();
    const found = sheetSources(doc, pack(), raw());
    if (!found || "refused" in found) throw new Error("no sources");
    const { pieces } = bakedPieces(doc, pack(), raw());
    // The part's v counts up from the bottom in the pack, and the engine reads
    // the atlas top row first, so 0.25 and 0.5 become 0.75 and 0.5.
    expect(sheetBounds(found.sources[0], pieces)).toEqual([
      0.25, 0.5, 0.5, 0.75,
    ]);
    expect(sheetBounds(found.sources[1], pieces)).toEqual([0, 0, 0.5, 0.5]);
  });

  it("takes in a shape's swatch and nothing past it (#3327)", () => {
    const swatches = bundledSwatches();
    setShapeSwatches(swatches);
    const doc = mixed();
    const shaped = project([
      {
        id: "wheel",
        partId: null,
        shape: { kind: "tube", size: [3, 7, 3], swatch: "grey" },
      },
      doc.pieces[2],
    ]);
    const found = sheetSources(shaped, pack(), raw());
    if (!found || "refused" in found) throw new Error("no sources");
    const { pieces } = bakedPieces(shaped, pack(), raw());
    const [u0, v0, u1, v1] = sheetBounds(found.sources[0], pieces);
    const grey = swatches[2].uv;
    // The engine's v runs down from the top.
    const slack = 1e-6;
    expect(u0).toBeGreaterThanOrEqual(grey.min[0] - slack);
    expect(u1).toBeLessThanOrEqual(grey.max[0] + slack);
    expect(v0).toBeGreaterThanOrEqual(1 - grey.max[1] - slack);
    expect(v1).toBeLessThanOrEqual(1 - grey.min[1] + slack);
    expect(u1 - u0).toBeGreaterThan(0);
    setShapeSwatches([]);
  });
});

/** Whether two rectangles given as [x, y, width, height] overlap. */
function overlaps(a: number[], b: number[]): boolean {
  return (
    a[0] < b[0] + b[2] &&
    b[0] < a[0] + a[2] &&
    a[1] < b[1] + b[3] &&
    b[1] < a[1] + a[3]
  );
}

function checkPlan(plan: SheetPlan) {
  expect(Math.max(plan.width, plan.height)).toBeLessThanOrEqual(SHEET_MAX_SIDE);
  plan.regions.forEach((region, i) => {
    const [x, y, w, h] = region.dest;
    expect(x % SHEET_GUTTER).toBe(0);
    expect(y % SHEET_GUTTER).toBe(0);
    expect(x + w).toBeLessThanOrEqual(plan.width);
    expect(y + h).toBeLessThanOrEqual(plan.height);
    // Every sheet pixel is a whole block of source texels.
    expect(region.crop[2]).toBe(w * plan.factor);
    expect(region.crop[3]).toBe(h * plan.factor);
    for (const other of plan.regions.slice(i + 1)) {
      expect(overlaps(region.dest, other.dest)).toBe(false);
    }
  });
}

describe("planSheet", () => {
  it("crops each texture to what its pieces use, with a gutter of real pixels", () => {
    const plan = planSheet([
      { bounds: [0.25, 0.5, 0.5, 0.75], width: 2048, height: 2048 },
      { bounds: [0, 0, 0.5, 0.5], width: 1024, height: 1024 },
    ]);
    expect(plan.factor).toBe(1);
    expect(plan.regions[0].crop).toEqual([504, 1016, 528, 528]);
    // Past the left and top edges, which the engine repeats, so the gutter is
    // the far side of the texture.
    expect(plan.regions[1].crop).toEqual([-8, -8, 528, 528]);
    checkPlan(plan);
  });

  it("halves everything until the sheet fits the largest side", () => {
    const plan = planSheet([
      { bounds: [0, 0, 1, 1], width: 4096, height: 4096 },
      { bounds: [0, 0, 1, 1], width: 4096, height: 4096 },
    ]);
    expect(plan.factor).toBeGreaterThan(1);
    expect(Math.log2(plan.factor) % 1).toBe(0);
    checkPlan(plan);
  });

  it("keeps a texture whole when its pieces repeat it", () => {
    const plan = planSheet([{ bounds: [-1, 0, 1, 1], width: 64, height: 64 }]);
    expect(plan.regions[0].crop).toEqual([-72, -8, 144, 80]);
    checkPlan(plan);
  });

  it("packs many small regions without overlap", () => {
    const plan = planSheet(
      Array.from({ length: 9 }, (_, i) => ({
        bounds: [0, 0, 1, 1] as [number, number, number, number],
        width: 64 * (i + 1),
        height: 32 * (9 - i),
      })),
    );
    expect(plan.factor).toBe(1);
    checkPlan(plan);
  });
});

describe("cropUv", () => {
  it("says the crop in the source's own UVs", () => {
    const plan = planSheet([
      { bounds: [0, 0, 0.5, 0.5], width: 1024, height: 512 },
    ]);
    expect(cropUv(plan.regions[0], { width: 1024, height: 512 })).toEqual([
      -8 / 1024,
      -8 / 512,
      520 / 1024,
      264 / 512,
    ]);
  });
});

describe("a mixed unit on its sheet", () => {
  function onSheet() {
    const doc = mixed();
    const found = sheetSources(doc, pack(), raw());
    if (!found || "refused" in found) throw new Error("no sources");
    const sizes = [
      { width: 2048, height: 2048 },
      { width: 1024, height: 1024 },
    ];
    const { pieces } = bakedPieces(doc, pack(), raw());
    const plan = planSheet(
      found.sources.map((source, i) => ({
        bounds: sheetBounds(source, pieces),
        ...sizes[i],
      })),
    );
    return { doc, plan, uv: sheetUvMap(found.sources, sizes, plan) };
  }

  it("moves each UV onto the texel its source put on the sheet", () => {
    const { plan, uv } = onSheet();
    const [atlas, turret] = plan.regions;
    // The part's (0.25, 0.25) is the atlas's (512, 1536) in the engine's
    // texels, which the sheet holds at the crop's offset into its region.
    expect(uv("piece0", [0.25, 0.25])).toEqual([
      (atlas.dest[0] + 512 - atlas.crop[0]) / plan.width,
      (atlas.dest[1] + 1536 - atlas.crop[1]) / plan.height,
    ]);
    expect(uv("turret", [0.5, 0.5])).toEqual([
      (turret.dest[0] + 512 - turret.crop[0]) / plan.width,
      (turret.dest[1] + 512 - turret.crop[1]) / plan.height,
    ]);
  });

  it("writes the remapped UVs into the model and nothing else changes", () => {
    const { doc, plan, uv } = onSheet();
    const names = sheetTextureNames("probe");
    const plain = buildS3o(doc, pack(), raw(), names);
    const sheeted = buildS3o(doc, pack(), raw(), names, { sheet: uv });
    if (!plain || !sheeted) throw new Error("no model");
    const strip = (piece: S3oPiece): unknown => ({
      ...piece,
      vertices: piece.vertices.map((v) => ({ ...v, uv: null })),
      children: piece.children.map(strip),
    });
    expect(strip(sheeted.root)).toEqual(strip(plain.root));
    const turret = sheeted.root.children.find((p) => p.name === "turret");
    const [x, y, w, h] = plan.regions[1].dest;
    for (const vertex of turret?.vertices ?? []) {
      expect(vertex.uv[0] * plan.width).toBeGreaterThanOrEqual(x);
      expect(vertex.uv[0] * plan.width).toBeLessThanOrEqual(x + w);
      expect(vertex.uv[1] * plan.height).toBeGreaterThanOrEqual(y);
      expect(vertex.uv[1] * plan.height).toBeLessThanOrEqual(y + h);
    }
  });

  it("puts the same UVs in the .obj, counted from the bottom", () => {
    const { doc, uv } = onSheet();
    const obj = buildObj(doc, pack(), raw(), {
      unitName: "probe",
      textureName: "coilbox_probe_sheet.png",
      sheet: uv,
    });
    const [u, v] = uv("turret", [0.5, 0.5]);
    expect(obj?.obj).toContain(`vt ${u.toFixed(6)} ${(1 - v).toFixed(6)}`);
  });

  it("puts the same UVs in the .glb, which counts v from the top", () => {
    const { doc, uv } = onSheet();
    const scene = buildGlbScene(doc, pack(), raw(), uv);
    const mesh = scene?.getObjectByName("turret") as THREE.Mesh | undefined;
    const uvs = mesh?.geometry.getAttribute("uv");
    const [u, v] = uv("turret", [0.5, 0.5]);
    expect(uvs?.getX(2)).toBeCloseTo(u, 6);
    expect(uvs?.getY(2)).toBeCloseTo(v, 6);
  });
});
