/**
 * What a map is like, in words, for a map nobody here has installed
 * (issue #1738).
 *
 * `src/hub/assets/mapFacts.ts` did this from Beyond All Reason's map list and
 * went with the rest of their hosted content in #1729. These are the same two
 * captions read off the hub's own catalog instead, which is filled by whoever
 * does hold the archive.
 *
 * Size and player count are the two that were lost and the two somebody picking
 * a map asks about first. The rest of what the lookup answers, the wind, the
 * tidal strength, the water share and the tag list, is on the same record and
 * can follow.
 */

import { mapSizeLabel as sizeLabel } from "@/content/pages/components/MapThumb";
import { ELMOS_PER_METAL_SAMPLE } from "../assets/vocabulary";
import type { MapFacts } from "./lookup";

/**
 * The map's extent in the metal infomap samples the rest of the app measures a
 * map in, which is what `MapItem.width` and `MapItem.height` hold.
 *
 * The catalog stores elmos, because a coordinate is in elmos and a sample count
 * is a grid rather than a length (issue #1629). Converting here rather than
 * teaching every screen a second unit is what lets a hub answer feed a card
 * built for a local one.
 */
export function mapSampleExtent(
  facts: MapFacts | null | undefined,
): { width: number; height: number } | null {
  if (!facts?.width_elmos || !facts?.height_elmos) return null;
  return {
    width: Math.round(facts.width_elmos / ELMOS_PER_METAL_SAMPLE),
    height: Math.round(facts.height_elmos / ELMOS_PER_METAL_SAMPLE),
  };
}

/**
 * How big the map is, in the squares players count in.
 *
 * The same formatter every other screen uses, handed the same unit, rather than
 * a second one that divides elmos by 512 and drifts from it.
 */
export function mapSizeLabel(
  facts: MapFacts | null | undefined,
): string | null {
  const extent = mapSampleExtent(facts);
  return extent ? sizeLabel(extent.width, extent.height) : null;
}

/**
 * How many players the map is drawn for, which is how many start positions it
 * places.
 *
 * The old caption gave Beyond All Reason's published range, which the catalog
 * does not carry. What it carries is better in one way and worse in another:
 * this is the map's own answer rather than a lobby's convention, and it is a
 * single number rather than a range. A map that places none says nothing, which
 * is every map with no `mapinfo.lua` to place them in.
 */
export function mapPlayersLabel(
  facts: MapFacts | null | undefined,
): string | null {
  const starts = facts?.points?.start?.length ?? 0;
  if (starts < 1) return null;
  return `${starts} player${starts === 1 ? "" : "s"}`;
}

/** Size and player count as one line, or null when the hub can say neither. */
export function mapFactsLabel(
  facts: MapFacts | null | undefined,
): string | null {
  const said = [mapSizeLabel(facts), mapPlayersLabel(facts)].filter(Boolean);
  return said.length > 0 ? said.join(" · ") : null;
}

/** The name the hub files the map under, for a caller that has only the spring
 *  name. Null rather than the spring name, so a caller decides its own
 *  fallback. */
export function mapDisplayName(
  facts: MapFacts | null | undefined,
): string | null {
  const name = facts?.display_name?.trim();
  return name ? name : null;
}
