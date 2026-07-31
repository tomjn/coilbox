import { defineCommand } from "@picoframe/plugin-sdk";

import type { S3oModel } from "./importS3o";
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

/**
 * What an export places in `unittextures`, which is one thing or the other.
 *
 * A unit built out of parts places the atlas it samples. A unit imported from
 * somebody else's model places its own textures out of the shared store.
 */
export interface ExportTextures {
  atlas: AtlasRef | null;
  stored: StoredTextureRef[];
}

/**
 * A texture out of the shared store to place in a game folder. What an imported
 * unit exports instead of an atlas: it draws with its own texture, and the name
 * it is written under is the game's own rather than a coilbox-prefixed one.
 */
export interface StoredTextureRef {
  /** The file in the store: `<sha256>.<ext>`. */
  key: string;
  /** What to call it in `unittextures`, which is what the s3o names. */
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
    /** What to place in `unittextures`. Null to write no texture at all. */
    textures: ExportTextures | null;
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
    /** Stored textures written, for an imported unit. */
    textures: string[];
    /** Stored textures already there under that name, and left alone. */
    texturesKept: string[];
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

/**
 * Parse an `.s3o` the user picked, so the builder can try to recover the
 * project it was exported from. Reading only: whether coilbox wrote it is a
 * question about the parts pack, which lives here rather than in Rust.
 */
export const legoReadS3o = defineCommand<{ path: string }, S3oModel>(
  "coilbox-lego",
  "lego_read_s3o",
);

/** One piece of an imported model. The vertices are in the sidecar, not here. */
export interface ImportedPiece {
  name: string;
  offset: [number, number, number];
  /** Null for a piece with no geometry: a hierarchy node, flare or aim point. */
  meshId: string | null;
  children: ImportedPiece[];
}

/** One of the two textures the model header names, once it has been looked for. */
export interface ImportedTexture {
  /** The file in the shared store, or null when it could not be found. */
  key: string | null;
  /** What the header names, or what the file found was actually called. */
  name: string;
  /** Where it was read from, so it can be refreshed after an edit elsewhere. */
  source: string | null;
}

/** What one import produced. */
export interface S3oImport {
  radius: number;
  height: number;
  mid: [number, number, number];
  root: ImportedPiece;
  texture: ImportedTexture;
  teamMask: ImportedTexture;
  meshes: number;
  vertices: number;
  triangles: number;
  /** Pieces whose index list was quads or a strip and had to be converted. */
  converted: number;
  /** How large the packed geometry sidecar is. */
  bytes: number;
}

/**
 * Import somebody else's `.s3o` as raw geometry, writing the meshes into
 * `lego/geometry/<id>.bin.gz` and putting its textures in the shared store.
 *
 * The vertices never come back over the IPC: the largest model measured is 15.0
 * MB as JSON against 3.1 MiB packed, and the frontend reads the sidecar over
 * the asset protocol instead. See `rawGeometry.ts`.
 */
export const legoImportS3o = defineCommand<
  { path: string; id: string },
  S3oImport
>("coilbox-lego", "lego_import_s3o");

/**
 * Put a texture in the shared store, for changing which one a unit draws with
 * or for picking up an edit made outside coilbox. The store is keyed by
 * content, so unchanged bytes cost no write and changed bytes get a new key.
 */
export const legoTextureImport = defineCommand<
  { path: string },
  { key: string; name: string; bytes: number }
>("coilbox-lego", "lego_texture_import");

/**
 * Delete every stored texture `keep` does not name. Called after a texture
 * changes, because a content-addressed store leaves the version before it
 * behind.
 */
export const legoTexturePrune = defineCommand<
  { keep: string[] },
  { removed: number }
>("coilbox-lego", "lego_texture_prune");

/** Reveal an exported unit in the file manager. */
export const legoOpenPath = defineCommand<
  { path: string },
  { opened: boolean }
>("coilbox-lego", "lego_open_path");
