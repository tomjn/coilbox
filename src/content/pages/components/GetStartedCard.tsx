import { useSetting } from "@picoframe/frame";
import { useCallback, useEffect, useState } from "react";
import { dlInstalledContent } from "../../../downloads/bindings";
import {
  useContentRootPaths,
  useWriteRootPath,
} from "../../../downloads/config";
import {
  filterUninstalledGames,
  filterUninstalledMaps,
  useBrandingCatalog,
  useSuggestedGames,
  useSuggestedMaps,
} from "../../branding";
import { useSetupStatus } from "../../config";
import { SuggestionsList } from "./SuggestionsList";

/**
 * Welcome-screen card offering curated game/map downloads once setup (content
 * folder + engine) is complete but the user still has no content. Gated on the
 * cheap `dlInstalledContent` directory listing — no unitsync scan — so a healthy
 * install pays nothing. Dismissible and self-hiding once content lands.
 *
 * Known limitation: rapid content installs under `packages/`+`pool/`, so a
 * rapid-only install reads as "no games" here and may re-suggest a game the user
 * can already launch. Acceptable — the card is dismissible.
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

  const games =
    installed.games.size === 0
      ? filterUninstalledGames(suggestedGames, entries, installed.games, [])
      : [];
  const maps =
    installed.maps.size === 0
      ? filterUninstalledMaps(suggestedMaps, installed.maps, [])
      : [];
  if (games.length === 0 && maps.length === 0) return null;

  return (
    <section className="space-y-4 rounded-lg border border-border bg-card p-4">
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
    </section>
  );
}
