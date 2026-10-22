/**
 * Make a mixed unit's combined sheet for an export (#3260): measure the
 * pictures, lay them out, have Rust paint both sheets into the store, and hand
 * back what an export writes the unit with.
 *
 * Made again on every export rather than kept, because it follows the build:
 * a piece moved onto another part of the atlas moves its region.
 */

import { t } from "@lingui/core/macro";
import {
  type BlenderTextureRef,
  legoTexturePrune,
  legoTextureSheet,
  legoTextureSizes,
  type StoredTextureRef,
} from "./bindings";
import type { LegoProject } from "./model";
import type { LoadedPack } from "./pack";
import { savedUnitsAndModules } from "./projects";
import type { RawGeometry } from "./rawGeometry";
import { pngName, texturesInUse } from "./rawImport";
import { bakedPieces } from "./s3oBuild";
import {
  cropUv,
  planSheet,
  type SheetSource,
  type SheetUv,
  sheetBounds,
  sheetTextureNames,
  sheetUvMap,
} from "./textureSheet";

export interface CombinedSheet {
  /** What the model names, and what the two files are written as. */
  texture1: string;
  texture2: string;
  /** The two sheets to place in `unittextures`, rewritten every export. */
  place: StoredTextureRef[];
  /** The same two as the Blender files take them. */
  blender: { colour: BlenderTextureRef; mask: BlenderTextureRef };
  /** Where each piece's UVs go. */
  uv: SheetUv;
}

/**
 * Clear the sheets earlier builds left in the texture store (#4362).
 *
 * Keeps what a saved unit or module names, what the unit being built names
 * (its document may not be autosaved yet), and the two sheets just made. A
 * sheet is not on any document, so everything else is a sheet nothing reads
 * any more: each export copies its sheet out and the next builds a fresh one.
 * Does nothing before the saved units have loaded, since the keep set would be
 * short and a lifted piece's texture would be swept.
 */
async function pruneOldSheets(project: LegoProject, sheetKeys: string[]) {
  const saved = savedUnitsAndModules();
  if (!saved) return;
  try {
    await legoTexturePrune({
      keep: [...texturesInUse([project, ...saved]), ...sheetKeys],
    });
  } catch {
    // Dead sheets are a disk-space question, and the export has its sheet.
  }
}

export async function buildCombinedSheet(
  project: LegoProject,
  pack: LoadedPack,
  raw: RawGeometry | null,
  sources: SheetSource[],
): Promise<CombinedSheet> {
  const sizes = await legoTextureSizes({
    images: sources.map((source) => source.colour),
  });
  if (sizes.length !== sources.length) {
    throw new Error(t`Coilbox could not measure the textures for the sheet.`);
  }
  const { pieces } = bakedPieces(project, pack, raw);
  const plan = planSheet(
    sources.map((source, i) => ({
      bounds: sheetBounds(source, pieces),
      ...sizes[i],
    })),
  );
  const names = sheetTextureNames(project.unitName);
  const stored = await legoTextureSheet({
    width: plan.width,
    height: plan.height,
    regions: sources.map((source, i) => ({
      colour: source.colour,
      shading: source.shading,
      crop: cropUv(plan.regions[i], sizes[i]),
      dest: plan.regions[i].dest,
    })),
    names,
  });
  await pruneOldSheets(project, [stored.texture.key, stored.texture2.key]);
  return {
    ...names,
    place: [
      { key: stored.texture.key, writeAs: names.texture1, rewrite: true },
      { key: stored.texture2.key, writeAs: names.texture2, rewrite: true },
    ],
    blender: {
      colour: {
        key: stored.texture.key,
        writeAs: pngName(names.texture1),
        role: "colour",
      },
      mask: {
        key: stored.texture2.key,
        writeAs: pngName(names.texture2),
        role: "mask",
      },
    },
    uv: sheetUvMap(sources, sizes, plan),
  };
}
