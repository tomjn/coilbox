/**
 * A game's own widgets, the ones its archives ship (issue #4857).
 *
 * Every recognised handler loads the game's widgets from the same folders it
 * loads a player's from, read from the archives rather than the disk, and
 * keeps their on or off state in the same order table under the same names.
 * So a game widget is a row like a player's, read from a different place, and
 * its switch is the same one entry in the game's config file.
 *
 * They belong to one game, so no widget set holds them. A switch writes the
 * game's file straight away, and the launch leaves them as the file says.
 */

import type { PlayerWidgetFile, PlayerWidgetInfo } from "@/content/bindings";
import type { WidgetHandler } from "./handlers";
import type { GameHandler, WidgetRow } from "./widgetList";
import { savedUnder, type WidgetSwitch, widgetNames } from "./widgetNames";
import type { WidgetStates } from "./widgetSets";

/** One widget file in a game's archives. */
export interface GameWidget {
  /** As the archive spells it. */
  path: string;
  /** The archive it was read from. */
  archive: string;
  /** The handler folder it is in or under, as the handler spells it. */
  folder: string;
  nested: boolean;
  info: PlayerWidgetInfo | null;
  error: string | null;
}

/** A widget file the handler loads, before it is read. */
export interface WidgetMember {
  path: string;
  folder: string;
  nested: boolean;
}

/**
 * The files in a game's archives that `handler` loads as widgets, by the
 * archive each is read from. `owner` gives the archive of every file, the
 * first archive to have a path. The engine's VFS matches archive paths without
 * regard to case, so the folders are matched that way here.
 */
export function widgetMembers(
  owner: ReadonlyMap<string, string>,
  handler: WidgetHandler,
): Map<string, WidgetMember[]> {
  const byArchive = new Map<string, WidgetMember[]>();
  for (const [path, archive] of owner) {
    const lower = path.toLowerCase();
    if (!lower.endsWith(".lua")) continue;
    for (const folder of handler.folders) {
      const prefix = `${folder.toLowerCase()}/`;
      if (!lower.startsWith(prefix)) continue;
      const depth = lower.slice(prefix.length).split("/").length;
      if (depth > 2 || (depth === 2 && !handler.subfolders)) continue;
      byArchive.set(archive, [
        ...(byArchive.get(archive) ?? []),
        { path, folder, nested: depth === 2 },
      ]);
      break;
    }
  }
  return byArchive;
}

/**
 * The widgets among what was read. A file in a subfolder that runs and
 * declares nothing is a helper a widget includes, as it is for a player's.
 * Directly in a widget folder, the handler tries to load every file.
 */
export function readWidgets(
  members: readonly WidgetMember[],
  archive: string,
  read: readonly {
    path: string;
    info: PlayerWidgetInfo | null;
    error: string | null;
  }[],
): GameWidget[] {
  const byPath = new Map(read.map((r) => [r.path, r]));
  const out: GameWidget[] = [];
  for (const m of members) {
    const r = byPath.get(m.path);
    const info = r?.info ?? null;
    const error = r ? r.error : "the file was not read";
    if (!info && !error && m.nested) continue;
    out.push({
      ...m,
      archive,
      info,
      error: info || error ? error : "the file defines no GetInfo function",
    });
  }
  return out;
}

function fileName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function nameOf(file: Pick<PlayerWidgetFile, "info" | "path">): string | null {
  return file.info ? (file.info.name ?? fileName(file.path)) : null;
}

/**
 * The rows for `game`'s own widgets. Two of them with one name share an entry
 * as two player widgets do (#1290). One with the name of a player widget the
 * game loads has no switch: the entry is the player widget's, whose switch the
 * widget sets write before each launch, so a switch here would be undone.
 */
export function gameWidgetRows(
  widgets: readonly GameWidget[],
  game: GameHandler,
  playerRows: readonly WidgetRow[],
): WidgetRow[] {
  const files: PlayerWidgetFile[] = widgets.map((w) => ({
    // Not a content root: the archive is what tells two of these apart.
    root: w.archive,
    caseSensitive: false,
    path: w.path,
    folder: w.folder,
    nested: w.nested,
    coilbox: false,
    givesOrders: false,
    info: w.info,
    error: w.error,
  }));
  const loadedBy = files.map(() => [game.game]);
  const switches = widgetNames(files, loadedBy, [game]);
  const players = playerRows.filter((r) => r.loadedBy.includes(game.game));
  return files.map((file, i): WidgetRow => {
    const name = nameOf(file);
    const mine = players.filter((p) => name !== null && nameOf(p) === name);
    const sw: WidgetSwitch =
      name !== null && mine.length > 0
        ? {
            kind: "none",
            reason: "duplicate",
            name,
            others: mine.map((p) => p.path),
          }
        : switches[i];
    return { ...file, loadedBy: loadedBy[i], switch: sw };
  });
}

/**
 * On or off for each game widget with a switch, as the handler will read it:
 * its entry in the order table, or with none, what its `GetInfo()` says.
 */
export function gameWidgetStates(
  rows: readonly WidgetRow[],
  order: ReadonlyMap<string, number>,
): WidgetStates {
  const states: Record<string, boolean> = {};
  for (const row of rows) {
    if (row.switch.kind !== "ready") continue;
    const saved = savedUnder(row.switch, (n) => order.has(n));
    states[row.switch.name] =
      saved === null ? row.info?.enabled === true : (order.get(saved) ?? 0) > 0;
  }
  return states;
}
