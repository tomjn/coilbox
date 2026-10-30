/**
 * The widget list (issue #1284): every widget file a player has added, and
 * which installed games load each one.
 *
 * Games share the write folder, so one file can load in several games, or in
 * none. A game whose handler is not recognised cannot say which files it
 * loads, so it loads none here and its own list shows every file, read only.
 */

import type { PlayerWidgetFile, PlayerWidgetScan } from "@/content/bindings";
import { compareGameVersions } from "@/play/installedGames";
import { loads, type WidgetHandler } from "./handlers";
import { type WidgetSwitch, widgetNames } from "./widgetNames";

/** An installed game and the handler it runs, `null` when not recognised. */
export interface GameHandler {
  /** The game's name as unitsync reports it, version and all. */
  game: string;
  /** Its modinfo short name, which most handlers build their config file
   *  name from. */
  shortName?: string;
  handler: WidgetHandler | null;
  /** Set on an entry that stands for every installed version of one game, which
   *  share their widgets: the full name of each, newest first. `game` is then
   *  the name without a version. */
  versions?: readonly string[];
}

/** One installed version of a game, before versions are grouped. */
export interface InstalledGame extends GameHandler {
  /** Its modinfo version, which says which of its versions is newest. */
  version: string;
  /** Its name without the version. */
  title: string;
}

/**
 * One entry per game. Versions of a game share one config file and one set of
 * widgets (see `setKey`), so versions with the same short name become one
 * entry, which runs the newest version's handler. A game with no short name has
 * nothing to group it by and keeps an entry per version.
 */
export function oneEntryPerGame(
  installed: readonly InstalledGame[],
): GameHandler[] {
  const byShortName = new Map<string, InstalledGame[]>();
  const entries: GameHandler[] = [];
  for (const { version: _v, title: _t, ...game } of installed) {
    if (!game.shortName) entries.push(game);
  }
  for (const game of installed) {
    if (!game.shortName) continue;
    byShortName.set(game.shortName, [
      ...(byShortName.get(game.shortName) ?? []),
      game,
    ]);
  }
  const taken = new Set(entries.map((e) => e.game));
  for (const [shortName, members] of byShortName) {
    members.sort((a, b) => compareGameVersions(b.version, a.version));
    const newest = members[0];
    // Two games can share a name without a version, such as a test branch.
    let name = newest.title;
    for (let n = 1; taken.has(name); n++) {
      name = `${newest.title} (${n === 1 ? shortName : `${shortName} ${n}`})`;
    }
    taken.add(name);
    entries.push({
      game: name,
      shortName,
      handler: newest.handler,
      versions: members.map((m) => m.game),
    });
  }
  return entries.sort((a, b) => a.game.localeCompare(b.game));
}

/** The entry a `?game=` value means: an entry's own name, or the full name of
 *  one of the versions it stands for. */
export function findGame<T extends GameHandler>(
  games: readonly T[] | null | undefined,
  name: string,
): T | undefined {
  return (
    games?.find((g) => g.game === name) ??
    games?.find((g) => g.versions?.includes(name))
  );
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
