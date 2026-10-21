/**
 * One texture sheet for a unit that mixes parts and pieces lifted from a game
 * (#3260).
 *
 * An `.s3o` names two textures for the whole model. A unit of parts samples the
 * pack's atlas, and a lifted piece's UVs point onto its game's own pair, so a
 * unit holding both has no one texture to name. On export the pictures its
 * pieces draw from are put side by side on one sheet, and every UV is moved to
 * where its texel landed. The same happens to the second texture, so both
 * sheets share one layout and one set of UVs.
 *
 * This file is the layout and the UV arithmetic, pure so it can be tested. The
 * pixels are copied in Rust (`lego_texture_sheet`), because the game's
 * textures are mostly `.dds` and the webview decodes none of them.
 *
 * The layout:
 *
 * - Each source is cropped to the box its pieces' UVs cover, in the engine's
 *   UVs, plus a gutter of real pixels on every side. The engine repeats a
 *   texture past 0 and 1 (`GL_REPEAT`, the default in
 *   `TextureCreationParams.hpp`), so a crop reaching past an edge takes the far
 *   side, the same pixels the piece sampled before.
 * - The gutter is what stops a filter blending in the neighbouring region. The
 *   engine mipmaps model textures (`CreateMipMapTexture`), and each mip level
 *   doubles how far a texel reaches. Regions sit on multiples of the gutter, so
 *   down to the level where a texel is a gutter wide no block straddles two
 *   sources.
 * - Sources keep their own resolution. A sheet that would be wider or taller
 *   than {@link SHEET_MAX_SIDE} has every region halved until it fits, so the
 *   pieces keep their texel density relative to each other.
 * - Regions are packed in shelves, tallest first.
 *
 * The first texture's alpha is the team colour mask, and each region keeps its
 * source's own: the atlas by the rule an export already writes it with (no
 * alpha channel is no team colour), and a lifted texture as the game ships it.
 * The second texture's alpha is the visibility mask. A source with no second
 * texture, which is every part, gets what the engine stands in for a missing
 * one: no glow, no shine, fully visible.
 */

import { t } from "@lingui/core/macro";
import { vZeroAtTop } from "@/lib/springTexture";
import { exportTextureName, unitAtlas } from "./atlas";
import { liftCredit } from "./liftPiece";
import type { LegoProject } from "./model";
import type { LoadedPack } from "./pack";
import { pieceMesh, type RawGeometry } from "./rawGeometry";
import { type BakedPiece, engineUv } from "./s3oBuild";
import { isKnownShapeKind } from "./shapes";

/**
 * Texels of real neighbouring pixels kept around every region, and what region
 * corners are aligned to. Eight keeps the regions apart down to mip level 3,
 * where one texel covers eight of the full size picture. This is a choice of
 * how many mip levels to protect, not a measured number.
 */
export const SHEET_GUTTER = 8;

/**
 * The widest or tallest a sheet is made.
 *
 * The engine takes whatever size the GPU allows for a model texture, and caps
 * its own atlas of unit textures at 4096 (`3DOTextureHandler.cpp` line 53,
 * with a note that some Intel GPUs allow only 2048). The sheet is an
 * uncompressed PNG, so 4096 square is 64 MiB on the GPU for each of the two.
 */
export const SHEET_MAX_SIDE = 4096;

/** A parts atlas, as the Rust side reads one. */
export interface SheetAtlasRef {
  name: string;
  pack: string | null;
  writeAs: string;
}

/**
 * One picture a sheet copies from: a parts atlas or a texture in the store.
 *
 * `flipY` is true when the engine reads v as counting up from the bottom row,
 * which it does for a `.dds` (see `vZeroAtTop`).
 */
export type SheetImage =
  | { atlas: SheetAtlasRef; flipY: boolean }
  | { key: string; flipY: boolean };

/** One picture the unit's pieces draw from, and which pieces they are. */
export interface SheetSource {
  /** `atlas` for the parts, or the two store keys of a lifted texture pair. */
  id: string;
  /** What the export drawer calls it. */
  label: string;
  /** Whether its pieces are parts, whose UVs are turned to the engine's. */
  part: boolean;
  colour: SheetImage;
  /** The second texture, or null for one the engine would stand in for. */
  shading: SheetImage | null;
  pieceIds: string[];
}

/** UVs as [u0, v0, u1, v1]. */
export type UvBox = [number, number, number, number];

/** A rectangle as [x, y, width, height]. */
export type Rect = [number, number, number, number];

/** Where one source went. */
export interface SheetRegion {
  /** The texels copied, in the source's engine texels (v counted the way the
   *  engine reads it). May reach past the edges, where the source repeats. */
  crop: Rect;
  /** Where they went on the sheet, in pixels. */
  dest: Rect;
}

export interface SheetPlan {
  width: number;
  height: number;
  /** How many source texels across one sheet pixel is: 1, 2, 4 and on. */
  factor: number;
  /** One per source, in the order the sources were given. */
  regions: SheetRegion[];
}

/** Moves a baked piece's UV onto the sheet, in the engine's convention. */
export type SheetUv = (
  pieceId: string,
  uv: [number, number],
) => [number, number];

/** What the two sheets are called in `unittextures`, and so in the model. */
export function sheetTextureNames(unitName: string): {
  texture1: string;
  texture2: string;
} {
  return {
    texture1: exportTextureName(`${unitName}_sheet.png`),
    texture2: exportTextureName(`${unitName}_sheet2.png`),
  };
}

/**
 * The pictures a unit's pieces draw from, or null for a unit that needs no
 * sheet: one opened whole from a model, and one with no lifted mesh in it.
 * Those export exactly as they did before sheets existed.
 *
 * A piece draws a lifted mesh when the unit's geometry holds it, and a shape or
 * a part otherwise, the same test the bake makes. A piece with no geometry is on no
 * source.
 */
export function sheetSources(
  project: LegoProject,
  pack: LoadedPack,
  raw: RawGeometry | null,
): { sources: SheetSource[] } | { refused: string } | null {
  if (project.imported) return null;
  if (!project.pieces.some((piece) => pieceMesh(raw, piece) !== null)) {
    return null;
  }

  const sources = new Map<string, SheetSource>();
  for (const piece of project.pieces) {
    if (pieceMesh(raw, piece) !== null) {
      const texture = piece.lifted?.texture;
      if (!piece.lifted || !texture) {
        const pieceName = piece.name;
        return {
          refused: t`${pieceName} has no texture recorded from the model it came from, so it cannot go on this unit's texture sheet.`,
        };
      }
      const texture2 = piece.lifted.texture2;
      const id = `${texture.key}\n${texture2?.key ?? ""}`;
      const found = sources.get(id);
      if (found) {
        found.pieceIds.push(piece.id);
        continue;
      }
      sources.set(id, {
        id,
        label: `${texture.name} (${liftCredit(piece.lifted)})`,
        part: false,
        colour: { key: texture.key, flipY: !vZeroAtTop(texture.key) },
        shading: texture2
          ? { key: texture2.key, flipY: !vZeroAtTop(texture2.key) }
          : null,
        pieceIds: [piece.id],
      });
      continue;
    }
    // A generated shape samples the atlas, as a part does.
    const onAtlas = piece.shape
      ? isKnownShapeKind(piece.shape.kind)
      : piece.partId !== null && pack.byId.has(piece.partId);
    if (!onAtlas) continue;
    const found = sources.get("atlas");
    if (found) {
      found.pieceIds.push(piece.id);
      continue;
    }
    // What the builder draws the parts with, which is the base atlas when the
    // unit's own is not installed. The sheet holds those pixels.
    const atlas = unitAtlas(project, pack.library.atlases).drawWith;
    const atlasName = atlas.tex1;
    sources.set("atlas", {
      id: "atlas",
      label: t`${atlasName}, the parts atlas`,
      part: true,
      colour: {
        atlas: {
          name: atlas.tex1,
          pack: atlas.folder ?? null,
          writeAs: exportTextureName(atlas.tex1),
        },
        flipY: false,
      },
      shading: null,
      pieceIds: [piece.id],
    });
  }
  // The atlas first, so a unit's layout does not move about as pieces are
  // added in a different order.
  const ordered = [...sources.values()].sort(
    (a, b) => Number(b.part) - Number(a.part),
  );
  return { sources: ordered };
}

/** A baked UV as the engine samples it, which is turned for a part. */
function engineSide(source: SheetSource, uv: [number, number]) {
  return source.part ? engineUv(uv) : uv;
}

/** The box a source's pieces' UVs cover, in the engine's UVs. */
export function sheetBounds(
  source: SheetSource,
  pieces: Map<string, BakedPiece>,
): UvBox {
  const box: UvBox = [Infinity, Infinity, -Infinity, -Infinity];
  for (const id of source.pieceIds) {
    for (const vertex of pieces.get(id)?.vertices ?? []) {
      const [u, v] = engineSide(source, vertex.uv);
      box[0] = Math.min(box[0], u);
      box[1] = Math.min(box[1], v);
      box[2] = Math.max(box[2], u);
      box[3] = Math.max(box[3], v);
    }
  }
  return Number.isFinite(box[0]) ? box : [0, 0, 0, 0];
}

const aligned = (n: number) => Math.ceil(n / SHEET_GUTTER) * SHEET_GUTTER;

/**
 * Shelf packing, tallest first. Answers where each rectangle goes and the
 * sheet's size, with every corner on a multiple of the gutter.
 */
function pack(sizes: { w: number; h: number }[]): {
  at: [number, number][];
  width: number;
  height: number;
} {
  const order = sizes
    .map((size, i) => ({ i, w: aligned(size.w), h: aligned(size.h) }))
    .sort((a, b) => b.h - a.h || b.w - a.w);
  const area = order.reduce((sum, item) => sum + item.w * item.h, 0);
  const rowWidth = Math.max(
    ...order.map((item) => item.w),
    aligned(Math.sqrt(area)),
  );
  const at: [number, number][] = sizes.map(() => [0, 0]);
  let x = 0;
  let y = 0;
  let shelf = 0;
  let width = 0;
  for (const item of order) {
    if (x > 0 && x + item.w > rowWidth) {
      y += shelf;
      x = 0;
      shelf = 0;
    }
    at[item.i] = [x, y];
    x += item.w;
    shelf = Math.max(shelf, item.h);
    width = Math.max(width, x);
  }
  return { at, width, height: y + shelf };
}

/**
 * Lay the sources out on one sheet. `bounds` is each source's UV box in the
 * engine's UVs and `width` and `height` its own size in texels.
 */
export function planSheet(
  inputs: { bounds: UvBox; width: number; height: number }[],
): SheetPlan {
  const crops = inputs.map(({ bounds, width, height }): Rect => {
    const x0 = Math.floor(bounds[0] * width) - SHEET_GUTTER;
    const y0 = Math.floor(bounds[1] * height) - SHEET_GUTTER;
    const x1 = Math.ceil(bounds[2] * width) + SHEET_GUTTER;
    const y1 = Math.ceil(bounds[3] * height) + SHEET_GUTTER;
    return [x0, y0, x1 - x0, y1 - y0];
  });

  let factor = 1;
  for (;;) {
    const sizes = crops.map(([, , w, h]) => ({
      w: Math.ceil(w / factor),
      h: Math.ceil(h / factor),
    }));
    const packed = pack(sizes);
    // A region one pixel across cannot halve any further, so that is where the
    // halving stops whether or not it fits.
    const smallest = sizes.every(({ w, h }) => w <= 1 && h <= 1);
    if (Math.max(packed.width, packed.height) <= SHEET_MAX_SIDE || smallest) {
      return {
        width: packed.width,
        height: packed.height,
        factor,
        regions: crops.map(([x, y], i) => ({
          // Widened to a whole number of sheet pixels, which only takes in
          // more of the gutter's neighbours.
          crop: [x, y, sizes[i].w * factor, sizes[i].h * factor],
          dest: [packed.at[i][0], packed.at[i][1], sizes[i].w, sizes[i].h],
        })),
      };
    }
    factor *= 2;
  }
}

/** A region's crop in its source's own UVs, which is what Rust reads. */
export function cropUv(
  region: SheetRegion,
  size: { width: number; height: number },
): UvBox {
  const [x, y, w, h] = region.crop;
  return [
    x / size.width,
    y / size.height,
    (x + w) / size.width,
    (y + h) / size.height,
  ];
}

/**
 * Where each piece's UVs go on the sheet. `sizes` are the sources' own sizes,
 * in the order of `sources` and of the plan's regions.
 */
export function sheetUvMap(
  sources: SheetSource[],
  sizes: { width: number; height: number }[],
  plan: SheetPlan,
): SheetUv {
  const byPiece = new Map<string, number>();
  sources.forEach((source, i) => {
    for (const id of source.pieceIds) byPiece.set(id, i);
  });
  return (pieceId, uv) => {
    const i = byPiece.get(pieceId);
    if (i === undefined) return uv;
    const [u, v] = engineSide(sources[i], uv);
    const { crop, dest } = plan.regions[i];
    return [
      (dest[0] + (u * sizes[i].width - crop[0]) / plan.factor) / plan.width,
      (dest[1] + (v * sizes[i].height - crop[1]) / plan.factor) / plan.height,
    ];
  };
}
