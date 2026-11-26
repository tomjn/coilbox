import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { describeError } from "@/i18n/uiError";
import { useUnitsyncScan } from "../content/config";
import { createDocumentStore } from "../lib/documentStore";
import { usePreferredTarget } from "../play/config";
import {
  campaignList,
  campaignProgressLoad,
  campaignProgressSave,
} from "./bindings";
import { type CampaignGameOrigin, gameCampaigns } from "./gameCampaigns";
import { sortCampaigns } from "./listing";
import { type Campaign, type ProgressFile, parseCampaignJson } from "./model";
import { sweepOrphanedScenarioMedia } from "./scenarioMedia";

/**
 * A parsed campaign plus where it came from. Bundled campaigns and a game's own
 * (issue #2161) are read-only. `origin` is only set on a `"game"` campaign.
 */
export interface LoadedCampaign {
  campaign: Campaign;
  source: "local" | "bundled" | "game";
  origin?: CampaignGameOrigin;
}

/**
 * Read + parse every stored campaign document, skipping invalid ones, and hand
 * the list back in reading order (see {@link sortCampaigns}). The order is
 * settled here rather than in the builder page because every consumer of this
 * hook renders the list as it arrives, so ordering once is the only way the
 * builder and the player-facing Campaigns page agree. It is also where
 * `listScenarios` settles the scenario order.
 */
async function fetchCampaigns(): Promise<LoadedCampaign[]> {
  const { items } = await campaignList({});
  const loaded: LoadedCampaign[] = [];
  for (const item of items) {
    const campaign = parseCampaignJson(item.json);
    if (campaign) {
      loaded.push({ campaign, source: item.source });
    } else {
      console.warn("skipping invalid campaign document", item.source);
    }
  }
  // Every campaign there is, which is what deciding whether a dialogue clip is
  // still named needs. Not awaited: the list must not wait on a disk sweep, and
  // the sweep only ever removes folders this list does not name.
  void sweepOrphanedScenarioMedia(loaded.map((l) => l.campaign));
  return sortCampaigns(loaded);
}

const store = createDocumentStore<LoadedCampaign[]>(fetchCampaigns, []);

/**
 * The campaigns installed games ship (issue #2161), read separately because
 * they depend on the content scan rather than on coilbox's own storage, the
 * way `scenario/scenarios.ts` reads a game's missions.
 */
let gameCache: LoadedCampaign[] = [];
/** Whether the games half has settled at least once this session. */
let gamesRead = false;
const gameListeners = new Set<() => void>();

/** Replace the games half and tell every mounted {@link useCampaigns}. */
export function publishGameCampaigns(loaded: LoadedCampaign[]): void {
  gameCache = loaded;
  gamesRead = true;
  for (const listener of gameListeners) listener();
}

function subscribeGames(onChange: () => void): () => void {
  gameListeners.add(onChange);
  return () => {
    gameListeners.delete(onChange);
  };
}

/**
 * Stored and game campaigns in one list. A game campaign whose id a stored one
 * already has is left out: the stored one is a copy the player imported or
 * made, and progress is keyed by id, so the two cannot both be listed.
 */
export function mergeCampaigns(
  stored: readonly LoadedCampaign[],
  games: readonly LoadedCampaign[],
): LoadedCampaign[] {
  const ids = new Set(stored.map((l) => l.campaign.id));
  return sortCampaigns([
    ...stored,
    ...games.filter((l) => !ids.has(l.campaign.id)),
  ]);
}

/**
 * Read the games half once the content scan answers. Settles on an empty half
 * when there is no engine, or the scan failed or was cancelled, so the list
 * never waits on a scan that will not come.
 */
function useGameCampaignsLoader(): boolean {
  const { target, loading: targetLoading } = usePreferredTarget();
  const enginePath = target?.enginePath;
  const dataDir = target?.dataDir;
  const {
    data: scan,
    error: scanError,
    cancelled: scanCancelled,
  } = useUnitsyncScan(enginePath, dataDir);
  const [done, setDone] = useState(gamesRead);

  useEffect(() => {
    if (targetLoading) return;
    if (!enginePath || !dataDir || (!scan && (scanError || scanCancelled))) {
      gamesRead = true;
      setDone(true);
      return;
    }
    if (!scan) return;
    let cancelled = false;
    gameCampaigns(scan.games)
      .then((loaded) => {
        if (!cancelled) publishGameCampaigns(loaded);
      })
      .catch((e) => console.warn("could not read a game's own campaigns", e))
      .finally(() => {
        if (cancelled) return;
        gamesRead = true;
        setDone(true);
      });
    return () => {
      cancelled = true;
    };
  }, [scan, scanError, scanCancelled, targetLoading, enginePath, dataDir]);

  return done;
}

/**
 * Re-read the campaign list from disk, refresh the shared session cache, and push
 * the result to every mounted {@link useCampaigns}. Call after a builder
 * save/delete/import so a newly-added (or removed) campaign updates the sidebar
 * nav, whose visibility is gated on the campaign count, without an app restart.
 */
export const refreshCampaigns = store.refresh;

/**
 * Load every stored campaign. Serves the session cache on mount, else reads and
 * parses each document, skipping (with a console warning) any that fail
 * validation, so one malformed bundled or imported campaign can't break the
 * list. Stays in lockstep with a mutation from any other consumer.
 */
export function useCampaigns() {
  const { data: stored, loading, error, refresh } = store.useStore();
  const games = useSyncExternalStore(subscribeGames, () => gameCache);
  const gamesDone = useGameCampaignsLoader();
  const campaigns = useMemo(
    () => mergeCampaigns(stored, games),
    [stored, games],
  );
  // Loading covers both halves, so a player whose only campaigns come from a
  // game does not see "No campaigns yet" before the real list.
  return { campaigns, loading: loading || !gamesDone, error, refresh };
}

/**
 * Every stored campaign, from the session cache when it is warm and from disk
 * when it is not. For callers outside React that must not answer "no campaigns"
 * simply because nothing has read the list yet, chiefly the checks deciding
 * whether deleting something would strip a campaign of what it plays.
 */
export async function loadedCampaigns(): Promise<LoadedCampaign[]> {
  const stored = store.getCached() ?? (await refreshCampaigns());
  return mergeCampaigns(stored, gameCache);
}

/**
 * Synchronous read of a loaded campaign from the session cache, or `undefined` if
 * the list hasn't loaded yet (or has no such id). For non-React callers that need a
 * best-effort title now — chiefly the breadcrumb `crumb` resolvers, which run
 * outside React and only have the route's id params to work with.
 */
export function getCachedCampaign(id: string): LoadedCampaign | undefined {
  return (
    store.getCached()?.find((l) => l.campaign.id === id) ??
    gameCache.find((l) => l.campaign.id === id)
  );
}

/**
 * Nav visibility gate for the player-facing Campaigns item: true once at least one
 * campaign (local or bundled) exists. Hidden while the first load is still in
 * flight, so the item doesn't flash in and then out.
 */
export function useHasCampaigns(): boolean {
  const { campaigns, loading } = useCampaigns();
  return !loading && campaigns.length > 0;
}

/** The empty progress document, matching the plugin's default. */
const emptyProgress: ProgressFile = { schemaVersion: 1, campaigns: {} };

/**
 * Load / save wrappers around the progress commands. Progress is stored separately
 * from campaign documents so read-only campaigns, bundled or shipped in a game,
 * still track progress, in coilbox's own data folder.
 * The document is opaque to Rust; parse failures fall back to the empty default.
 */
export function useCampaignProgress() {
  const [progress, setProgress] = useState<ProgressFile>(emptyProgress);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { json } = await campaignProgressLoad({});
      try {
        setProgress(JSON.parse(json) as ProgressFile);
      } catch {
        setProgress(emptyProgress);
      }
    } catch (e) {
      setError(describeError(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const save = useCallback(async (next: ProgressFile) => {
    setProgress(next);
    await campaignProgressSave({ json: JSON.stringify(next) });
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { progress, loading, error, refresh, save };
}
