import type { BrandingEntry, SuggestedGame } from "./branding";

/**
 * Narrow suggested games to a distribution's `gameFilter` so a single-game
 * distribution never advertises other games' downloads on the welcome card. A
 * suggestion is kept when the matcher matches its `title` or any canonical name on
 * the branding entry it references (`entryId` -> `match.names`). A `null` matcher
 * (no `gameFilter`) keeps every suggestion, so vanilla Coilbox is unaffected.
 *
 * Pure and free of the plugin-command imports in `branding.ts`/`profile.ts` so it
 * stays unit-testable (the caller injects the matcher from `getGameMatcher()`).
 */
export function filterSuggestedGamesByFilter(
  suggestions: SuggestedGame[],
  entries: BrandingEntry[],
  matcher: ((name: string) => boolean) | null,
): SuggestedGame[] {
  if (!matcher) return suggestions;
  return suggestions.filter((g) => {
    const entry = g.entryId
      ? entries.find((e) => e.id === g.entryId)
      : undefined;
    const names = [g.title, ...(entry?.match.names ?? [])];
    return names.some((n) => matcher(n));
  });
}
