import {
  filterUninstalledGames,
  filterUninstalledMaps,
  type SuggestedGame,
  type SuggestedMap,
} from "../../branding";

type BrandingEntries = Parameters<typeof filterUninstalledGames>[1];
type ScannedGames = Parameters<typeof filterUninstalledGames>[3];

/**
 * The `GetStartedCard` offer decision: each kind is only offered while the user
 * has none of that kind yet. Games additionally wait for the unitsync scan to
 * settle so a not-yet-run scan can't let an already-installed rapid game slip
 * back into the suggestions. Maps mirror the games gate (issue #534: #526 made
 * maps unconditional, so they kept showing to users who already had maps).
 */
export function getStartedCandidates(input: {
  installed: { games: Set<string>; maps: Set<string> } | null;
  scanSettled: boolean;
  scannedGames: ScannedGames;
  scopedGames: SuggestedGame[];
  entries: BrandingEntries;
  suggestedMaps: SuggestedMap[];
}): { games: SuggestedGame[]; maps: SuggestedMap[] } {
  const {
    installed,
    scanSettled,
    scannedGames,
    scopedGames,
    entries,
    suggestedMaps,
  } = input;
  const hasGames = (installed?.games.size ?? 0) > 0 || scannedGames.length > 0;
  const hasMaps = (installed?.maps.size ?? 0) > 0;
  const games =
    installed && scanSettled && !hasGames
      ? filterUninstalledGames(
          scopedGames,
          entries,
          installed.games,
          scannedGames,
        )
      : [];
  const maps =
    installed && !hasMaps
      ? filterUninstalledMaps(suggestedMaps, installed.maps, [])
      : [];
  return { games, maps };
}
