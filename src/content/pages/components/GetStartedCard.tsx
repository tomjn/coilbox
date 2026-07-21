import { useSetting } from "@picoframe/frame";
import { Compass } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { Card } from "@/components/ui/card";
import { dlInstalledContent } from "../../../downloads/bindings";
import {
  useContentRootPaths,
  useWriteRootPath,
} from "../../../downloads/config";
import { MapPacksBanner } from "../../../downloads/pages/components/MapPacksBanner";
import { usePreferredTarget } from "../../../play/config";
import { isProfileHidden } from "../../../profile/hidden";
import { getGameMatcher } from "../../../profile/profile";
import {
  filterUninstalledGames,
  filterUninstalledMaps,
  useBrandingCatalog,
  useSuggestedGames,
  useSuggestedMaps,
} from "../../branding";
import { useSetupStatus, useUnitsyncScan } from "../../config";
import { filterSuggestedGamesByFilter } from "../../suggestedGames";
import { SuggestionsList } from "./SuggestionsList";

/**
 * Welcome-screen card offering curated game/map downloads once setup (content
 * folder + engine) is complete but the user still has no content. Maps use the
 * cheap `dlInstalledContent` directory listing (maps land as files); games are
 * resolved against a unitsync scan, since rapid installs live in
 * `packages/`+`pool/` and never appear as an archive in `games/`, so a file
 * listing would re-suggest a game the user can already launch. Dismissible and
 * self-hiding once content lands.
 */
export function GetStartedCard() {
  const { complete } = useSetupStatus();
  const [dismissed, setDismissed] = useSetting<boolean>(
    "suggestions.dismissed",
    false,
  );
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

  if (!complete || dismissed || !installed) return null;

  // unitsync is the truth for games (it sees rapid content); the file listing
  // only backs maps. Wait for the scan to settle so a not-yet-run scan can't let
  // an already-installed rapid game slip back into the suggestions.
  const scannedGames = scan.data?.games ?? [];
  const scanSettled = scan.data != null || scan.error != null;
  const hasGames = installed.games.size > 0 || scannedGames.length > 0;
  // A distribution's gameFilter narrows the suggestions first, so a single-game
  // distribution (e.g. SplinterFaction) never advertises other games' downloads.
  const scopedGames = filterSuggestedGamesByFilter(
    suggestedGames,
    entries,
    getGameMatcher(),
  );
  const games =
    scanSettled && !hasGames
      ? filterUninstalledGames(
          scopedGames,
          entries,
          installed.games,
          scannedGames,
        )
      : [];
  const maps =
    installed.maps.size === 0
      ? filterUninstalledMaps(suggestedMaps, installed.maps, [])
      : [];
  if (games.length === 0 && maps.length === 0) {
    // The full card only self-hides once something is actually installed
    // (hasGames or a map on disk) — an empty catalog/scope with nothing
    // installed yet should stay silent rather than open a dead-end door.
    const hasContent = hasGames || installed.maps.size > 0;
    return hasContent ? <BrowseMoreDoor /> : null;
  }

  return (
    <Card className="gap-4 rounded-lg border-border p-4 shadow-none">
      <div className="flex items-start justify-between gap-2">
        <div className="space-y-1">
          <h2 className="text-sm font-semibold">Get started</h2>
          <p className="text-xs text-muted-foreground">
            Download a game or map to start playing.
          </p>
        </div>
        <button
          type="button"
          className="-mx-1 px-1 py-1.5 text-xs text-muted-foreground underline"
          onClick={() => setDismissed(true)}
        >
          Dismiss
        </button>
      </div>

      {games.length > 0 && (
        <SuggestionsList
          kind="game"
          heading="Games"
          items={games}
          writePath={writePath}
          onComplete={refreshInstalled}
        />
      )}
      {maps.length > 0 && (
        <>
          <SuggestionsList
            kind="map"
            heading="Maps"
            items={maps}
            writePath={writePath}
            onComplete={refreshInstalled}
          />
          <MapPacksBanner installed={installed.maps} writePath={writePath} />
        </>
      )}
    </Card>
  );
}

/**
 * Compact door shown once the full card self-hides because something is already
 * installed — otherwise a day-one player who grabs one game has no way back to a
 * second game or the map packs short of finding Content/Downloads unaided. Routes
 * to the games downloads page (which itself links on to maps), or straight to maps
 * when a distribution profile hides game downloads (e.g. a single-game bundle).
 */
function BrowseMoreDoor() {
  const gamesHidden = isProfileHidden("downloads.games");
  return (
    <Link
      to={gamesHidden ? "/downloads/maps" : "/downloads/games"}
      className="flex items-center gap-3 rounded-lg border border-border bg-card p-3 text-sm transition-colors hover:border-border hover:bg-accent/50 focus-visible:border-primary focus-visible:outline-none"
    >
      <Compass className="size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 text-muted-foreground">
        Browse more games and maps
      </span>
    </Link>
  );
}
