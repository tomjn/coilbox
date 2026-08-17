/**
 * What BAR's map list says about a map in words, for the caption under a picture
 * of it (issue #1721).
 *
 * A setup pack used to list its maps by name alone, which says nothing about
 * what playing on one is like. Size and how many players it is drawn for are
 * both on the entry the picture already comes from, so they cost nothing to say
 * and are the two things somebody picking a map asks about first.
 *
 * The website says size and the team shapes BAR lays start boxes out for, e.g.
 * `12 x 20 · 8v8` (`lib/gallery/mapFacts.ts` in tomjn/coilbox-hub). The boxes do
 * not reach this side: `BarMap` in `@/downloads/bindings` carries no
 * `startboxesSet`, and widening the Rust binding to pass them through buys one
 * line of a caption. The player range is on the binding already and says much
 * the same thing about the size of game a map is for.
 *
 * Only BAR's own numbers. A map it does not certify has neither, and the card is
 * then the name alone rather than a guess.
 */

import type { BarMap } from "@/downloads/bindings";

/** How big the map is, in the 512 elmo squares Spring counts in and players
 * quote: BAR's list gives a 6144 by 10240 elmo map as 12 by 20. Null when its
 * entry gives no size. Punctuated the way `downloads/pages/MapsPage.tsx` writes
 * the same fact, since both are captions under a map in this app. */
export function mapSizeLabel(map: BarMap | null | undefined): string | null {
  if (!map?.mapWidth || !map?.mapHeight) return null;
  return `${map.mapWidth} × ${map.mapHeight}`;
}

/**
 * How many players the map is drawn for, as BAR lists it.
 *
 * A range where the two ends differ, one number where they agree, and whichever
 * end BAR gives when it gives only one. A map with neither says nothing.
 */
export function mapPlayersLabel(map: BarMap | null | undefined): string | null {
  const min = map?.playerCountMin;
  const max = map?.playerCountMax;
  if (min && max && min !== max) return `${min}–${max} players`;
  const one = max ?? min;
  return one ? `${one} player${one === 1 ? "" : "s"}` : null;
}

/** Size and player count as one line, or null when BAR says neither. */
export function mapFactsLabel(map: BarMap | null | undefined): string | null {
  const facts = [mapSizeLabel(map), mapPlayersLabel(map)].filter(Boolean);
  return facts.length > 0 ? facts.join(" · ") : null;
}
