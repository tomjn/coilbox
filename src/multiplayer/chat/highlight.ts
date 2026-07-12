/**
 * Highlight-word matching for chat (issue #193). A message is "highlighted" when
 * it mentions one of the user's configured highlight words, or their own username
 * (toggleable). Kept pure and store-free so it can be unit-tested and reused by the
 * ChatPane predicate, the DM/channel views, and the mention cue in the store.
 */

/** Persisted settings keys (frame settings store). */
export const HIGHLIGHT_WORDS_KEY = "multiplayer.highlight.words";
export const HIGHLIGHT_OWN_KEY = "multiplayer.highlight.ownUsername";
export const HIGHLIGHT_SOUND_KEY = "multiplayer.highlight.sound";

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Whole-word, case-insensitive match of `term` within `lowerText` (already
 * lowercased). "Word" boundaries are non-alphanumeric-underscore, so `alice`
 * matches "hi alice!" but not "malice"; terms with punctuation (e.g. `[bot]foo`)
 * still match since only their alnum edges need a boundary.
 */
function wordMatch(lowerText: string, lowerTerm: string): boolean {
  const re = new RegExp(
    `(?:^|[^a-z0-9_])${escapeRegex(lowerTerm)}(?:$|[^a-z0-9_])`,
  );
  return re.test(lowerText);
}

/**
 * Whether `text` mentions any highlight `words`, plus `ownName` when `ownEnabled`.
 * Empty/whitespace words are ignored; matching is case-insensitive and whole-word.
 */
export function matchesHighlight(
  text: string,
  words: string[],
  ownName: string | null,
  ownEnabled: boolean,
): boolean {
  const targets: string[] = [];
  for (const w of words) {
    const t = w.trim();
    if (t) targets.push(t.toLowerCase());
  }
  if (ownEnabled && ownName?.trim()) targets.push(ownName.trim().toLowerCase());
  if (targets.length === 0) return false;

  const lower = text.toLowerCase();
  return targets.some((t) => wordMatch(lower, t));
}
