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
 * The `GetStartedCard` offer decision, or `null` while the question can't be
 * answered yet. Each kind is only offered while the user has none of that kind.
 *
 * Both inputs are nullable on purpose, and `null` means "unknown", never
 * "empty". A caller that turns a not-yet-loaded content root, or a unitsync scan
 * that errored, into an empty inventory reads a mature install as a first run
 * and offers downloads the user already has.
 *
 * unitsync is the authority for both kinds: rapid games live in `packages/`+
 * `pool/` and never appear as an archive in `games/`. The file listing rides
 * alongside it to catch an archive dropped in since the cached scan ran.
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
  const hasMaps = scanned.maps.length > 0 || installed.maps.size > 0;
  return {
    games: hasGames
      ? []
      : filterUninstalledGames(
          scopedGames,
          entries,
          installedGames,
          scannedGames,
        ),
    maps: hasMaps
      ? []
      : filterUninstalledMaps(suggestedMaps, installed.maps, scanned.maps),
  };
}
