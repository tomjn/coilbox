import { defineCommand } from "@picoframe/plugin-sdk";

import type { S3oBuild } from "./s3oBuild";

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
 * Write a built unit into a game folder: `objects3d/<unit>.s3o`, and the pack's
 * atlas into `unittextures/` when `atlas` is given. Every unit built from a pack
 * names the same texture, so one copy serves all of them.
 */
export const legoExport = defineCommand<
  {
    dir: string;
    unitName: string;
    atlas: string | null;
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
  }
>("coilbox-lego", "lego_export");

/**
 * Prepare the scratch `.sdd` a unit is tested in, at
 * `<dataDir>/games/<folder>`, and write the `modinfo.lua` the caller
 * generated. The unit goes in afterwards through `legoExport`, which treats it
 * as any other game folder. `folder` must be coilbox's own scratch name.
 */
export const legoScratchGame = defineCommand<
  { dataDir: string; folder: string; modinfo: string },
  { dir: string }
>("coilbox-lego", "lego_scratch_game");

/** Reveal an exported unit in the file manager. */
export const legoOpenPath = defineCommand<
  { path: string },
  { opened: boolean }
>("coilbox-lego", "lego_open_path");
