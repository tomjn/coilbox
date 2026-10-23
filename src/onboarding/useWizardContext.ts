import { useMemo } from "react";
import {
  type SuggestedGame,
  useBrandingCatalog,
  useCatalogLoaded,
  useSuggestedGames,
  useSuggestedMaps,
} from "@/content/branding";
import { useUnitsyncScan } from "@/content/config";
import {
  getStartedCandidates,
  type ScannedContent,
} from "@/content/pages/components/getStartedCandidates";
import { scanSettled } from "@/content/scanSettled";
import { filterSuggestedGamesByFilter } from "@/content/suggestedGames";
import { useLibrary } from "@/content/useLibrary";
import { useContentRoots } from "@/downloads/config";
import { useHubAccount } from "@/hub/account";
import { useHubUrl } from "@/hub/config";
import { LANGUAGE_KEY } from "@/i18n/language";
import { readStoredSetting } from "@/lib/storedSetting";
import { useLobbyAccounts } from "@/lobby-servers/config";
import { usePreferredTarget } from "@/play/config";
import { getGameMatcher, getProfile, isHubEnabled } from "@/profile/profile";
import { decideGames, type WizardContext } from "./relevance";

const NOTHING_SCANNED: ScannedContent = { games: [], maps: [] };
const NOTHING_ON_DISK = { games: new Set<string>(), maps: new Set<string>() };

/**
 * What the wizard's relevance rules read, live. The get-started offer's inputs
 * (`useCollectGetStartedOffer`) without its setup gate, because the wizard runs
 * before there is an engine.
 *
 * Every input that can fail answers as empty once it has gone as far as it will
 * go: a scan that errored or was cancelled, no engine to scan, no content
 * folder to list. Otherwise the games decision would wait forever and so would
 * the wizard.
 */
export function useWizardContext(): {
  ctx: WizardContext;
  candidates: SuggestedGame[] | null;
} {
  const profile = getProfile();
  const hub = useHubAccount(useHubUrl());
  const [{ accounts }] = useLobbyAccounts();

  const catalogLoaded = useCatalogLoaded();
  const entries = useBrandingCatalog();
  const suggestedGames = useSuggestedGames();
  const suggestedMaps = useSuggestedMaps();
  const { target, loading: targetLoading } = usePreferredTarget();
  const scan = useUnitsyncScan(target?.enginePath, target?.dataDir);
  const roots = useContentRoots();
  const { installedFiles, filesRead, filesAnswered } = useLibrary();

  const hasTarget = !!(target?.enginePath && target?.dataDir);
  const settled = scanSettled({ targetLoading, hasTarget, scan });
  const scanned: ScannedContent | null = !settled
    ? null
    : hasTarget && scan.data
      ? scan.data
      : NOTHING_SCANNED;

  const installed = useMemo(() => {
    if (filesRead)
      return { games: installedFiles.games, maps: installedFiles.maps };
    if (filesAnswered || (!roots.loading && roots.paths.length === 0))
      return NOTHING_ON_DISK;
    return null;
  }, [filesRead, filesAnswered, installedFiles, roots]);

  const matcher = getGameMatcher();
  const candidates = catalogLoaded
    ? (getStartedCandidates({
        installed,
        scanned,
        scopedGames: filterSuggestedGamesByFilter(
          suggestedGames,
          entries,
          matcher,
        ),
        entries,
        suggestedMaps,
      })?.games ?? null)
    : null;

  const ctx: WizardContext = {
    languageStored:
      readStoredSetting<string | null>(LANGUAGE_KEY, null) !== null,
    profileMode: !!profile.mode,
    profileColours: !!(profile.accent || profile.base),
    hubEnabled: isHubEnabled(),
    hub: { loading: hub.loading, signedIn: hub.signedIn, unknown: hub.unknown },
    lobbyAccountCount: accounts.length,
    games: decideGames({ candidates, hasGameFilter: matcher !== null }),
  };
  return { ctx, candidates };
}
