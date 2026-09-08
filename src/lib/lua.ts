/**
 * Writing Lua source out of JavaScript values.
 *
 * Two callers, for two different reasons. The scenario compiler builds a
 * mission from an intermediate tree it controls, and only needs the pieces that
 * quote a string and decide whether a key can be written bare. The unit page
 * has the opposite problem (issue #2695): a table it did not build, decoded out
 * of a game's own Lua, which has to be printed back as Lua so a modder reading
 * it here and reading the game's file sees the same syntax.
 *
 * This module is deliberately plugin-neutral. `src/lego/unitDef.ts` keeps its
 * own copy of `luaString` with a comment saying it does so to avoid importing
 * the scenario editor's dependency graph, which is a good reason that no longer
 * applies to anything here. Left alone rather than folded in, since that is
 * someone else's file and someone else's decision.
 */

/** Escapes for characters that cannot appear raw in a quoted Lua string. */
const ESCAPES: Record<string, string> = {
  "\\": "\\\\",
  '"': '\\"',
  "\n": "\\n",
  "\r": "\\r",
  "\t": "\\t",
};

/**
 * Quote a string as a Lua literal. Scenario names, dialogue text and a game's
 * own def values all go straight into Lua source, so this has to hold for
 * anything: a quote or backslash would end the literal, and a raw newline is a
 * syntax error in a short string.
 *
 * Remaining control characters become three-digit `\ddd` escapes. The three
 * digits are not optional padding. `\0` followed by the character `5` would
 * otherwise read back as byte 5.
 *
 * Anything above ASCII is left alone. Lua strings are byte strings and the file
 * is written as UTF-8, so the bytes survive the round trip unchanged, which is
 * what a non-English mission needs.
 */
export function luaString(value: string): string {
  const body = value.replace(
    // biome-ignore lint/suspicious/noControlCharactersInRegex: escaping them is the point
    /[\\"\n\r\t\x00-\x1f\x7f]/g,
    (ch) => ESCAPES[ch] ?? `\\${ch.charCodeAt(0).toString().padStart(3, "0")}`,
  );
  return `"${body}"`;
}

/** Lua's reserved words, which cannot be used as a bare table key. */
const KEYWORDS = new Set([
  "and",
  "break",
  "do",
  "else",
  "elseif",
  "end",
  "false",
  "for",
  "function",
  "if",
  "in",
  "local",
  "nil",
  "not",
  "or",
  "repeat",
  "return",
  "then",
  "true",
  "until",
  "while",
]);

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Whether `key` can be written as a bare table key rather than a bracketed
 *  one. Not cosmetic: `repeat` is both a Lua keyword and a real field name. */
export const isLuaIdentifier = (key: string): boolean =>
  IDENTIFIER.test(key) && !KEYWORDS.has(key);

/** A key that JavaScript turned into a string but Lua indexes as a number, so
 *  it has to be written `[1]` and not `["1"]`, which is a different key. */
const INTEGER_KEY = /^(0|-?[1-9][0-9]{0,14})$/;

/**
 * One key of a table decoded from Lua. A bare identifier where Lua allows it, a
 * number in brackets where the key is an integer, and a quoted string in
 * brackets for everything else.
 *
 * The integer case is the one that matters. A JavaScript object cannot hold a
 * numeric key, so a Lua table indexed by number arrives here with string keys,
 * and writing `["1"]` would silently produce a table the engine reads
 * differently from the one the game wrote.
 */
function tableKey(key: string): string {
  if (isLuaIdentifier(key)) return key;
  if (INTEGER_KEY.test(key)) return `[${key}]`;
  return `[${luaString(key)}]`;
}

/**
 * A number as Lua source.
 *
 * `Infinity` and `NaN` are not Lua literals, so they are written as the
 * expressions Lua produces them from. Neither survives JSON, so neither should
 * reach here from the unitsync worker, but printing `Infinity` into something
 * labelled Lua would be a lie about what the game holds.
 */
function luaNumberLiteral(value: number): string {
  if (Number.isNaN(value)) return "0/0";
  if (value === Number.POSITIVE_INFINITY) return "math.huge";
  if (value === Number.NEGATIVE_INFINITY) return "-math.huge";
  return String(value);
}

/** Indent per level. Spaces rather than the tabs Balanced Annihilation's own
 *  unit files use, because a tab in a browser is eight columns wide by default
 *  and the value is the same Lua either way. */
const INDENT = "  ";

/** Width at which a table of nothing but scalars stays on one line. The same
 *  rule and the same number the scenario compiler uses, so Lua coilbox writes
 *  reads the same wherever it is written. */
const INLINE_WIDTH = 60;

const isTable = (
  value: unknown,
): value is Record<string, unknown> | unknown[] =>
  typeof value === "object" && value !== null;

/**
 * A JavaScript value as a Lua literal, one table entry per line.
 *
 * Written to match what games actually write. Checked against Balanced
 * Annihilation's `units/armcom.lua` and Beyond All Reason's `units/corak.lua`:
 * bare keys, double quoted strings, a trailing comma on every entry including
 * the last, and nested tables indented under their key.
 *
 * An array is written with its indices, `[1] = "armsolar"`, rather than as a
 * positional list. Both games write their sequences that way, BA in
 * `buildoptions` and BAR in `weapons`, and on a list of twenty build options
 * the index is worth having.
 *
 * Key order is whatever the object arrived in. For a unit definition that is
 * alphabetical already: the worker builds it as `serde_json::Map`, which is a
 * `BTreeMap` unless the `preserve_order` feature is on, and it is not.
 */
export function luaLiteral(value: unknown, indent = ""): string {
  if (value === undefined || value === null) return "nil";
  if (typeof value === "boolean") return String(value);
  if (typeof value === "number") return luaNumberLiteral(value);
  if (typeof value === "bigint") return String(value);
  if (typeof value === "string") return luaString(value);
  if (!isTable(value)) return luaString(String(value));

  const inner = indent + INDENT;
  const entries: [string, unknown][] = Array.isArray(value)
    ? value.map((item, i) => [String(i + 1), item])
    : Object.entries(value);
  if (entries.length === 0) return "{}";

  const parts = entries.map(
    ([key, item]) => `${tableKey(key)} = ${luaLiteral(item, inner)}`,
  );

  // A collision volume or a colour reads far better on one line than as four.
  const inline = `{ ${parts.join(", ")} }`;
  if (
    entries.every(([, item]) => !isTable(item)) &&
    inline.length + indent.length <= INLINE_WIDTH
  ) {
    return inline;
  }

  return `{\n${parts.map((part) => `${inner}${part},`).join("\n")}\n${indent}}`;
}
