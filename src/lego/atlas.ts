/**
 * Which atlas a unit samples, and where that atlas's texture lives.
 *
 * An s3o names a single texture and every piece in the model uses it, so a unit
 * is bound to exactly one atlas. Choosing one is a per-unit decision and never a
 * per-piece one, and this is the whole of that decision: pure, so it can be
 * tested without a renderer, a pack on disk or a Tauri command.
 *
 * The atlases available are the base parts pack's own, plus one for every atlas
 * pack installed (see `pack.ts`). An atlas pack redraws the sheet the parts are
 * already mapped into and brings no parts of its own, so every part is available
 * in every atlas and switching a unit between them can never leave a piece with
 * nowhere to sample from.
 */

import { legoExtraPackUrl, legoPackUrl } from "../lib/assetUrl";
import type { LegoProject } from "./model";
import type { LoadedPack } from "./pack";

/**
 * An atlas a unit can sample.
 *
 * Identified by its texture's file name, because that is what the s3o names,
 * what lands in `unittextures/`, and therefore what a unit is really bound to.
 * A pack id would not do: two atlases with the same file name could not coexist
 * in one game folder whatever their packs are called.
 */
export interface LegoAtlas {
  /** The texture file name, as the s3o names it. */
  tex1: string;
  /** Which pack ships it, for the picker to name it by. */
  packId: string;
  /** The atlas pack's folder, or null for the base pack's own atlas. */
  folder: string | null;
}

/** Where an atlas's texture is served from. */
export function atlasUrl(atlas: LegoAtlas): string {
  return atlas.folder === null
    ? legoPackUrl(atlas.tex1)
    : legoExtraPackUrl(atlas.folder, atlas.tex1);
}

/** The base pack's atlas, which is what a parts browser draws with. */
export function baseAtlas(pack: LoadedPack): LegoAtlas {
  return pack.library.atlases[0];
}

/** What a unit samples, and what to draw it with when that is not installed. */
export interface UnitAtlas {
  /** What the s3o names: the unit's own atlas, installed or not. */
  texture: string;
  /** The installed atlas holding that file, or null when there is none. */
  installed: LegoAtlas | null;
  /** What to draw with, which is the base atlas when the unit's is missing. */
  drawWith: LegoAtlas;
}

/**
 * The atlas a unit samples. `atlases` is the library's, base pack first.
 *
 * A unit with no atlas of its own is a unit built before atlas packs existed,
 * and samples the base pack's. A unit naming one that is not installed keeps
 * naming it, so installing the pack later puts the unit right on its own.
 */
export function unitAtlas(
  project: LegoProject,
  atlases: LegoAtlas[],
): UnitAtlas {
  const base = atlases[0];
  if (!project.atlas) {
    return { texture: base.tex1, installed: base, drawWith: base };
  }
  const found = atlases.find((atlas) => atlas.tex1 === project.atlas) ?? null;
  return { texture: project.atlas, installed: found, drawWith: found ?? base };
}
