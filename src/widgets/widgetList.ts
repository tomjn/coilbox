/**
 * The widget list (issue #1284): every widget file a player has added, and
 * which installed games load each one.
 *
 * Games share the write folder, so one file can load in several games, or in
 * none. A game whose handler is not recognised cannot say which files it
 * loads, so it loads none here and its own list shows every file, read only.
 */

import type { PlayerWidgetFile, PlayerWidgetScan } from "@/content/bindings";
import { loads, type WidgetHandler } from "./handlers";
import { type WidgetSwitch, widgetNames } from "./widgetNames";

/** An installed game and the handler it runs, `null` when not recognised. */
export interface GameHandler {
  /** The game's name as unitsync reports it, version and all. */
  game: string;
  handler: WidgetHandler | null;
}

export interface WidgetRow extends PlayerWidgetFile {
  /** The games whose recognised handler loads this file, in `games` order. */
  loadedBy: string[];
  /** Whether the file can have a switch, and the name its state is saved
   *  under (issue #1290). */
  switch: WidgetSwitch;
}

export function widgetRows(
  scan: PlayerWidgetScan,
  games: readonly GameHandler[],
): WidgetRow[] {
  const loadedBy = scan.files.map((file) =>
    games
      .filter(
        (g) => g.handler !== null && loads(g.handler, file, scan.caseSensitive),
      )
      .map((g) => g.game),
  );
  const switches = widgetNames(scan.files, loadedBy, games);
  return scan.files.map((file, i) => ({
    ...file,
    loadedBy: loadedBy[i],
    switch: switches[i],
  }));
}

/** The rows one game's list shows: the files it loads, or every file when its
 *  handler is not recognised. */
export function rowsForGame(
  rows: readonly WidgetRow[],
  game: GameHandler,
): WidgetRow[] {
  if (game.handler === null) return [...rows];
  return rows.filter((r) => r.loadedBy.includes(game.game));
}

/**
 * The folder the open button shows: the first of the game's folders that is
 * there, or with no game picked or none there, the first scanned folder.
 * Relative to the write folder. `null` when no folder is there, so the caller
 * opens the write folder.
 */
export function folderToOpen(
  scan: PlayerWidgetScan,
  handler: WidgetHandler | null | undefined,
): string | null {
  const fold = (path: string) =>
    scan.caseSensitive ? path : path.toLowerCase();
  for (const folder of handler?.folders ?? []) {
    const found = scan.folders.find((f) => fold(f) === fold(folder));
    if (found) return found;
  }
  return scan.folders[0] ?? null;
}
