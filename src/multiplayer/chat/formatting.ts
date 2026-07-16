/**
 * The composer's formatting buttons (issue #283). Pure and React-free so it can
 * be unit-tested; the component owns the textarea and its selection.
 *
 * Everything here emits markup `parseMessage.ts` actually tokenizes - a button
 * that emitted anything else would render as literal text in our own log. That
 * cuts both ways: `>` is a line prefix to the parser, not a pair of markers
 * around a selection, so quoting is a different operation rather than another
 * entry in `FORMAT_MARKER`.
 */

/** The formats the composer can apply to a selection. */
export type Format = "bold" | "italic" | "code" | "strike" | "quote" | "bullet";

/**
 * How a format is applied: `wrap` brackets the selection, `prefix` marks every
 * line it touches. The split is the parser's, not a style choice - `>` and `-`
 * are only markers at the head of a line.
 */
type Rule =
  | { kind: "wrap"; marker: string }
  | { kind: "prefix"; prefix: string };

/** Keyed by every format, so a new one can't be added without saying which it
 * is. `~~` for strike: the parser takes `~x~` too, but the doubled form is the
 * one other clients are most likely to render. */
const FORMAT_RULE: Record<Format, Rule> = {
  bold: { kind: "wrap", marker: "**" },
  italic: { kind: "wrap", marker: "_" },
  code: { kind: "wrap", marker: "`" },
  strike: { kind: "wrap", marker: "~~" },
  quote: { kind: "prefix", prefix: "> " },
  bullet: { kind: "prefix", prefix: "- " },
};

export interface FormatResult {
  value: string;
  /** Selection to restore: the text the format was applied to, or a caret when
   * there was nothing selected to apply it to. */
  start: number;
  end: number;
}

/**
 * A bullet line, split into its indent and marker. Mirrors `parseMessage`'s own
 * bullet rule: a marker only counts at the head of a line, with a space after
 * it.
 */
const BULLET_LINE = /^(\s*)([-+*])\s+/;

/**
 * What to open the next line with to keep a list going, or null when the caret
 * isn't on a bullet line. The composer calls this on Shift+Enter.
 *
 * The marker is the one already on the line rather than our own `-`: a list the
 * user deliberately started with `+` is theirs to keep, and the parser reads a
 * run of mixed markers as one list anyway.
 */
export function listContinuation(value: string, cursor: number): string | null {
  const lineStart = value.lastIndexOf("\n", cursor - 1) + 1;
  const m = BULLET_LINE.exec(value.slice(lineStart, cursor));
  return m ? `${m[1]}${m[2]} ` : null;
}

/** Apply `format` to `[start, end)`. */
export function formatSelection(
  value: string,
  start: number,
  end: number,
  format: Format,
): FormatResult {
  const rule = FORMAT_RULE[format];
  return rule.kind === "prefix"
    ? prefixLines(value, start, end, rule.prefix)
    : wrapSelection(value, start, end, rule.marker);
}

/**
 * Prefix every line the selection touches with `prefix`. Whole lines, because a
 * marker that started mid-line is not a marker to the parser - it reads them at
 * the head of a line or not at all.
 *
 * With nothing selected this prefixes the line the caret is on and carries the
 * caret along with the text, rather than selecting the line: a selection here
 * would be wiped by the next keystroke.
 */
function prefixLines(
  value: string,
  start: number,
  end: number,
  prefix: string,
): FormatResult {
  const from = value.lastIndexOf("\n", start - 1) + 1;
  const next = value.indexOf("\n", end);
  const to = next === -1 ? value.length : next;

  const prefixed = value
    .slice(from, to)
    .split("\n")
    .map((line) => prefix + line)
    .join("\n");
  const prefixedValue = value.slice(0, from) + prefixed + value.slice(to);

  if (start === end) {
    const caret = start + prefix.length;
    return { value: prefixedValue, start: caret, end: caret };
  }
  return { value: prefixedValue, start: from, end: from + prefixed.length };
}

/**
 * Wrap `[start, end)` in `format`'s markers. Whitespace at the edges of the
 * selection is left outside them: `**foo **` is not emphasis to every renderer,
 * and a double-click that catches a trailing space shouldn't produce markup that
 * only works here.
 *
 * An empty selection inserts the marker pair and puts the caret between them, so
 * the button is also a way to start formatted text. A whitespace-only selection
 * has nothing to wrap and falls out of the same rule, as a caret at its end.
 */
function wrapSelection(
  value: string,
  start: number,
  end: number,
  marker: string,
): FormatResult {
  const selected = value.slice(start, end);
  const lead = /^\s*/.exec(selected)?.[0].length ?? 0;
  const trail = /\s*$/.exec(selected)?.[0].length ?? 0;
  const from = start + lead;
  const to = selected.trim() === "" ? from : end - trail;

  const inner = value.slice(from, to);
  const wrapped = `${marker}${inner}${marker}`;
  return {
    value: value.slice(0, from) + wrapped + value.slice(to),
    start: from + marker.length,
    end: from + marker.length + inner.length,
  };
}
