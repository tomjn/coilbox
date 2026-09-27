/**
 * Split a chat line into plain and matched segments, so a caller can render
 * the matched ones as a highlighted player name (issue #3189). Pure and
 * hook-free: the caller decides how a match is drawn.
 */

export interface NameSegment {
  text: string;
  /** The name this segment matched, if any. Equal to `text` when set. */
  name?: string;
}

/** Escape a name for use inside a regex alternation. */
function escapeForRegex(name: string): string {
  return name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Split `text` on whole-word occurrences of any name in `names`. The
 * boundary check is against alphanumeric/underscore rather than `\b`, so a
 * clan-tagged name like `[RoX]pintle` still matches right up to the bracket,
 * and a short name never lights up inside a longer word or username (`Rox`
 * inside `Roxanne`). Names are tried longest first so one name can't shadow
 * a longer name that contains it. Returns `[{ text }]` unchanged when
 * `names` is empty or nothing matches.
 */
export function splitOnNames(text: string, names: string[]): NameSegment[] {
  const unique = [...new Set(names.filter((n) => n.length > 0))].sort(
    (a, b) => b.length - a.length,
  );
  if (unique.length === 0) return [{ text }];

  const pattern = unique.map(escapeForRegex).join("|");
  const re = new RegExp(`(?<![A-Za-z0-9_])(?:${pattern})(?![A-Za-z0-9_])`, "g");

  const segments: NameSegment[] = [];
  let cursor = 0;
  for (const match of text.matchAll(re)) {
    const start = match.index ?? 0;
    if (start > cursor) segments.push({ text: text.slice(cursor, start) });
    segments.push({ text: match[0], name: match[0] });
    cursor = start + match[0].length;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor) });
  return segments.length > 0 ? segments : [{ text }];
}
