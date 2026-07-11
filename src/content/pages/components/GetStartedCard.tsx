import { useSetting } from "@picoframe/frame";
import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { dlInstalledContent } from "../../../downloads/bindings";
import {
  useContentRootPaths,
  useWriteRootPath,
} from "../../../downloads/config";
import { usePreferredTarget } from "../../../play/config";
import {
  filterUninstalledGames,
  filterUninstalledMaps,
  useBrandingCatalog,
  useSuggestedGames,
  useSuggestedMaps,
} from "../../branding";
import { useSetupStatus, useUnitsyncScan } from "../../config";
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
  const games =
    scanSettled && !hasGames
      ? filterUninstalledGames(
          suggestedGames,
          entries,
          installed.games,
          scannedGames,
        )
      : [];
  const maps =
    installed.maps.size === 0
      ? filterUninstalledMaps(suggestedMaps, installed.maps, [])
      : [];
  if (games.length === 0 && maps.length === 0) return null;

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
        <SuggestionsList
          kind="map"
          heading="Maps"
          items={maps}
          writePath={writePath}
          onComplete={refreshInstalled}
        />
      )}
    </Card>
  );
}
