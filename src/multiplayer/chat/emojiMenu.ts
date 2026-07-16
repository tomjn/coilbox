/**
 * `:`-triggered emoji autocomplete and `:shortcode:` substitution for the chat
 * composer (issue #283). Pure and React-free, mirroring `mentionMenu.ts`: the
 * component owns the menu, the caret and the selection index.
 */

import type { EmojiEntry } from "./emoji";

/** Shortcode charset, matching what the iamcal preset actually uses. */
const CODE = "a-z0-9_+-";

/**
 * How much must follow the `:` before the menu opens. A colon is far too common
 * in ordinary chat to open a menu on its own - `12:30`, `note:`, `:)` - so the
 * menu waits for enough of a query to be worth showing.
 */
export const MIN_EMOJI_QUERY = 2;

/** How many matches the menu offers. `:a` alone matches hundreds; a popup is not
 * a place to scroll through them. The picker searches the same way but shows a
 * grid, so it asks for more. */
export const MAX_EMOJI_MATCHES = 10;

/** The `:` token the caret sits in, if any. */
export interface EmojiQuery {
  /** Offset of the `:` itself. */
  start: number;
  /** Text typed after the `:`, up to the caret. */
  query: string;
}

/**
 * The shortcode being typed at `cursor`, or null when the caret isn't inside one
 * that is long enough to search on. As with mentions, a `:` preceded by a word
 * character doesn't open a menu, so a time (`12:30`) or a URL (`http://x`) never
 * triggers it.
 */
export function emojiQuery(value: string, cursor: number): EmojiQuery | null {
  const run = new RegExp(`[${CODE}]*$`).exec(value.slice(0, cursor));
  const query = run?.[0] ?? "";
  const colon = cursor - query.length - 1;
  if (value[colon] !== ":") return null;
  if (colon > 0 && /[\w:]/.test(value[colon - 1])) return null;
  if (query.length < MIN_EMOJI_QUERY) return null;
  return { start: colon, query };
}

/**
 * Entries whose shortcode matches `query`, prefix matches first then substring
 * matches, so `:smi` reaches `smile` before `persevere` (`:smiling_imp`'s
 * neighbour). Each group is ordered by shortcode length then alphabetically, so
 * the plainest name - the one the user most likely means - leads.
 */
export function emojiMatches(
  query: string,
  entries: EmojiEntry[],
  limit: number = MAX_EMOJI_MATCHES,
): EmojiEntry[] {
  const q = query.toLowerCase();
  const prefix: [string, EmojiEntry][] = [];
  const infix: [string, EmojiEntry][] = [];
  for (const entry of entries) {
    // Rank an entry by its best-matching shortcode, not its primary one, so an
    // alias (`:hankey:` for `:poop:`) still finds it.
    const hit = entry.shortcodes.find((c) => c.startsWith(q));
    if (hit) prefix.push([hit, entry]);
    else {
      const loose = entry.shortcodes.find((c) => c.includes(q));
      if (loose) infix.push([loose, entry]);
    }
  }
  const byCode = (a: [string, EmojiEntry], b: [string, EmojiEntry]) =>
    a[0].length - b[0].length || a[0].localeCompare(b[0]);
  return [...prefix.sort(byCode), ...infix.sort(byCode)]
    .slice(0, limit)
    .map(([, entry]) => entry);
}

export interface EmojiInsert {
  value: string;
  cursor: number;
}

/**
 * Replace `[start, end)` with `unicode`. No trailing space: unlike a mention,
 * emoji are routinely run together (`🎉🎉`), and one is easier to type than to
 * delete.
 */
export function applyEmoji(
  value: string,
  start: number,
  end: number,
  unicode: string,
): EmojiInsert {
  return {
    value: value.slice(0, start) + unicode + value.slice(end),
    cursor: start + unicode.length,
  };
}

/** A `:name:` the caret has just closed. */
export interface ClosedShortcode {
  start: number;
  name: string;
}

/**
 * The complete `:name:` ending at `cursor`, or null. This is the other half of
 * substitution: the menu covers picking a shortcode from a partial one, this
 * covers typing a whole one out (`:tada:`) and never looking at the menu.
 *
 * The caller checks the name against the dataset - an unknown `:name:` is left
 * exactly as typed rather than eaten.
 */
export function closedShortcode(
  value: string,
  cursor: number,
): ClosedShortcode | null {
  if (value[cursor - 1] !== ":") return null;
  const m = new RegExp(`:([${CODE}]+):$`).exec(value.slice(0, cursor));
  if (!m) return null;
  const start = cursor - m[0].length;
  if (start > 0 && /[\w:]/.test(value[start - 1])) return null;
  return { start, name: m[1] };
}
