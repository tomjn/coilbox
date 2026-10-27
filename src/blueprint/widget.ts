/**
 * The two files coilbox and its in game widget share (issue #1419).
 *
 * The widget, under `lua/blueprint-widget/`, reads a library file coilbox
 * writes into the content root and appends what a player saves in game to a
 * spool file beside the engine, because the engine folder is the only place
 * a widget can write. Coilbox writes the first whenever the library changes
 * and empties the second into the library when no game is running.
 *
 * Both are version 1 documents holding `BlueprintPayload` entries, the same
 * shape the hub vendors, so the widget's reader in
 * `lua/blueprint-widget/luaui/coilbox_blueprints/store.lua` and this one
 * agree on every field without either knowing about the other's language.
 * A library entry carries the record's id beside the payload. A spool entry
 * carries `recordedAt` instead, and gets its id here.
 *
 * Text in, text out. Where the files are and who is allowed to touch them is
 * `./widgetSync.ts`.
 */

import { t } from "@lingui/core/macro";
import { type StoredBlueprint, widgetSource } from "./library";
import { type BlueprintPayload, parseBlueprintPayload } from "./payload";

/** Under the content root. The widget reads it through the engine's VFS. */
export const WIDGET_LIBRARY_FILE = "LuaUI/Config/coilbox_blueprints.json";

/** Under the engine folder. Named apart from the library file so the engine's
 *  raw search order, which puts the write dir first, cannot let it shadow the
 *  library. */
export const WIDGET_SPOOL_FILE = "LuaUI/Config/coilbox_blueprints_spool.json";

const VERSION = 1;

/** The library as the widget reads it. */
export function widgetLibraryText(records: readonly StoredBlueprint[]): string {
  return JSON.stringify({
    version: VERSION,
    blueprints: records.map((record) => ({ id: record.id, ...record.layout })),
  });
}

/** One layout saved in game, not yet in the library. */
export interface SpoolEntry {
  layout: BlueprintPayload;
  /** Seconds since the epoch, stamped by the widget. */
  recordedAt?: number;
  /** The widget worked its terrain steps out of the ground in the match
   *  (issue #4798). */
  fromGround?: true;
}

/** What a spool held: the layouts that read, and how many entries did not. */
export interface SpoolRead {
  entries: SpoolEntry[];
  skipped: number;
}

/**
 * Read a spool. No file, or an empty one, is nothing to collect. A file that
 * is there and will not read throws, because the caller is about to empty it
 * and must not empty what it could not read.
 */
export function readSpool(text: string | null): SpoolRead {
  if (text === null || text.trim() === "") return { entries: [], skipped: 0 };
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    throw new Error(t`the spool is not JSON: ${detail}`);
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(t`the spool could not be read: it is not an object`);
  }
  const v = value as Record<string, unknown>;
  if (v.version !== VERSION) {
    const found = String(v.version);
    throw new Error(
      t`the spool is version ${found}, and this coilbox reads version ${VERSION}`,
    );
  }
  if (!Array.isArray(v.blueprints)) return { entries: [], skipped: 0 };
  const entries: SpoolEntry[] = [];
  let skipped = 0;
  for (const raw of v.blueprints) {
    const layout = parseBlueprintPayload(raw);
    if (!layout) {
      skipped += 1;
      continue;
    }
    const { recordedAt, fromGround } = raw as Record<string, unknown>;
    entries.push({
      layout,
      ...(typeof recordedAt === "number" && Number.isFinite(recordedAt)
        ? { recordedAt }
        : {}),
      ...(fromGround === true ? { fromGround } : {}),
    });
  }
  return { entries, skipped };
}

/** What to write back once a spool has been collected. */
export function emptySpoolText(): string {
  return JSON.stringify({ version: VERSION, blueprints: [] });
}

/** Library records for collected entries, with fresh ids, timestamps left for
 *  the store to stamp, and a source naming the engine they were saved under. */
export function spoolRecords(
  entries: readonly SpoolEntry[],
  engine: string | undefined,
  at: Date = new Date(),
): StoredBlueprint[] {
  return entries.map((entry) => ({
    id: crypto.randomUUID(),
    createdAt: "",
    updatedAt: "",
    layout: entry.layout,
    source: widgetSource(engine, at, entry.fromGround === true),
  }));
}
