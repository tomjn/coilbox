import {
  isGeneratedGame,
  withoutGeneratedGames,
} from "../../../lib/generatedGames";
import {
  filterUninstalledGames,
  filterUninstalledMaps,
  type SuggestedGame,
  type SuggestedMap,
} from "../../branding";

type BrandingEntries = Parameters<typeof filterUninstalledGames>[1];
type ScannedGames = Parameters<typeof filterUninstalledGames>[3];
type ScannedMaps = Parameters<typeof filterUninstalledMaps>[2];

/** A resolved unitsync inventory: what the engine can actually see. */
export interface ScannedContent {
  games: ScannedGames;
  maps: ScannedMaps;
}

/**
 * How many maps the player has, as the best lower bound the two readings give.
 *
 * Not a sum. The file listing counts archives in `maps/` and the scan counts
 * what the engine can see, and the same map is in both under two different
 * names, so adding them would count most maps twice. Each on its own is a lower
 * bound: the listing misses a map installed outside a content root, and the scan
 * misses an archive dropped in since it last ran. The larger is the better
 * bound, and both err downwards, which is the safe direction for a gate that
 * decides whether to keep offering.
 */
export function installedMapCount(input: {
  installed: { maps: Set<string> };
  scanned: { maps: ScannedMaps };
}): number {
  return Math.max(input.scanned.maps.length, input.installed.maps.size);
}

/**
 * How many maps the player needs before the offer stands down.
 *
 * The offer used to end at one, and issue #1116 is what that costs: download a
 * map, go and look at it, come back, and the list of the other five is gone.
 * Widening the window it is held for would only move that wall further out, so
 * the rule is about the player's library instead. The offer stands until it has
 * done its job rather than until it has been used once.
 *
 * Three, because one map is not a library. Every skirmish is on it and there is
 * nothing to pick when you tire of it, which is the whole of "the player wanted
 * more than one map". Two is a choice and three is a rotation. Past three, a
 * thin library is no longer a first-run problem and the Maps page is the better
 * place to fix it than a card on the welcome screen.
 *
 * Games keep the old rule of one, and the asymmetry is the point. A game is the
 * whole ruleset and you play one at a time, so a second game is a
 * multi-gigabyte download for a different game rather than more of the one you
 * already have.
 */
export const MAPS_ENOUGH = 3;

/**
 * The `GetStartedCard` offer decision, or `null` while the question can't be
 * answered yet. Games are offered while the user has none, and maps while the
 * user has fewer than {@link MAPS_ENOUGH}.
 *
 * Both inputs are nullable on purpose, and `null` means "unknown", never
 * "empty". A caller that turns a not-yet-loaded content root, or a unitsync scan
 * that errored, into an empty inventory reads a mature install as a first run
 * and offers downloads the user already has.
 *
 * unitsync is the authority for both kinds: rapid games live in `packages/`+
 * `pool/` and never appear as an archive in `games/`. The file listing rides
 * alongside it to catch an archive dropped in since the cached scan ran.
 *
 * The list of maps this returns is always live, so a map the player has is
 * never in it. Holding it steady while a reader is looking at it is a separate
 * job done by a separate mechanism, the per-visit snapshot in
 * {@link ../../getStartedOffer}. Keeping the two apart is what lets the offer
 * survive a revisit without a download vanishing from under the click that
 * started it.
 */
export function getStartedCandidates(input: {
  installed: { games: Set<string>; maps: Set<string> } | null;
  scanned: ScannedContent | null;
  scopedGames: SuggestedGame[];
  entries: BrandingEntries;
  suggestedMaps: SuggestedMap[];
}): { games: SuggestedGame[]; maps: SuggestedMap[] } | null {
  const { installed, scanned, scopedGames, entries, suggestedMaps } = input;
  if (!installed || !scanned) return null;
  // Coilbox's own generated games are not the user's content. An install whose
  // only game is the one the unit builder or the scenario editor wrote is still
  // a first run, and is still owed the offer.
  const scannedGames = withoutGeneratedGames(scanned.games);
  const installedGames = new Set(
    [...installed.games].filter((name) => !isGeneratedGame(name)),
  );
  const hasGames = scannedGames.length > 0 || installedGames.size > 0;
  const enoughMaps = installedMapCount({ installed, scanned }) >= MAPS_ENOUGH;
  return {
    games: hasGames
      ? []
      : filterUninstalledGames(
          scopedGames,
          entries,
          installedGames,
          scannedGames,
        ),
    maps: enoughMaps
      ? []
      : filterUninstalledMaps(suggestedMaps, installed.maps, scanned.maps),
  };
}
