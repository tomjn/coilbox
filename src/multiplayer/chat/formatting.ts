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
export type Format = "bold" | "italic" | "code" | "quote";

/** The inline formats, and the markers that bracket them. */
const FORMAT_MARKER: Record<Exclude<Format, "quote">, string> = {
  bold: "**",
  italic: "_",
  code: "`",
};

/** What `parseBlocks` reads as a quoted line. */
const QUOTE_PREFIX = "> ";

export interface FormatResult {
  value: string;
  /** Selection to restore: the text the format was applied to, or a caret when
   * there was nothing selected to apply it to. */
  start: number;
  end: number;
}

/** Apply `format` to `[start, end)`. */
export function formatSelection(
  value: string,
  start: number,
  end: number,
  format: Format,
): FormatResult {
  return format === "quote"
    ? quoteLines(value, start, end)
    : wrapSelection(value, start, end, format);
}

/**
 * Prefix every line the selection touches with `> `. Whole lines, because a
 * quote that started mid-line is not a quote to the parser - it reads the marker
 * at the head of a line or not at all.
 *
 * With nothing selected this quotes the line the caret is on and carries the
 * caret along with the text, rather than selecting the line: a selection here
 * would be wiped by the next keystroke.
 */
function quoteLines(value: string, start: number, end: number): FormatResult {
  const from = value.lastIndexOf("\n", start - 1) + 1;
  const next = value.indexOf("\n", end);
  const to = next === -1 ? value.length : next;

  const quoted = value
    .slice(from, to)
    .split("\n")
    .map((line) => QUOTE_PREFIX + line)
    .join("\n");
  const quotedValue = value.slice(0, from) + quoted + value.slice(to);

  if (start === end) {
    const caret = start + QUOTE_PREFIX.length;
    return { value: quotedValue, start: caret, end: caret };
  }
  return { value: quotedValue, start: from, end: from + quoted.length };
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
  format: Exclude<Format, "quote">,
): FormatResult {
  const marker = FORMAT_MARKER[format];
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
