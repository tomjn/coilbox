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
 * folder + engine) is complete but the user still has no content. Maps use the
 * cheap `dlInstalledContent` directory listing (maps land as files). Games are
 * resolved against a unitsync scan, since rapid installs live in
 * `packages/`+`pool/` and never appear as an archive in `games/`, so a file
 * listing would re-suggest a game the user can already launch. Self-hides once
 * every suggestion has been downloaded (issue #530: no manual dismiss).
 *
 * The offered list is snapshotted once per visit (issue #526). Downloading one
 * suggestion refreshes `installed`, but re-deriving the list from that would
 * shrink or empty it mid-visit. The snapshot holds steady until this card
 * unmounts (navigating away from the welcome screen), and the next visit
 * recomputes it fresh. A downloaded item stays in its slot, marked done, via
 * `SuggestionsList`'s own per-item tracking.
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

  const refreshInstalled = useCallback(async () => {
    if (rootPaths.length === 0) {
      setInstalled({ games: new Set(), maps: new Set() });
      return;
    }
    try {
      const { games, maps } = await dlInstalledContent({ paths: rootPaths });
      setInstalled({ games: new Set(games), maps: new Set(maps) });
    } catch {
      setInstalled({ games: new Set(), maps: new Set() });
    }
  }, [rootPaths]);

  useEffect(() => {
    refreshInstalled();
  }, [refreshInstalled]);

  // unitsync is the truth for games (it sees rapid content). The file listing
  // only backs maps.
  const scannedGames = scan.data?.games ?? [];
  const scanSettled = scan.data != null || scan.error != null;
  // A distribution's gameFilter narrows the suggestions first, so a single-game
  // distribution (e.g. SplinterFaction) never advertises other games' downloads.
  const scopedGames = filterSuggestedGamesByFilter(
    suggestedGames,
    entries,
    getGameMatcher(),
  );
  const { games: candidateGames, maps: candidateMaps } = getStartedCandidates({
    installed,
    scanSettled,
    scannedGames,
    scopedGames,
    entries,
    suggestedMaps,
  });

  // Captured once the readiness signals (root paths resolved, installed listing
  // in, settled scan) are all in, then held for the rest of this mount (issue
  // #526). `rootPaths` starts empty and loads asynchronously, independently of
  // `complete`, so without this check the very first `installed` (still keyed
  // off the not-yet-loaded empty root list) could freeze a snapshot with
  // nothing marked installed.
  useEffect(() => {
    if (snapshot || rootPaths.length === 0 || !installed || !scanSettled)
      return;
    setSnapshot({ games: candidateGames, maps: candidateMaps });
  }, [
    snapshot,
    rootPaths,
    installed,
    scanSettled,
    candidateGames,
    candidateMaps,
  ]);

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
