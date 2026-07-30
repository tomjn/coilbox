import { defineCommand } from "@picoframe/plugin-sdk";

import type { S3oBuild } from "./s3oBuild";

/**
 * Which atlas to place, where to read it from, and what to call it. The three
 * travel together because a texture's file name does not say which pack ships
 * it: `pack` is an atlas pack's folder, or null for the base pack's own atlas.
 */
export interface AtlasRef {
  /** The file name in the pack that ships it, which is what to read. */
  name: string;
  pack: string | null;
  /**
   * The file name to write it as, which is what the s3o names. Derived by
   * `exportTextureName`, so a pack's generic name cannot land on a game's own
   * file.
   */
  writeAs: string;
}

/** A stored document. The JSON is parsed here, not in Rust. */
export interface LegoStoredItem {
  id: string;
  json: string;
}

/**
 * Projects and compounds are stored the same way and differ only in folder, so
 * one pair of commands serves both.
 */
export type LegoKind = "project" | "compound";

/** Every saved unit and compound, in one call because the overview shows both. */
export const legoList = defineCommand<
  Record<string, never>,
  { projects: LegoStoredItem[]; compounds: LegoStoredItem[] }
>("coilbox-lego", "lego_list");

/** Write a document the caller serialized. Id charset: `[A-Za-z0-9-]+`. */
export const legoSave = defineCommand<
  { kind: LegoKind; id: string; json: string },
  Record<string, never>
>("coilbox-lego", "lego_save");

/** Delete a document, and for a project its thumbnail and export folder too. */
export const legoDelete = defineCommand<
  { kind: LegoKind; id: string },
  Record<string, never>
>("coilbox-lego", "lego_delete");

/**
 * Store an overview thumbnail. The caller renders it at a bounded size and
 * sends the encoded PNG, so there is nothing to decode or resize in Rust.
 */
export const legoThumbSave = defineCommand<
  { id: string; png: number[] },
  Record<string, never>
>("coilbox-lego", "lego_thumb_save");

/**
 * Write a built unit into a game folder: `objects3d/<unit>.s3o`, and the unit's
 * atlas into `unittextures/` when `atlas` is given. Units sharing an atlas share
 * the one copy, so exporting a second unit does not add a second PNG, and a
 * texture already at that path is left alone rather than overwritten.
 */
export const legoExport = defineCommand<
  {
    dir: string;
    unitName: string;
    /** Null to write no texture. Otherwise the file, and which pack ships it. */
    atlas: AtlasRef | null;
    /** Written only when the game has no script for this unit yet. */
    script: string | null;
    /** Written only when the game has no unit definition for it yet. */
    unitDef: string | null;
    model: S3oBuild;
  },
  {
    model: string;
    texture: string | null;
    script: string | null;
    /** True when a script was already there and was left as it was. */
    scriptKept: boolean;
    unitDef: string | null;
    /** True when a unit definition was already there and was left as it was. */
    unitDefKept: boolean;
    /** True when a texture of that name was already there and was left alone. */
    textureKept: boolean;
  }
>("coilbox-lego", "lego_export");

/**
 * Write a unit's `.glb` into a game folder, at `blender/<unit>.glb`. Separate
 * from `objects3d`, since a `.glb` is not something the engine reads: it is
 * for taking the unit into Blender, either to check it against the `.s3o` or
 * to finish it by hand.
 */
export const legoExportGlb = defineCommand<
  { dir: string; unitName: string; bytes: number[] },
  { path: string }
>("coilbox-lego", "lego_export_glb");

/**
 * Write a unit's `.obj` and `.mtl` into a game folder, at
 * `blender/<unit>.obj` and `.mtl`, alongside a copy of the atlas the `.mtl`
 * points its `map_Kd` at. The copy is what makes the reference resolve: an
 * `.mtl` naming a texture that lives only in `unittextures/` elsewhere in the
 * game folder would not open correctly relocated on its own.
 */
export const legoExportObj = defineCommand<
  {
    dir: string;
    unitName: string;
    obj: string;
    mtl: string;
    /** The atlas to copy in beside the .obj and .mtl. */
    atlas: AtlasRef;
  },
  { obj: string; mtl: string; texture: string }
>("coilbox-lego", "lego_export_obj");

/**
 * Prepare the scratch `.sdd` a unit is tested in, at
 * `<dataDir>/games/<folder>`, and write the three files the caller generated:
 * the `modinfo.lua`, the side data naming the built unit as the start unit, and
 * the gadget that spawns it. Where each lands is fixed on the Rust side. The
 * unit itself goes in afterwards through `legoExport`, which treats it as any
 * other game folder. `folder` must be coilbox's own scratch name.
 */
export const legoScratchGame = defineCommand<
  {
    dataDir: string;
    folder: string;
    modinfo: string;
    sidedata: string;
    gadget: string;
  },
  { dir: string }
>("coilbox-lego", "lego_scratch_game");

/**
 * The extension parts packs installed, by folder name and in load order, plus
 * the folder they live in so the UI can say where to put one.
 */
export const legoPacks = defineCommand<
  Record<string, never>,
  { dir: string; names: string[] }
>("coilbox-lego", "lego_packs");

/** Reveal an exported unit in the file manager. */
export const legoOpenPath = defineCommand<
  { path: string },
  { opened: boolean }
>("coilbox-lego", "lego_open_path");
