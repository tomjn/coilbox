import { defineCommand } from "@picoframe/plugin-sdk";

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

/** Reveal an exported unit in the file manager. */
export const legoOpenPath = defineCommand<
  { path: string },
  { opened: boolean }
>("coilbox-lego", "lego_open_path");
