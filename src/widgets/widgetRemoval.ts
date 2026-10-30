/**
 * Removing a widget (issue #1288).
 *
 * A widget the player added sits in the folder each game that loads it reads,
 * and one add for all games makes a copy in every distinct folder. Removing a
 * widget takes out all of those copies, because the player sees one widget and
 * asked for it to go, and names every game that loses it first. Each copy goes
 * with its subfolder when no other widget shares that subfolder, since the
 * subfolder holds the helpers the widget includes. The files are copied to the
 * widget backups first (`widget_remove.rs`).
 *
 * Optionally the widget's entries leave each of those games' config files: its
 * on or off state, and the settings it saved. They follow the rules of the
 * other config writes (`widgetConfig.ts`): refuse while a game is running, copy
 * the file first, and never write over a file that could not be read.
 */

import { t } from "@lingui/core/macro";
import { appFileIO } from "@/blueprint/fileIO";
import { contentWidgetDelete } from "@/content/bindings";
import { errorText } from "@/lib/helpers";
import type { WidgetHandler } from "./handlers";
import {
  type ConfigFileIO,
  type Field,
  field,
  findConfig,
  findData,
  LuaSyntaxError,
  returnedTable,
  type Table,
  unreadable,
  writeWithBackup,
} from "./widgetConfig";
import type { GameHandler, WidgetRow } from "./widgetList";
import { dropWidgets, updateSets } from "./widgetSets";

type RecognisedGame = GameHandler & { handler: WidgetHandler };

function fileName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/** The name a game saves a row's state under, or null for a file that did not
 *  run. */
export function nameOf(row: WidgetRow): string | null {
  return row.info ? (row.info.name ?? fileName(row.path)) : null;
}

/** A row's path below the folder it was scanned in. */
function inFolder(row: WidgetRow): string {
  return row.path.slice(row.folder.length + 1);
}

/** What removing one row takes out. */
export interface Removal {
  /** The widget's file in each folder it was added to, the picked row first. */
  copies: WidgetRow[];
  /** Subfolders holding only those copies, which go whole. */
  folders: string[];
  /** The games that load a copy, who lose the widget. */
  games: string[];
  /** The name its state is saved under, when its file ran. */
  name: string | null;
  previousNames: readonly string[];
}

/**
 * What removing `row` takes out. The copies are the rows with the same name at
 * the same path below their folder, which is how adding one widget for all
 * games leaves it. A file that did not run has no name to match, so it is
 * removed alone.
 */
export function removalFor(
  rows: readonly WidgetRow[],
  row: WidgetRow,
): Removal {
  const name = nameOf(row);
  const copies =
    name === null
      ? [row]
      : [
          row,
          ...rows.filter(
            (r) =>
              r !== row &&
              !r.coilbox &&
              nameOf(r) === name &&
              inFolder(r) === inFolder(row),
          ),
        ];
  const folders: string[] = [];
  for (const copy of copies) {
    if (!copy.nested) continue;
    const folder = `${copy.folder}/${inFolder(copy).split("/")[0]}`;
    const shared = rows.some(
      (r) => r.path.startsWith(`${folder}/`) && !copies.includes(r),
    );
    if (!shared && !folders.includes(folder)) folders.push(folder);
  }
  const games = rows
    .filter((r) => copies.includes(r))
    .flatMap((r) => r.loadedBy)
    .filter((g, i, all) => all.indexOf(g) === i);
  return {
    copies,
    folders,
    games,
    name,
    // Copies are one widget, but each file says its own, so all of them count.
    previousNames: [
      ...new Set(copies.flatMap((c) => c.info?.previousNames ?? [])),
    ],
  };
}

// ---------------------------------------------------------------------------
// Entries in the games' config files
// ---------------------------------------------------------------------------

/** The names a game may hold an entry for this widget under: its own and the
 *  ones it had before, leaving out any that a widget staying installed uses,
 *  by its name or by a name it had before, which it reads state from when its
 *  own name has none. */
export function entryNames(
  removal: Removal,
  rows: readonly WidgetRow[],
  game: string,
): string[] {
  if (removal.name === null) return [];
  const kept = new Set(
    rows
      .filter((r) => !removal.copies.includes(r) && r.loadedBy.includes(game))
      .flatMap((r) => [nameOf(r), ...(r.info?.previousNames ?? [])]),
  );
  return [removal.name, ...removal.previousNames]
    .filter((n, i, all) => all.indexOf(n) === i)
    .filter((n) => !kept.has(n));
}

/** The table a role's entries are in, or undefined when the file has none. A
 *  flat file's table is the file's own, which also holds the format's
 *  `version`. */
function entriesTable(
  src: string,
  config: WidgetHandler["config"],
  role: "order" | "data",
): Table | undefined {
  const top = returnedTable(src);
  if (role === "order" ? config.shape === "flat" : config.dataFiles) return top;
  const key = role === "order" ? "order" : "data";
  const f = field(top, key);
  if (f && !f.table) throw new LuaSyntaxError(`its ${key} is not a table`);
  return f?.table;
}

/** The text to cut out for a field: the field and its separator, and the line
 *  too when it holds nothing else. */
function span(src: string, f: Field): [number, number] {
  const lineStart = src.lastIndexOf("\n", f.start - 1) + 1;
  const alone = /^[ \t]*$/.test(src.slice(lineStart, f.start));
  const rest = /^[ \t]*(\r?\n|$)/.exec(src.slice(f.end));
  if (alone && rest) return [lineStart, f.end + rest[0].length];
  return [f.start, f.end + (/^[ \t]*/.exec(src.slice(f.end))?.[0].length ?? 0)];
}

/**
 * The file without its `names` entries in the `role` table, and which of the
 * names it held. Everything else is left byte for byte. Throws when the file is
 * not a table the handler wrote, or is not one once the entries are gone.
 */
export function dropEntries(
  src: string,
  config: WidgetHandler["config"],
  role: "order" | "data",
  names: readonly string[],
): { text: string; removed: string[] } {
  try {
    const flat = config.shape === "flat";
    const hits = (entriesTable(src, config, role)?.fields ?? []).filter(
      (f) =>
        f.key !== null &&
        names.includes(f.key) &&
        // The format's own key, beside the widgets in a flat file.
        !(flat && f.key === "version"),
    );
    if (hits.length === 0) return { text: src, removed: [] };
    let text = src;
    for (const f of [...hits].sort((a, b) => b.start - a.start)) {
      const [from, to] = span(text, f);
      text = `${text.slice(0, from)}${text.slice(to)}`;
    }
    const left = entriesTable(text, config, role)?.fields ?? [];
    if (left.some((f) => hits.some((h) => h.key === f.key))) {
      throw new LuaSyntaxError("an entry could not be removed");
    }
    return {
      text,
      removed: [...new Set(hits.map((h) => h.key as string))],
    };
  } catch (e) {
    throw unreadable(e);
  }
}

/** A config file with entries to remove. */
export interface EntryFile {
  path: string;
  before: string;
  after: string;
  /** The games whose entries are in it. */
  games: string[];
  /** The names it holds entries for. */
  names: string[];
}

export interface EntryPlan {
  files: EntryFile[];
  /** The games whose files could not be read, one line each. */
  failed: string[];
}

/** The games whose config files hold the widget's entries to remove, with the
 *  names to look for in each. */
export function entryTargets(
  removal: Removal,
  rows: readonly WidgetRow[],
  games: readonly GameHandler[],
): { game: RecognisedGame; names: string[] }[] {
  return games.flatMap((game) => {
    if (!game.handler || !removal.games.includes(game.game)) return [];
    const names = entryNames(removal, rows, game.game);
    return names.length > 0
      ? [{ game: { ...game, handler: game.handler }, names }]
      : [];
  });
}

/**
 * The config files that hold entries for the widget, and what they would be
 * without them. Reads only. A game's file that is there and cannot be read is
 * left out and said in `failed`.
 */
export async function planEntryRemoval(
  io: ConfigFileIO,
  writeDir: string,
  targets: readonly { game: RecognisedGame; names: string[] }[],
): Promise<EntryPlan> {
  const files = new Map<string, EntryFile>();
  const failed: string[] = [];
  for (const { game, names } of targets) {
    const { config } = game.handler;
    const shortName = game.shortName ?? "";
    // Worked out apart and added to the plan once the game's files have all
    // read, so an unreadable data file does not leave half of them planned.
    const staged = new Map<string, EntryFile>();
    try {
      const order = await findConfig(io, writeDir, config, shortName);
      const data = config.dataFiles
        ? await findData(io, writeDir, config, shortName)
        : null;
      const apply = (
        file: { path: string; text: string } | null,
        role: "order" | "data",
      ) => {
        if (!file) return;
        // A file two games share has had the first game's entries taken out.
        const had = staged.get(file.path) ?? files.get(file.path);
        const out = dropEntries(had?.after ?? file.text, config, role, names);
        if (out.removed.length === 0) return;
        staged.set(file.path, {
          path: file.path,
          before: file.text,
          after: out.text,
          games: [...(had?.games ?? []), game.game],
          names: [...(had?.names ?? []), ...out.removed],
        });
      };
      apply(order, "order");
      apply(data ?? order, "data");
    } catch (e) {
      failed.push(`${game.game}: ${errorText(e)}`);
      continue;
    }
    for (const [path, file] of staged) {
      files.set(path, {
        ...file,
        games: [...new Set(file.games)],
        names: [...new Set(file.names)],
      });
    }
  }
  return { files: [...files.values()], failed };
}

export interface EntryRemoval {
  /** The files written. */
  files: EntryFile[];
  /** Where each was copied to first. */
  backups: string[];
  failed: string[];
}

/**
 * Take the widget's entries out of the games' config files. Refuses while a
 * game is running, which writes the files back when it saves or exits. A file
 * is copied before it is written.
 */
export async function removeEntries({
  io,
  writeDir,
  targets,
  gameRunning,
  now = new Date(),
}: {
  io: ConfigFileIO;
  writeDir: string;
  targets: readonly { game: RecognisedGame; names: string[] }[];
  gameRunning: boolean;
  /** When this is happening, which names the copy. Passed in so a test can say. */
  now?: Date;
}): Promise<EntryRemoval> {
  if (gameRunning) throw gameIsRunning();
  const out: EntryRemoval = { files: [], backups: [], failed: [] };
  // One file at a time, planned again after each write. Two games can name one
  // file by paths that differ only in case, which is one file on a filesystem
  // that folds case, and a plan made before the first write would put back
  // what that write took out.
  const written = new Set<string>();
  for (;;) {
    const plan = await planEntryRemoval(io, writeDir, targets);
    for (const line of plan.failed) {
      if (!out.failed.includes(line)) out.failed.push(line);
    }
    const file = plan.files.find((f) => !written.has(f.path));
    if (!file) return out;
    written.add(file.path);
    try {
      out.backups.push(
        await writeWithBackup(io, file.path, file.before, file.after, now),
      );
      out.files.push(file);
    } catch (e) {
      out.failed.push(`${file.games.join(", ")}: ${errorText(e)}`);
    }
  }
}

function gameIsRunning(): Error {
  return new Error(
    t`A game is running. It writes its widget settings back when it saves or exits, so a widget removed now would come back. Close the game and try again.`,
  );
}

// ---------------------------------------------------------------------------
// The whole removal
// ---------------------------------------------------------------------------

export interface RemovalResult {
  /** The files removed, relative to the write folder. */
  files: string[];
  /** The folder the files were copied to first. */
  backup: string;
  /** The names taken out of the widget sets, which a restore switches off
   *  again. */
  forgotten: string[];
  /** The config files whose entries were removed. */
  entries: EntryRemoval | null;
}

/**
 * Remove the widget: its files, then its place in the widget sets and, when
 * `entries` is set, its entries in the games' config files. Refuses while a game
 * is running. The files are copied to the widget backups first. A config file
 * that cannot be written is said in the result and does not undo the removal.
 */
export async function removeWidget({
  io = appFileIO,
  writeDir,
  removal,
  rows,
  games,
  entries,
  gameRunning,
}: {
  io?: ConfigFileIO;
  writeDir: string;
  removal: Removal;
  rows: readonly WidgetRow[];
  games: readonly GameHandler[];
  entries: boolean;
  gameRunning: boolean;
}): Promise<RemovalResult> {
  if (gameRunning) throw gameIsRunning();
  const targets = entries ? entryTargets(removal, rows, games) : [];
  const done = await contentWidgetDelete({
    writeDir,
    files: removal.copies.map((c) => c.path),
    folders: removal.folders,
    label: removal.name,
  });
  const name = removal.name;
  const stays =
    name !== null &&
    rows.some((r) => !removal.copies.includes(r) && nameOf(r) === name);
  const forgotten = name !== null && !stays ? [name] : [];
  updateSets((s) => dropWidgets(s, forgotten));
  let removed: EntryRemoval | null = null;
  if (entries) {
    try {
      removed = await removeEntries({
        io,
        writeDir,
        targets,
        gameRunning,
      });
    } catch (e) {
      removed = { files: [], backups: [], failed: [errorText(e)] };
    }
  }
  return {
    files: done.files,
    backup: done.backup,
    forgotten,
    entries: removed,
  };
}
