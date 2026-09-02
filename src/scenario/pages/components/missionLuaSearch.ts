/**
 * Plain-text search over the compiled mission Lua (issue #2282), kept free of
 * React and the DOM so it can be tested without rendering anything and reused
 * by both the find box and the code view that highlights its matches.
 */

/** One occurrence of the query, as a half-open range within a single line. */
export interface LuaMatch {
  /** 0-indexed line the match is on. */
  line: number;
  /** 0-indexed character offset the match starts at, within that line. */
  start: number;
  /** 0-indexed character offset the match ends at (exclusive). */
  end: number;
}

/**
 * Every case-insensitive occurrence of `query` across `lines`, in reading
 * order (top to bottom, left to right within a line). An empty query matches
 * nothing rather than everything, so an empty find box does not light up the
 * whole file. Matches do not overlap: a match is searched for again starting
 * right after the previous one ends, not one character in.
 */
export function findMatches(lines: string[], query: string): LuaMatch[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const matches: LuaMatch[] = [];
  for (let line = 0; line < lines.length; line++) {
    const haystack = lines[line].toLowerCase();
    let from = 0;
    for (;;) {
      const at = haystack.indexOf(needle, from);
      if (at === -1) break;
      matches.push({ line, start: at, end: at + needle.length });
      from = at + needle.length;
    }
  }
  return matches;
}

/**
 * The index into `matches` that comes after `current` (or before it, going
 * backwards), wrapping around either end so stepping never dead-ends. Null
 * in and null out for "no matches", so a caller does not need its own guard.
 */
export function stepMatch(
  matchCount: number,
  current: number | null,
  direction: 1 | -1,
): number | null {
  if (matchCount === 0) return null;
  if (current === null) return direction === 1 ? 0 : matchCount - 1;
  return (current + direction + matchCount) % matchCount;
}
