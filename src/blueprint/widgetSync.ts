/**
 * Keeping the widget's files in step with the library (issue #1419).
 *
 * Two directions. Out: the whole library, written into the content root
 * whenever it changes, so the next match sees every layout. In: the spool the
 * widget appended to beside the engine, read into the library and then
 * emptied, and only when no game is running, because the widget reads the
 * spool back on load and a save mid match would be lost under it.
 *
 * The filesystem is passed in, the way `./gameFile.ts` takes it, so this runs
 * against two functions in a test and two Tauri commands in the app.
 */

import { underConfigDir } from "@/content/enginePaths";
import type { BlueprintFileIO } from "./gameFile";
import type { StoredBlueprint } from "./library";
import {
  emptySpoolText,
  readSpool,
  spoolRecords,
  WIDGET_LIBRARY_FILE,
  WIDGET_SPOOL_FILE,
  widgetLibraryText,
} from "./widget";

/** Write the library where the widget reads it. Returns the path written.
 *  Skips the write when the file already says the same, so a page that
 *  exports on every change does not touch the disk for nothing. */
export async function exportWidgetLibrary(
  io: BlueprintFileIO,
  contentRoot: string,
  records: readonly StoredBlueprint[],
): Promise<string> {
  const path = underConfigDir(contentRoot, WIDGET_LIBRARY_FILE);
  const text = widgetLibraryText(records);
  if ((await io.read(path)) !== text) {
    await io.write(path, text);
  }
  return path;
}

export interface CollectRequest {
  io: BlueprintFileIO;
  /** The engine folder, which is where the engine writes and so where the
   *  spool is. */
  engineDir: string;
  /** What to call that engine in the record's provenance. */
  engineName: string | undefined;
  /** A running game may be about to append, so the spool stays as it is. */
  gameRunning: boolean;
  /** Put the records into the library. Throwing leaves the spool untouched. */
  save: (records: StoredBlueprint[]) => Promise<void>;
}

export interface Collected {
  collected: number;
  /** Entries the spool held that were not layouts, and were dropped. */
  skipped: number;
}

/**
 * Read one engine's spool into the library and empty it.
 *
 * The spool is emptied only after the save has returned, and never when it
 * could not be read: an unreadable spool throws and stays, because emptying
 * it would throw away whatever the player saved that this build cannot
 * parse.
 */
export async function collectSpool(req: CollectRequest): Promise<Collected> {
  if (req.gameRunning) return { collected: 0, skipped: 0 };
  const path = underConfigDir(req.engineDir, WIDGET_SPOOL_FILE);
  const text = await req.io.read(path);
  if (text === null) return { collected: 0, skipped: 0 };
  const { entries, skipped } = readSpool(text);
  if (entries.length === 0 && skipped === 0) {
    return { collected: 0, skipped: 0 };
  }
  if (entries.length > 0) {
    await req.save(spoolRecords(entries, req.engineName));
  }
  await req.io.write(path, emptySpoolText());
  return { collected: entries.length, skipped };
}
