import { useSetting } from "@picoframe/frame";
import { useCallback, useEffect, useState } from "react";
import { type ContentState, contentStateLoad } from "./bindings";

/** Lightweight UI prefs (the only thing routed through the frame settings store;
 * the roots/engines themselves live in the plugin's own Rust state.json). */
export interface ContentPrefs {
  /** Rescan automatically the first time the Content pages open. */
  autoScanOnStartup: boolean;
  /** Also probe Steam/Zero-K install locations during detection. */
  probeZeroK: boolean;
}

export const defaultPrefs: ContentPrefs = {
  autoScanOnStartup: true,
  probeZeroK: false,
};

export function useContentPrefs() {
  return useSetting<ContentPrefs>("content.prefs", defaultPrefs);
}

/**
 * Load + hold the persisted content state, shared by the Folders and Engines
 * pages. `setState` lets callers apply the result of a mutating command (rescan,
 * add, remove, verify) without a second round-trip.
 */
export function useContentState() {
  const [state, setState] = useState<ContentState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const { state } = await contentStateLoad(undefined);
      setState(state);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { state, setState, loading, error, refresh };
}
