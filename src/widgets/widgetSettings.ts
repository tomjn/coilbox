/**
 * Reading and editing the settings a widget has saved (issue #1291).
 *
 * A widget saves its settings by returning a table from `GetConfigData()`, and
 * its game's handler stores that table under the widget's name. The handlers
 * that keep one config file store it in the `data` table of that file. The ones
 * that keep the order apart store it in a data file of their own, a table keyed
 * by widget name (`WidgetConfigFile.dataFiles`).
 *
 * There is no schema for these tables, so they are shown as the keys and values
 * the widget saved. A value can be changed to another of its own type, and a
 * table can be opened, but no key is added, removed or retyped, because coilbox
 * does not know what the widget would make of that. A value that is not a plain
 * number, string or boolean (an expression, or a string holding bytes that are
 * not text) is shown as written and left alone.
 *
 * Like `widgetConfig.ts`, an edit replaces the text of the values it changes
 * and leaves every other byte of the game's file alone, copies the file first,
 * and never writes over a file that could not be read.
 */

import { t } from "@lingui/core/macro";
import { underConfigDir } from "@/content/enginePaths";
import type { WidgetConfigFile } from "./handlers";
import {
  booleanOf,
  type ConfigFileIO,
  type Field,
  field,
  findData,
  LuaSyntaxError,
  numberOf,
  returnedTable,
  type Table,
  tokenize,
  unreadable,
  writeWithBackup,
} from "./widgetConfig";
import { savedUnder, type WidgetSwitch } from "./widgetNames";

type ReadySwitch = Extract<WidgetSwitch, { kind: "ready" }>;

/** One key and value in a widget's saved table. */
export type SettingNode = {
  /** The key as the file spells it, or a positional entry's place. */
  label: string;
  /** Which field it is at each level from the widget's table, counting every
   *  field of the table whatever its key. This is how an edit finds it. */
  path: readonly number[];
  /** The labels of the fields on that path, which an edit checks so that a
   *  file the game has rewritten since cannot redirect it to another field. */
  trail: readonly string[];
} & (
  | { kind: "number"; value: number }
  | { kind: "string"; value: string }
  | { kind: "boolean"; value: boolean }
  | { kind: "table"; children: SettingNode[] }
  /** Anything else, as written. */
  | { kind: "other"; text: string }
);

/** A change to one value, which must stay the type it is. `path`, `trail` and
 *  `was` are what the node showed, and the edit is refused if the file no
 *  longer holds the same there. */
export interface SettingEdit {
  path: readonly number[];
  trail: readonly string[];
  was: number | string | boolean;
  value: number | string | boolean;
}

/** A string escape that stands for a byte above 127, which does not survive
 *  being read as text and written back. */
const BYTE_ESCAPE = /\\(?:12[89]|1[3-9]\d|2\d\d|x[89a-fA-F][0-9a-fA-F])/;

function nodeOf(
  src: string,
  f: Field,
  path: readonly number[],
  trail: readonly string[],
): SettingNode {
  const base = { label: f.label, path, trail };
  if (f.table) {
    return {
      ...base,
      kind: "table",
      children: childrenOf(src, f.table, path, trail),
    };
  }
  const n = numberOf(f.value);
  if (n !== null && Number.isFinite(n)) {
    return { ...base, kind: "number", value: n };
  }
  const b = booleanOf(f.value);
  if (b !== null) return { ...base, kind: "boolean", value: b };
  const [only] = f.value;
  if (
    f.value.length === 1 &&
    only.kind === "string" &&
    !BYTE_ESCAPE.test(src.slice(only.start, only.end))
  ) {
    return { ...base, kind: "string", value: only.value };
  }
  return { ...base, kind: "other", text: src.slice(f.valueStart, f.valueEnd) };
}

/** The fields Lua keeps: of two with one string key, the last. */
function childrenOf(
  src: string,
  table: Table,
  path: readonly number[],
  trail: readonly string[],
): SettingNode[] {
  return table.fields.flatMap((f, i) =>
    f.key !== null && table.fields.findLastIndex((g) => g.key === f.key) !== i
      ? []
      : [nodeOf(src, f, [...path, i], [...trail, f.label])],
  );
}

/** The table that holds every widget's saved settings, or undefined when the
 *  file has none yet. */
function settingsTable(
  src: string,
  config: WidgetConfigFile,
): Table | undefined {
  const top = returnedTable(src);
  if (config.dataFiles) return top;
  const data = field(top, "data");
  if (data && !data.table) throw new LuaSyntaxError("its data is not a table");
  return data?.table;
}

/** The entry the game holds for a widget, under whichever of its names has
 *  one. */
function locate(
  src: string,
  config: WidgetConfigFile,
  sw: ReadySwitch,
): { name: string; entry: Field } | null {
  const table = settingsTable(src, config);
  if (!table) return null;
  // Zero-K's and Complete Annihilation's data files carry the format's
  // `version` beside the widgets, which is no widget's entry.
  const has = (n: string) =>
    !(config.dataFiles && n === "version") && field(table, n) !== undefined;
  const name = savedUnder(sw, has);
  const entry = name === null ? undefined : field(table, name);
  return name !== null && entry ? { name, entry } : null;
}

/** What a widget has saved in a data file's text, or null when it has saved
 *  nothing. Throws when the file is not a table the handler wrote. */
export function readSettings(
  src: string,
  config: WidgetConfigFile,
  sw: ReadySwitch,
): { name: string; root: SettingNode } | null {
  try {
    const found = locate(src, config, sw);
    return (
      found && { name: found.name, root: nodeOf(src, found.entry, [], []) }
    );
  } catch (e) {
    throw unreadable(e);
  }
}

/** A string as a Lua literal that reads back as the same string. */
function luaString(value: string): string {
  let out = '"';
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    if (ch === "\\") out += "\\\\";
    else if (ch === '"') out += '\\"';
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (code < 32 || code === 127) {
      out += `\\${String(code).padStart(3, "0")}`;
    } else out += ch;
  }
  return `${out}"`;
}

function literal(value: SettingEdit["value"]): string {
  if (typeof value === "string") return luaString(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (!Number.isFinite(value)) {
    throw new Error(t`A setting must be a finite number.`);
  }
  return String(value);
}

function changed(): Error {
  return new Error(
    t`The settings changed after coilbox read them, so nothing was saved. Close this and open it again.`,
  );
}

/**
 * The file with the given values of one widget's table replaced, and nothing
 * else changed. Throws when the file is not a table the handler wrote, or no
 * longer holds what the edits expect.
 */
export function writeSettings(
  src: string,
  config: WidgetConfigFile,
  sw: ReadySwitch,
  edits: readonly SettingEdit[],
): string {
  try {
    const found = locate(src, config, sw);
    if (!found) throw changed();
    const spans = edits.map((edit) => {
      let f = found.entry;
      edit.path.forEach((i, depth) => {
        const next = f.table?.fields[i];
        if (!next || next.label !== edit.trail[depth]) throw changed();
        f = next;
      });
      // A value keeps its type, so an edit never turns a number into text, and
      // it is the value that was shown.
      const now = nodeOf(src, f, edit.path, edit.trail);
      const kind: string = now.kind;
      if (kind !== typeof edit.value || !("value" in now)) throw changed();
      if (now.value !== edit.was) throw changed();
      return { f, text: literal(edit.value) };
    });
    // From the end, so each offset is still right when it is applied.
    return spans
      .sort((a, b) => b.f.valueStart - a.f.valueStart)
      .reduce(
        (out, { f, text }) =>
          `${out.slice(0, f.valueStart)}${text}${out.slice(f.valueEnd)}`,
        src,
      );
  } catch (e) {
    throw unreadable(e);
  }
}

/** Whether a widget's source names `GetConfigData`, outside comments and
 *  strings. A file coilbox cannot tokenise is searched as plain text. */
export function mentionsGetConfigData(src: string): boolean {
  try {
    return tokenize(src).some(
      (tok) => tok.kind === "name" && tok.text === "GetConfigData",
    );
  } catch {
    return /\bGetConfigData\b/.test(src);
  }
}

/** What a widget has saved, for the page to show. */
export type WidgetSettings =
  /** In the game's data file, in `path`. */
  | { kind: "ready"; path: string; name: string; root: SettingNode }
  /** The widget implements `GetConfigData()` and has saved nothing yet,
   *  because it has not run in the game, or the game has not saved. */
  | { kind: "unsaved" }
  /** The widget does not implement `GetConfigData()`, so any settings it has
   *  live in its own source, which coilbox does not edit. */
  | { kind: "none" };

export interface SettingsRequest {
  io: ConfigFileIO;
  writeDir: string;
  config: WidgetConfigFile;
  shortName: string;
  sw: ReadySwitch;
}

/** Read a widget's saved settings. `widgetPath` is the widget's file relative
 *  to the write folder. Throws when the game's file is there and cannot be
 *  read. */
export async function loadWidgetSettings({
  io,
  writeDir,
  config,
  shortName,
  sw,
  widgetPath,
}: SettingsRequest & { widgetPath: string }): Promise<WidgetSettings> {
  const found = await findData(io, writeDir, config, shortName);
  const saved = found && readSettings(found.text, config, sw);
  if (found && saved) return { kind: "ready", path: found.path, ...saved };
  const source = await io.read(underConfigDir(writeDir, widgetPath));
  return source !== null && !mentionsGetConfigData(source)
    ? { kind: "none" }
    : { kind: "unsaved" };
}

export interface SaveOutcome {
  /** Where the file was copied to first, absent when nothing needed writing. */
  backup?: string;
}

/**
 * Change values in a widget's saved settings. Refuses while a game is running,
 * which writes the file back when it saves or exits, and throws before writing
 * anything when the file cannot be read or no longer holds what was shown.
 */
export async function saveWidgetSettings({
  io,
  writeDir,
  config,
  shortName,
  sw,
  edits,
  gameRunning,
  now = new Date(),
}: SettingsRequest & {
  edits: readonly SettingEdit[];
  gameRunning: boolean;
  /** When this is happening, which names the copy. Passed in so a test can say. */
  now?: Date;
}): Promise<SaveOutcome> {
  if (gameRunning) {
    throw new Error(
      t`A game is running. It writes its widget settings back when it saves or exits, so anything written now would be thrown away. Close the game and try again.`,
    );
  }
  const found = await findData(io, writeDir, config, shortName);
  if (!found) throw changed();
  const text = writeSettings(found.text, config, sw, edits);
  if (text === found.text) return {};
  return {
    backup: await writeWithBackup(io, found.path, found.text, text, now),
  };
}
