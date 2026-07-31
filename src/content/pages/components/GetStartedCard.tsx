import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { dlInstalledContent } from "../../../downloads/bindings";
import {
  useContentRootPaths,
  useWriteRootPath,
} from "../../../downloads/config";
import { MapPacksBanner } from "../../../downloads/pages/components/MapPacksBanner";
import { usePreferredTarget } from "../../../play/config";
import { getGameMatcher } from "../../../profile/profile";
import {
  type SuggestedGame,
  type SuggestedMap,
  useBrandingCatalog,
  useSuggestedGames,
  useSuggestedMaps,
} from "../../branding";
import { useSetupStatus, useUnitsyncScan } from "../../config";
import { filterSuggestedGamesByFilter } from "../../suggestedGames";
import { getStartedCandidates } from "./getStartedCandidates";
import { SuggestionsList } from "./SuggestionsList";

/**
 * Welcome-screen card offering curated game/map downloads once setup (content
 * folder + engine) is complete but the user still has no content. The verdict
 * needs two inventories: a settled unitsync scan (the authority, since rapid
 * installs never appear as an archive in `games/`) and the `dlInstalledContent`
 * directory listing. Self-hides once every suggestion has been downloaded
 * (issue #530: no manual dismiss).
 *
 * The offered list is snapshotted once per visit (issue #526). Downloading one
 * suggestion refreshes `installed`, but re-deriving the list from that would
 * shrink or empty it mid-visit. The snapshot holds steady until this card
 * unmounts (navigating away from the welcome screen), and the next visit
 * recomputes it fresh. A downloaded item stays in its slot, marked done, via
 * `SuggestionsList`'s own per-item tracking.
 *
 * Nothing is snapshotted until both inventories are genuinely known. Neither an
 * unloaded content root nor a failed scan may stand in as an empty one, or a
 * mature install intermittently reads as a first run, and the per-visit
 * snapshot then holds that wrong verdict for the whole visit.
 */
export function GetStartedCard() {
  const { complete } = useSetupStatus();
  const rootPaths = useContentRootPaths();
  const writePath = useWriteRootPath();
  const entries = useBrandingCatalog();
  const suggestedGames = useSuggestedGames();
  const suggestedMaps = useSuggestedMaps();
  const { target } = usePreferredTarget();
  const scan = useUnitsyncScan(target?.enginePath, target?.dataDir);
  const [installed, setInstalled] = useState<{
    games: Set<string>;
    maps: Set<string>;
  } | null>(null);
  const [snapshot, setSnapshot] = useState<{
    games: SuggestedGame[];
    maps: SuggestedMap[];
  } | null>(null);

  // Only ever publishes a listing it actually read. Content roots load
  // asynchronously, so writing empty sets while `rootPaths` is still empty (or
  // after a failed listing) would let the snapshot below freeze a "user has
  // nothing" verdict for a user who has everything.
  const refreshInstalled = useCallback(async () => {
    if (rootPaths.length === 0) return;
    try {
      const { games, maps } = await dlInstalledContent({ paths: rootPaths });
      setInstalled({ games: new Set(games), maps: new Set(maps) });
    } catch {
      // Leave the last known listing (or nothing) in place.
    }
  }, [rootPaths]);

  useEffect(() => {
    refreshInstalled();
  }, [refreshInstalled]);

  // unitsync is the truth for both kinds: it sees rapid content, which never
  // lands as a file in `games/`. A scan that failed reports no games and no
  // maps, which is not a report of an empty install, so only a scan that
  // resolved counts (matching `usePlayReadiness`).
  const scanned = !scan.loading && scan.data ? scan.data : null;
  // A distribution's gameFilter narrows the suggestions first, so a single-game
  // distribution (e.g. SplinterFaction) never advertises other games' downloads.
  const scopedGames = filterSuggestedGamesByFilter(
    suggestedGames,
    entries,
    getGameMatcher(),
  );
  const candidates = getStartedCandidates({
    installed,
    scanned,
    scopedGames,
    entries,
    suggestedMaps,
  });

  // Captured the moment the verdict is first answerable (both inventories in),
  // then held for the rest of this mount (issue #526). Navigating away unmounts
  // the card, so the next visit asks again from scratch.
  useEffect(() => {
    if (snapshot || !candidates) return;
    setSnapshot(candidates);
  }, [snapshot, candidates]);

  if (!complete || !installed || !snapshot) return null;
  if (snapshot.games.length === 0 && snapshot.maps.length === 0) return null;

  return (
    <Card className="gap-4 rounded-lg border-border p-4 shadow-none">
      <div className="space-y-1">
        <h2 className="text-sm font-semibold">Get started</h2>
        <p className="text-xs text-muted-foreground">
          Download a game or map to start playing.
        </p>
      </div>

      {snapshot.games.length > 0 && (
        <SuggestionsList
          kind="game"
          heading="Games"
          items={snapshot.games}
          writePath={writePath}
          onComplete={refreshInstalled}
        />
      )}
      {snapshot.maps.length > 0 && (
        <>
          <SuggestionsList
            kind="map"
            heading="Maps"
            items={snapshot.maps}
            writePath={writePath}
            onComplete={refreshInstalled}
          />
          <MapPacksBanner installed={installed.maps} writePath={writePath} />
        </>
      )}
    </Card>
  );
}
