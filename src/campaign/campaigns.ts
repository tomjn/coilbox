import { useCallback, useEffect, useState } from "react";
import {
  campaignList,
  campaignProgressLoad,
  campaignProgressSave,
} from "./bindings";
import { type Campaign, type ProgressFile, parseCampaignJson } from "./model";

/** A parsed campaign plus where it came from (bundled campaigns are read-only). */
export interface LoadedCampaign {
  campaign: Campaign;
  source: "local" | "bundled";
}

/**
 * Session cache of the parsed campaign list, so navigating back to the Campaigns
 * page shows results instantly instead of re-reading and re-parsing every
 * document. Mirrors the module-cache pattern the content hooks use; a `refresh`
 * bypasses it.
 */
let cache: LoadedCampaign[] | null = null;

/**
 * Load every stored campaign. Reads the raw documents from the plugin, parses each
 * with {@link parseCampaignJson}, and skips (with a console warning) any that fail
 * validation so one malformed bundled/imported campaign can't break the list.
 */
export function useCampaigns() {
  const [campaigns, setCampaigns] = useState<LoadedCampaign[]>(cache ?? []);
  const [loading, setLoading] = useState(cache === null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (force: boolean) => {
    if (!force && cache) {
      setCampaigns(cache);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
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
      cache = loaded;
      setCampaigns(loaded);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const refresh = useCallback(() => {
    cache = null;
    return load(true);
  }, [load]);

  useEffect(() => {
    load(false);
  }, [load]);

  return { campaigns, loading, error, refresh };
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
