/**
 * Selection wrapping for the composer's formatting buttons (issue #283). Pure and
 * React-free so it can be unit-tested; the component owns the textarea and its
 * selection.
 *
 * The markers are the ones `parseMessage.ts` actually tokenizes - a button that
 * emitted anything else would render as literal text in our own log.
 */

/** The formats the composer can wrap a selection in. */
export type Format = "bold" | "italic" | "code";

export const FORMAT_MARKER: Record<Format, string> = {
  bold: "**",
  italic: "_",
  code: "`",
};

export interface FormatResult {
  value: string;
  /** Selection to restore: the wrapped text, or the caret between the markers
   * when there was nothing selected. */
  start: number;
  end: number;
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
export function wrapSelection(
  value: string,
  start: number,
  end: number,
  format: Format,
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
