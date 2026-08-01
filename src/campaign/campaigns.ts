import { useCallback, useEffect, useState } from "react";
import {
  campaignList,
  campaignProgressLoad,
  campaignProgressSave,
} from "./bindings";
import { type Campaign, type ProgressFile, parseCampaignJson } from "./model";
import { sweepOrphanedScenarioMedia } from "./scenarioMedia";

/** A parsed campaign plus where it came from (bundled campaigns are read-only). */
export interface LoadedCampaign {
  campaign: Campaign;
  source: "local" | "bundled";
}

/**
 * Session cache of the parsed campaign list, so navigating back to the Campaigns
 * page shows results instantly instead of re-reading and re-parsing every
 * document. Mirrors the module-cache pattern the content hooks use.
 *
 * The set of listeners lets a mutation in one consumer (the builder saving a
 * campaign) push the fresh list to *every* mounted {@link useCampaigns} — most
 * importantly the sidebar nav's visibility gate, which must reveal/hide the
 * Campaigns item the instant the first/last campaign is saved or deleted, with no
 * app restart. This mirrors the epoch-listener invalidation in `content/config.ts`.
 */
let cache: LoadedCampaign[] | null = null;
const listeners = new Set<(loaded: LoadedCampaign[]) => void>();

/** Read + parse every stored campaign document, skipping invalid ones. */
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
  return loaded;
}

/**
 * Re-read the campaign list from disk, refresh the shared session cache, and push
 * the result to every mounted {@link useCampaigns}. Call after a builder
 * save/delete/import so a newly-added (or removed) campaign updates the sidebar nav
 * — whose visibility is gated on the campaign count — without an app restart.
 */
export async function refreshCampaigns(): Promise<LoadedCampaign[]> {
  const loaded = await fetchCampaigns();
  cache = loaded;
  for (const l of listeners) l(loaded);
  return loaded;
}

/**
 * Load every stored campaign. Serves the session cache on mount, else reads and
 * parses each document (skipping — with a console warning — any that fail
 * validation, so one malformed bundled/imported campaign can't break the list).
 * Subscribes to {@link refreshCampaigns} so a mutation elsewhere updates this
 * consumer in lockstep.
 */
export function useCampaigns() {
  const [campaigns, setCampaigns] = useState<LoadedCampaign[]>(cache ?? []);
  const [loading, setLoading] = useState(cache === null);
  const [error, setError] = useState<string | null>(null);

  // Stay in lockstep with refreshes triggered by any other consumer.
  useEffect(() => {
    const listener = (loaded: LoadedCampaign[]) => setCampaigns(loaded);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  // First mount: serve the cache, else fetch once.
  useEffect(() => {
    if (cache) {
      setCampaigns(cache);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetchCampaigns()
      .then((loaded) => {
        cache = loaded;
        if (!cancelled) {
          setCampaigns(loaded);
          setError(null);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      await refreshCampaigns();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  return { campaigns, loading, error, refresh };
}

/**
 * Every stored campaign, from the session cache when it is warm and from disk
 * when it is not. For callers outside React that must not answer "no campaigns"
 * simply because nothing has read the list yet, chiefly the checks deciding
 * whether deleting something would strip a campaign of what it plays.
 */
export async function loadedCampaigns(): Promise<LoadedCampaign[]> {
  return cache ?? (await refreshCampaigns());
}

/**
 * Synchronous read of a loaded campaign from the session cache, or `undefined` if
 * the list hasn't loaded yet (or has no such id). For non-React callers that need a
 * best-effort title now — chiefly the breadcrumb `crumb` resolvers, which run
 * outside React and only have the route's id params to work with.
 */
export function getCachedCampaign(id: string): LoadedCampaign | undefined {
  return cache?.find((l) => l.campaign.id === id);
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
 * from campaign documents so bundled (read-only) campaigns still track progress.
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
      setError(e instanceof Error ? e.message : String(e));
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
