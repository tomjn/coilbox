/**
 * Turn a `JSON.parse` failure into a human-locatable pointer: a line/column and a
 * short source excerpt with a caret under the offending character.
 *
 * Engines disagree on the message wording, so we read whatever location they give
 * and compute the rest from the raw text ourselves:
 * - V8 / WebView2 (Windows): `... in JSON at position 992 (line 13 column 3)`
 * - Older V8:                `... in JSON at position 992`
 * - JavaScriptCore (WKWebView / WebKitGTK, macOS+Linux): no position at all.
 *
 * When no location can be recovered (JSC), {@link locateJsonError} returns `null`
 * and callers fall back to the bare engine message.
 */

export interface JsonErrorLocation {
  /** 0-based character offset into the source text. */
  position: number;
  /** 1-based line number. */
  line: number;
  /** 1-based column number. */
  column: number;
}

/** Character offset → 1-based line/column, counting `\n` as the line break. */
function lineColOf(
  text: string,
  position: number,
): { line: number; column: number } {
  let line = 1;
  let lineStart = 0;
  const end = Math.min(position, text.length);
  for (let i = 0; i < end; i++) {
    if (text.charCodeAt(i) === 10 /* \n */) {
      line += 1;
      lineStart = i + 1;
    }
  }
  return { line, column: end - lineStart + 1 };
}

/** 1-based line/column → character offset (best effort; clamps to bounds). */
function positionOf(text: string, line: number, column: number): number {
  const lines = text.split("\n");
  let offset = 0;
  for (let i = 0; i < line - 1 && i < lines.length; i++) {
    offset += lines[i].length + 1; // +1 for the consumed \n
  }
  return offset + Math.max(0, column - 1);
}

/**
 * Recover the error location from a `JSON.parse` error message plus the source text.
 * Prefers the engine's explicit `position`; falls back to `line/column` wording;
 * returns `null` when the message carries neither (so callers show the raw message).
 */
export function locateJsonError(
  text: string,
  message: string,
): JsonErrorLocation | null {
  const pos = message.match(/position (\d+)/i);
  if (pos) {
    const position = Number(pos[1]);
    return { position, ...lineColOf(text, position) };
  }
  const lc = message.match(/line (\d+) column (\d+)/i);
  if (lc) {
    const line = Number(lc[1]);
    const column = Number(lc[2]);
    return { line, column, position: positionOf(text, line, column) };
  }
  return null;
}

/**
 * A monospace excerpt of `text` around `loc`: the offending line (plus the line
 * before it for context) with a numbered gutter, then a caret line pointing at the
 * failing column. Designed to render in a `<pre>` — the gutter widths line up so the
 * caret sits under the character the parser choked on.
 */
export function jsonErrorSnippet(text: string, loc: JsonErrorLocation): string {
  const lines = text.split("\n");
  const errIdx = loc.line - 1;
  const firstIdx = Math.max(0, errIdx - 1);
  const gutterWidth = String(loc.line).length;
  const out: string[] = [];
  for (let i = firstIdx; i <= errIdx && i < lines.length; i++) {
    const num = String(i + 1).padStart(gutterWidth);
    out.push(`${num} | ${lines[i]}`);
  }
  const caretIndent = `${" ".repeat(gutterWidth)} | ${" ".repeat(Math.max(0, loc.column - 1))}`;
  out.push(`${caretIndent}^`);
  return out.join("\n");
}

/**
 * One-shot: given the source text and an error, produce `{ message, snippet }` where
 * `snippet` is present only when a location could be recovered. `message` is a tidy
 * one-liner (`Line 13, column 3: <engine message>`) when located, else the raw message.
 */
export function describeJsonError(
  text: string,
  error: unknown,
): { message: string; snippet?: string } {
  const raw = error instanceof Error ? error.message : String(error);
  const loc = locateJsonError(text, raw);
  if (!loc) return { message: raw };
  return {
    message: `Line ${loc.line}, column ${loc.column}: ${raw}`,
    snippet: jsonErrorSnippet(text, loc),
  };
}
