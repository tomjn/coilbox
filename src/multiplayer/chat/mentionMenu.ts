/**
 * `@`-triggered mention autocomplete for the chat composer (issue #279). Pure and
 * React-free so it can be unit-tested and reused by any input; the component owns
 * the menu, the caret and the selection index.
 *
 * The nick charset mirrors `parseMessage.ts` so anything this menu inserts is
 * something the renderer will tokenize as a mention.
 */

const NICK = "A-Za-z0-9_[\\]{}|^\\\\-";

/** The `@` token the caret sits in, if any. */
export interface MentionQuery {
  /** Offset of the `@` itself. */
  start: number;
  /** Text typed after the `@`, up to the caret (empty for a bare `@`). */
  query: string;
}

/**
 * The mention being typed at `cursor`, or null when the caret isn't inside one.
 * As in `parseMessage`, a `@` preceded by a word char or another `@` doesn't
 * open a mention, so an email local part (`a@b`) never triggers the menu.
 */
export function mentionQuery(
  value: string,
  cursor: number,
): MentionQuery | null {
  const run = new RegExp(`[${NICK}]*$`).exec(value.slice(0, cursor));
  const query = run?.[0] ?? "";
  const at = cursor - query.length - 1;
  if (value[at] !== "@") return null;
  if (at > 0 && /[\w@]/.test(value[at - 1])) return null;
  return { start: at, query };
}

/**
 * Candidates matching `query`, prefix matches first (what the user most likely
 * means) then substring matches, so typing `@bob` still reaches a clan-tagged
 * `[ABC]bob`. Each group is sorted case-insensitively; an empty query lists all.
 */
export function mentionMatches(query: string, candidates: string[]): string[] {
  const q = query.toLowerCase();
  const byName = (a: string, b: string) =>
    a.localeCompare(b, undefined, { sensitivity: "base" });
  const prefix: string[] = [];
  const infix: string[] = [];
  for (const c of candidates) {
    const lower = c.toLowerCase();
    if (lower.startsWith(q)) prefix.push(c);
    else if (q && lower.includes(q)) infix.push(c);
  }
  return [...prefix.sort(byName), ...infix.sort(byName)];
}

export interface MentionInsert {
  value: string;
  cursor: number;
}

/**
 * Replace the `@` token spanning `[start, end)` with `@name`, leaving the caret
 * after a single trailing space (none added when one already follows).
 */
export function applyMention(
  value: string,
  start: number,
  end: number,
  name: string,
): MentionInsert {
  const suffix = /\s/.test(value[end] ?? "") ? "" : " ";
  const inserted = `@${name}${suffix}`;
  return {
    value: value.slice(0, start) + inserted + value.slice(end),
    cursor: start + inserted.length,
  };
}
