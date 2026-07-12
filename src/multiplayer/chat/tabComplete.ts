/**
 * Nick tab-completion for the chat composer. Pure and store-free so it can be
 * unit-tested and reused by any input. The caller keeps the returned `cycle`
 * and threads it back on the next Tab so repeated Tab walks the match list.
 */

/** State carried between consecutive Tab presses to drive cycling. */
export interface TabCycle {
  /** The partial token the user typed before the first Tab (case preserved). */
  prefix: string;
  /** Candidates matching `prefix`, in the order Tab cycles them. */
  matches: string[];
  /** Index of the currently-inserted match. */
  index: number;
  /** Start offset of the replaced token in the produced value. */
  start: number;
  /** The exact value we produced, used to detect user edits between Tabs. */
  produced: string;
  /** Caret offset in the produced value (end of inserted match + suffix). */
  producedCursor: number;
}

export interface CompleteResult {
  value: string;
  cursor: number;
  cycle: TabCycle;
}

const isBreak = (ch: string) => ch === " " || ch === "\t" || ch === "\n";

/** Offset of the start of the whitespace-delimited token ending at `cursor`. */
function tokenStart(value: string, cursor: number): number {
  let i = cursor;
  while (i > 0 && !isBreak(value[i - 1])) i--;
  return i;
}

/**
 * Complete the nick token at `cursor`. Returns null when there is nothing to
 * complete (empty token or no matching candidate). On a first Tab it inserts the
 * first match; when `prev` describes the value we last produced (i.e. the user
 * hasn't edited since), it advances to the next match, wrapping around.
 *
 * A token at the very start of the input gets a `": "` suffix (IRC address
 * convention); elsewhere a single space.
 */
export function completeNick(
  value: string,
  cursor: number,
  candidates: string[],
  prev: TabCycle | null,
): CompleteResult | null {
  const cycling = prev != null && prev.produced === value;

  let start: number;
  let prefix: string;
  let matches: string[];
  let index: number;
  let replaceEnd: number;

  if (cycling && prev.matches.length > 0) {
    start = prev.start;
    prefix = prev.prefix;
    matches = prev.matches;
    index = (prev.index + 1) % matches.length;
    replaceEnd = prev.producedCursor;
  } else {
    start = tokenStart(value, cursor);
    prefix = value.slice(start, cursor);
    if (prefix === "") return null;
    const lower = prefix.toLowerCase();
    matches = candidates
      .filter((c) => c.toLowerCase().startsWith(lower))
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
    if (matches.length === 0) return null;
    index = 0;
    replaceEnd = cursor;
  }

  const match = matches[index];
  const suffix = start === 0 ? ": " : " ";
  const newValue =
    value.slice(0, start) + match + suffix + value.slice(replaceEnd);
  const newCursor = start + match.length + suffix.length;

  return {
    value: newValue,
    cursor: newCursor,
    cycle: {
      prefix,
      matches,
      index,
      start,
      produced: newValue,
      producedCursor: newCursor,
    },
  };
}
