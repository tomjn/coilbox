/**
 * Switching widgets on or off in a game's own config file (issue #1289).
 *
 * Every handler keeps an order table keyed by `GetInfo().name`, where `0` is
 * off and any other number is the widget's place in the load order. The file
 * belongs to the game, which rewrites it whenever it starts, saves or exits,
 * so this changes each entry in place and leaves every other byte alone, rather
 * than reading the file into a model and writing it all back. The rules are
 * the blueprint merge's (`src/blueprint/gameFile.ts`): copy the file first, and
 * never write over a file that could not be read. Coilbox writes it just before
 * it launches a game, when no game of its own is running.
 *
 * Switching on writes `1`, which is what every handler's own `EnableWidget`
 * writes when a player switches a widget on in the game's list. A widget
 * already on keeps its place. Which widgets to switch comes from the sets in
 * `widgetSets.ts` (#4844).
 *
 * A missing file is not created. Zero-K's handler throws away an order table
 * with no `version` key, so a file coilbox wrote from nothing could switch
 * every widget back to its default.
 */

import { t } from "@lingui/core/macro";
import { stamp } from "@/blueprint/gameFile";
import { underConfigDir } from "@/content/enginePaths";
import type { WidgetConfigFile } from "./handlers";

/** Reading and writing one path. Null from `read` means there is no file. */
export interface ConfigFileIO {
  read(path: string): Promise<string | null>;
  write(path: string, text: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Reading just enough Lua to find a table's fields
// ---------------------------------------------------------------------------

export type Token =
  | { kind: "name"; text: string; start: number; end: number }
  | { kind: "string"; value: string; start: number; end: number }
  | { kind: "number"; text: string; start: number; end: number }
  | { kind: "symbol"; text: string; start: number; end: number };

export class LuaSyntaxError extends Error {}

/** The level of a long bracket opening at `i` (`[[` is 0, `[==[` is 2), or -1
 *  when there is none. */
function longBracket(src: string, i: number): number {
  if (src[i] !== "[") return -1;
  let j = i + 1;
  while (src[j] === "=") j++;
  return src[j] === "[" ? j - i - 1 : -1;
}

function skipLong(src: string, i: number, level: number): number {
  const close = `]${"=".repeat(level)}]`;
  const end = src.indexOf(close, i + level + 2);
  if (end < 0) throw new LuaSyntaxError("unfinished long string or comment");
  return end + close.length;
}

const ESCAPES: Record<string, string> = {
  a: "\x07",
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
  v: "\v",
  "\\": "\\",
  '"': '"',
  "'": "'",
  "\n": "\n",
};

/** A quoted string starting at `i`, decoded. */
function readQuoted(src: string, i: number): { value: string; end: number } {
  const quote = src[i];
  let value = "";
  let j = i + 1;
  while (j < src.length) {
    const c = src[j];
    if (c === quote) return { value, end: j + 1 };
    if (c === "\n") break;
    if (c !== "\\") {
      value += c;
      j++;
      continue;
    }
    const e = src[j + 1];
    if (e === undefined) break;
    if (e in ESCAPES) {
      value += ESCAPES[e];
      j += 2;
    } else if (/\d/.test(e)) {
      const digits = /^\d{1,3}/.exec(src.slice(j + 1))?.[0] ?? "";
      value += String.fromCharCode(Number(digits));
      j += 1 + digits.length;
    } else if (e === "x" && /^[0-9a-fA-F]{2}/.test(src.slice(j + 2))) {
      value += String.fromCharCode(
        Number.parseInt(src.slice(j + 2, j + 4), 16),
      );
      j += 4;
    } else if (e === "z") {
      j += 2;
      while (/\s/.test(src[j] ?? "")) j++;
    } else {
      throw new LuaSyntaxError(`unknown escape \\${e}`);
    }
  }
  throw new LuaSyntaxError("unfinished string");
}

export function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
    } else if (src.startsWith("--", i)) {
      const level = longBracket(src, i + 2);
      if (level >= 0) i = skipLong(src, i + 2, level);
      else {
        const nl = src.indexOf("\n", i);
        i = nl < 0 ? src.length : nl + 1;
      }
    } else if (c === '"' || c === "'") {
      const { value, end } = readQuoted(src, i);
      tokens.push({ kind: "string", value, start: i, end });
      i = end;
    } else if (longBracket(src, i) >= 0) {
      const level = longBracket(src, i);
      const end = skipLong(src, i, level);
      let value = src.slice(i + level + 2, end - level - 2);
      if (value.startsWith("\r\n")) value = value.slice(2);
      else if (value.startsWith("\n")) value = value.slice(1);
      tokens.push({ kind: "string", value, start: i, end });
      i = end;
    } else if (/[A-Za-z_]/.test(c)) {
      const text = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i))?.[0] ?? c;
      tokens.push({ kind: "name", text, start: i, end: i + text.length });
      i += text.length;
    } else if (/\d/.test(c) || (c === "." && /\d/.test(src[i + 1] ?? ""))) {
      const text =
        /^(0[xX][0-9a-fA-F.]+([pP][+-]?\d+)?|[\d.]+([eE][+-]?\d+)?)/.exec(
          src.slice(i),
        )?.[0] ?? c;
      tokens.push({ kind: "number", text, start: i, end: i + text.length });
      i += text.length;
    } else {
      const text = /^(\.\.\.|\.\.|==|~=|<=|>=|::)/.exec(src.slice(i))?.[0] ?? c;
      tokens.push({ kind: "symbol", text, start: i, end: i + text.length });
      i += text.length;
    }
  }
  return tokens;
}

/** One field of a table constructor. `key` is a string key's value, or null
 *  for a positional field or one keyed by anything else. */
export interface Field {
  key: string | null;
  /** The key as the file spells it, or the place of a positional field. */
  label: string;
  /** Where the field starts, and where its value starts and ends. */
  start: number;
  valueStart: number;
  valueEnd: number;
  /** The value's tokens, and the table it is, when it is one. */
  value: Token[];
  table?: Table;
}

export interface Table {
  /** The offsets of `{` and `}`. */
  open: number;
  close: number;
  fields: Field[];
  /** Whether the last field has a `,` or `;` after it. */
  trailingSeparator: boolean;
}

export function isSymbol(tok: Token | undefined, text: string): boolean {
  return tok?.kind === "symbol" && tok.text === text;
}

function tokenText(tok: Token): string {
  return tok.kind === "string" ? tok.value : tok.text;
}

class Parser {
  i = 0;
  constructor(readonly tokens: Token[]) {}

  peek(ahead = 0): Token | undefined {
    return this.tokens[this.i + ahead];
  }

  expect(text: string): Token {
    const tok = this.tokens[this.i];
    if (!isSymbol(tok, text)) {
      throw new LuaSyntaxError(`expected "${text}"`);
    }
    this.i++;
    return tok as Token;
  }

  /** A table constructor, from its `{` to its `}`. */
  table(): Table {
    const open = this.expect("{").start;
    const fields: Field[] = [];
    let trailingSeparator = false;
    let positional = 0;
    while (!isSymbol(this.peek(), "}")) {
      if (!this.peek()) throw new LuaSyntaxError('expected "}"');
      const start = (this.peek() as Token).start;
      let key: string | null = null;
      let label: string;
      if (isSymbol(this.peek(), "[")) {
        this.i++;
        const keyTokens = this.expression(["]"]);
        this.expect("]");
        this.expect("=");
        const only = keyTokens.length === 1 ? keyTokens[0] : undefined;
        key = only?.kind === "string" ? only.value : null;
        label = key ?? keyTokens.map(tokenText).join("");
      } else if (this.peek()?.kind === "name" && isSymbol(this.peek(1), "=")) {
        key = (this.peek() as { text: string }).text;
        label = key;
        this.i += 2;
      } else {
        label = String(++positional);
      }
      const first = this.peek();
      if (!first) throw new LuaSyntaxError("expected a value");
      let table: Table | undefined;
      let value: Token[];
      if (
        isSymbol(first, "{") &&
        this.closesAt(this.matching(this.i) + 1, [",", ";", "}"])
      ) {
        const from = this.i;
        table = this.table();
        value = this.tokens.slice(from, this.i);
      } else {
        value = this.expression([",", ";", "}"]);
      }
      if (value.length === 0) throw new LuaSyntaxError("expected a value");
      fields.push({
        key,
        label,
        start,
        valueStart: value[0].start,
        valueEnd: value[value.length - 1].end,
        value,
        table,
      });
      trailingSeparator = false;
      if (isSymbol(this.peek(), ",") || isSymbol(this.peek(), ";")) {
        this.i++;
        trailingSeparator = true;
      } else if (!isSymbol(this.peek(), "}")) {
        throw new LuaSyntaxError('expected "," or "}"');
      }
    }
    const close = this.expect("}").start;
    return { open, close, fields, trailingSeparator };
  }

  /** The index of the bracket closing the one at `at`. */
  matching(at: number): number {
    let depth = 0;
    for (let j = at; j < this.tokens.length; j++) {
      const tok = this.tokens[j];
      if (tok.kind !== "symbol") continue;
      if ("{[(".includes(tok.text)) depth++;
      else if ("}])".includes(tok.text) && --depth === 0) return j;
    }
    throw new LuaSyntaxError("unbalanced brackets");
  }

  closesAt(at: number, ends: readonly string[]): boolean {
    const tok = this.tokens[at];
    return tok?.kind === "symbol" && ends.includes(tok.text);
  }

  /** Tokens up to one of `ends` outside any bracket, which is how far an
   *  expression this does not need to understand goes. */
  expression(ends: readonly string[]): Token[] {
    const from = this.i;
    while (this.i < this.tokens.length) {
      const tok = this.tokens[this.i];
      if (tok.kind === "symbol" && ends.includes(tok.text)) break;
      if (tok.kind === "symbol" && "{[(".includes(tok.text)) {
        this.i = this.matching(this.i) + 1;
      } else {
        this.i++;
      }
    }
    return this.tokens.slice(from, this.i);
  }
}

/** The table the file returns, which is how every handler's `table.save`
 *  writes it. */
export function returnedTable(src: string): Table {
  const tokens = tokenize(src);
  const at = tokens.findIndex(
    (tok) => tok.kind === "name" && tok.text === "return",
  );
  if (at < 0) throw new LuaSyntaxError("the file returns nothing");
  const parser = new Parser(tokens);
  parser.i = at + 1;
  const table = parser.table();
  if (isSymbol(parser.peek(), ";")) parser.i++;
  if (parser.peek())
    throw new LuaSyntaxError("more follows the returned table");
  return table;
}

/** The last field with `key`, which is the one Lua keeps. */
export function field(table: Table, key: string): Field | undefined {
  return table.fields.findLast((f) => f.key === key);
}

function orderTable(
  src: string,
  shape: WidgetConfigFile["shape"],
): { top: Table; order: Table | undefined } {
  const top = returnedTable(src);
  if (shape === "flat") return { top, order: top };
  const order = field(top, "order");
  if (order && !order.table) {
    throw new LuaSyntaxError("its order is not a table");
  }
  return { top, order: order?.table };
}

/** A number literal, with or without a sign, or null for anything else. */
export function numberOf(value: readonly Token[]): number | null {
  const [a, b] = value;
  if (value.length === 1 && a.kind === "number") return Number(a.text);
  if (value.length === 2 && isSymbol(a, "-") && b.kind === "number") {
    return -Number(b.text);
  }
  return null;
}

export function unreadable(e: unknown): Error {
  if (e instanceof LuaSyntaxError) {
    const reason = e.message;
    return new Error(t`Coilbox could not read this file: ${reason}`);
  }
  return e instanceof Error ? e : new Error(String(e));
}

/**
 * Each widget's entry in the order table, by name. Entries whose value is not
 * a plain number are left out, because coilbox does not know what they mean.
 * Throws when the file is not a table the handler wrote.
 */
export function readOrder(
  src: string,
  shape: WidgetConfigFile["shape"],
): Map<string, number> {
  try {
    const { order } = orderTable(src, shape);
    const entries = new Map<string, number>();
    for (const f of order?.fields ?? []) {
      const n = numberOf(f.value);
      if (f.key !== null && n !== null) entries.set(f.key, n);
    }
    return entries;
  } catch (e) {
    throw unreadable(e);
  }
}

/** `true` or `false` when the value is that literal, otherwise null. */
export function booleanOf(value: readonly Token[]): boolean | null {
  const [a] = value;
  if (value.length !== 1 || a.kind !== "name") return null;
  if (a.text === "true") return true;
  return a.text === "false" ? false : null;
}

/**
 * A boolean at the top of the file, such as the `allowUserWidgets` the
 * Balanced Annihilation family's handlers save beside their order table (issue
 * #1292). Null when the file has no such entry. Throws when the file is not a
 * table the handler wrote.
 */
export function readFlag(src: string, key: string): boolean | null {
  try {
    const f = field(returnedTable(src), key);
    return f ? booleanOf(f.value) : null;
  } catch (e) {
    throw unreadable(e);
  }
}

/** The fields of the "Local Widgets Config" entry that turn local widgets on,
 *  as Complete Annihilation's and Zero-K's widget of that name saves them. */
const LOCAL_WIDGET_KEYS = [
  "localWidgets",
  "localWidgetsFirst",
  "useLocalWidgets",
  "useLocalWidgetsFirst",
];

/**
 * Whether the "Local Widgets Config" entry of a Complete Annihilation family
 * data file turns local widgets on (issue #1292). Throws when the file is not a
 * table the handler wrote.
 */
export function readLocalWidgets(src: string): boolean {
  try {
    const entry = field(returnedTable(src), "Local Widgets Config")?.table;
    // The last copy of a key is the one Lua keeps.
    return LOCAL_WIDGET_KEYS.some((key) => {
      const f = entry && field(entry, key);
      return !!f && booleanOf(f.value) === true;
    });
  } catch (e) {
    throw unreadable(e);
  }
}

/** A key as `table.save` would never misread it, whatever is in the name. */
function luaKey(name: string): string {
  const escaped = name
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\0/g, "\\0");
  return `["${escaped}"]`;
}

/** The whitespace a line starts with. */
function indentAt(src: string, offset: number): string {
  const lineStart = src.lastIndexOf("\n", offset - 1) + 1;
  return /^[ \t]*/.exec(src.slice(lineStart))?.[0] ?? "";
}

/** `table` with one more field, `key = value`, before its `}`. */
function appendField(
  src: string,
  table: Table,
  entry: (indent: string) => string,
): string {
  const last = table.fields.at(-1);
  const lineStart = src.lastIndexOf("\n", table.close - 1) + 1;
  const closeOnOwnLine = /^[ \t]*$/.test(src.slice(lineStart, table.close));
  const edits: { at: number; text: string }[] = [];
  if (closeOnOwnLine) {
    const indent = last
      ? indentAt(src, last.start)
      : `${indentAt(src, table.close)}\t`;
    edits.push({ at: lineStart, text: `${indent}${entry(indent)},\n` });
  } else {
    edits.push({ at: table.close, text: `${entry("")}, ` });
  }
  // A separator after the last field, when it has none. Pushed after the new
  // field so that, at the same offset, it lands in front of it.
  if (last && !table.trailingSeparator) {
    edits.push({ at: last.valueEnd, text: "," });
  }
  // From the end, so each offset is still right when it is applied. The sort
  // is stable, so of two edits at one offset the first pushed goes in first.
  edits.sort((a, b) => b.at - a.at);
  return edits.reduce(
    (out, { at, text }) => `${out.slice(0, at)}${text}${out.slice(at)}`,
    src,
  );
}

/**
 * The file with one widget's entry set to `value`, and nothing else changed.
 * Throws when the file is not a table the handler wrote.
 */
export function writeOrder(
  src: string,
  shape: WidgetConfigFile["shape"],
  name: string,
  value: number,
): string {
  try {
    const { top, order } = orderTable(src, shape);
    if (!order) {
      // A nested file can be saved with no order yet, as Balanced
      // Annihilation's does when only its user widget option has been set.
      return appendField(
        src,
        top,
        (indent) =>
          `order = {\n${indent}\t${luaKey(name)} = ${value},\n${indent}}`,
      );
    }
    const matches = order.fields.filter((f) => f.key === name);
    if (matches.length === 0) {
      return appendField(src, order, () => `${luaKey(name)} = ${value}`);
    }
    // Every copy of the key, last first so the earlier offsets stay right.
    let out = src;
    for (const f of [...matches].reverse()) {
      out = `${out.slice(0, f.valueStart)}${value}${out.slice(f.valueEnd)}`;
    }
    return out;
  } catch (e) {
    throw unreadable(e);
  }
}

// ---------------------------------------------------------------------------
// The file on disk
// ---------------------------------------------------------------------------

/** The paths `files` name for a game, relative to the write folder. A short
 *  name that would reach outside `LuaUI/Config/` names no file, because it
 *  comes from the game's archive. */
function candidatePaths(
  config: WidgetConfigFile,
  files: readonly string[],
  shortName: string,
): string[] {
  const safe =
    shortName !== "" && !/[/\\]/.test(shortName) && !shortName.includes("..");
  return [
    ...new Set(
      files
        .filter((f) => safe || !/\{short\}/i.test(f))
        .map(
          (f) =>
            `LuaUI/${config.dir ?? "Config"}/${f.replace("{short}", shortName).replace("{SHORT}", shortName.toUpperCase())}`,
        ),
    ),
  ];
}

/** The file names a handler could be using for a game, relative to the write
 *  folder, in the order the handler tries them. */
export function configCandidates(
  config: WidgetConfigFile,
  shortName: string,
): string[] {
  return candidatePaths(config, config.files, shortName);
}

/** The same for the file that holds the widgets' saved `GetConfigData()`
 *  tables, which is the order file itself for a handler that keeps them in its
 *  `data` table. */
export function dataCandidates(
  config: WidgetConfigFile,
  shortName: string,
): string[] {
  return candidatePaths(config, config.dataFiles ?? config.files, shortName);
}

export interface FoundConfig {
  /** The full path of the file. */
  path: string;
  text: string;
}

/** The game's config file and what is in it, or null when it has none yet.
 *  A file that is there and cannot be read throws. */
export async function findConfig(
  io: ConfigFileIO,
  writeDir: string,
  config: WidgetConfigFile,
  shortName: string,
): Promise<FoundConfig | null> {
  return firstFile(io, writeDir, configCandidates(config, shortName));
}

/** The game's file of saved widget settings and what is in it, or null when it
 *  has none yet. A file that is there and cannot be read throws. */
export async function findData(
  io: ConfigFileIO,
  writeDir: string,
  config: WidgetConfigFile,
  shortName: string,
): Promise<FoundConfig | null> {
  return firstFile(io, writeDir, dataCandidates(config, shortName));
}

async function firstFile(
  io: ConfigFileIO,
  writeDir: string,
  relatives: readonly string[],
): Promise<FoundConfig | null> {
  for (const relative of relatives) {
    const path = underConfigDir(writeDir, relative);
    const text = await io.read(path);
    if (text !== null) return { path, text };
  }
  return null;
}

/** Copy `path` to a `.bak` beside it, then write `text` over it. Returns the
 *  copy's path. `before` is what the file held when it was read. */
export async function writeWithBackup(
  io: ConfigFileIO,
  path: string,
  before: string,
  text: string,
  now: Date,
): Promise<string> {
  // Two writes in one second would otherwise share a name, and the second
  // copy would replace the one from before the first.
  let backup = `${path}.${stamp(now)}.bak`;
  for (let n = 2; (await io.read(backup)) !== null; n++) {
    backup = `${path}.${stamp(now)}-${n}.bak`;
  }
  await io.write(backup, before);
  await io.write(path, text);
  return backup;
}

export interface WriteRequest {
  io: ConfigFileIO;
  writeDir: string;
  config: WidgetConfigFile;
  shortName: string;
  /** On or off for each widget, by its `GetInfo().name`. */
  states: ReadonlyMap<string, boolean>;
  /** When this is happening, which names the copy. Passed in so a test can say. */
  now?: Date;
}

export interface WriteOutcome {
  path: string;
  /** Where the file was copied to first, absent when nothing needed writing. */
  backup?: string;
  /** The order table after the change. */
  order: Map<string, number>;
}

/**
 * Give each widget in `states` an on or off entry in the game's config file.
 * Null, with nothing written, when the game has no file yet. Throws before
 * writing anything when the file cannot be read.
 */
export async function writeWidgetStates({
  io,
  writeDir,
  config,
  shortName,
  states,
  now = new Date(),
}: WriteRequest): Promise<WriteOutcome | null> {
  const found = await findConfig(io, writeDir, config, shortName);
  if (!found) return null;
  let text = found.text;
  let order = readOrder(text, config.shape);
  for (const [name, on] of states) {
    const current = order.get(name);
    // A widget already on keeps its place.
    if (current !== undefined && current > 0 === on) continue;
    text = writeOrder(text, config.shape, name, on ? 1 : 0);
    order = readOrder(text, config.shape);
  }
  if (text === found.text) return { path: found.path, order };

  const backup = await writeWithBackup(io, found.path, found.text, text, now);
  return { path: found.path, backup, order };
}
