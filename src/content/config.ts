import { useSetting } from "@picoframe/frame";
import { useCallback, useEffect, useState } from "react";
import {
  type ContentState,
  contentStateLoad,
  type GameInfoResult,
  type ScanResult,
  unitsyncGameInfo,
  unitsyncMinimap,
  unitsyncScan,
  unitsyncThumbnails,
} from "./bindings";

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

/* -------------------------------------------------------------------------- *
 * Content browser (unitsync) — scan-target selection + scan results.
 * -------------------------------------------------------------------------- */

/** A (content root, engine) pair the unitsync worker can be pointed at. */
export interface ScanTarget {
  rootPath: string;
  rootLabel?: string;
  engineId: string;
  /** The engine dir holding `libunitsync.*`. */
  enginePath: string;
  /** Best available version label for display. */
  engineVersion: string;
}

/** Stable key for a target, used as the picker value and persisted selection. */
export function targetKey(t: ScanTarget): string {
  return `${t.rootPath}::${t.engineId}`;
}

/** Flatten the content state into every (root, engine) scan target. */
export function useContentTargets() {
  const { state, loading, error, refresh } = useContentState();
  const targets: ScanTarget[] = (state?.roots ?? [])
    .filter((r) => r.engines.length > 0)
    .flatMap((r) =>
      r.engines.map((e) => ({
        rootPath: r.path,
        rootLabel: r.label,
        engineId: e.id,
        enginePath: e.path,
        engineVersion: e.syncVersion ?? e.version,
      })),
    );
  return { targets, loading, error, refresh };
}

/**
 * Target selection shared by the Maps and Games pages: the available targets,
 * the persisted current choice (defaulting to the first available), and a setter.
 */
export function useScanTargetSelection() {
  const { targets, loading, error, refresh } = useContentTargets();
  const [selectedKey, setSelectedKey] = useSetting<string>(
    "content.scanTarget",
    "",
  );
  const selected =
    targets.find((t) => targetKey(t) === selectedKey) ?? targets[0] ?? null;
  return {
    targets,
    selected,
    selectedKey: selected ? targetKey(selected) : "",
    setSelectedKey,
    loading,
    error,
    refresh,
  };
}

/**
 * Session cache of scan results, keyed by `dataDir::enginePath`. unitsync scans
 * rebuild the whole VFS and are slow, so we hold results for the session and
 * only re-run on an explicit refresh. Not persisted to disk (v1).
 */
const scanCache = new Map<string, ScanResult>();

/** Run / read a cached unitsync scan for the given target. */
export function useUnitsyncScan(enginePath?: string, dataDir?: string) {
  const [data, setData] = useState<ScanResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (force = false) => {
      if (!enginePath || !dataDir) return;
      const key = `${dataDir}::${enginePath}`;
      if (!force && scanCache.has(key)) {
        setData(scanCache.get(key) ?? null);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const res = await unitsyncScan({ enginePath, dataDir });
        scanCache.set(key, res);
        setData(res);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    },
    [enginePath, dataDir],
  );

  // When a target becomes available, show its content immediately: serve the
  // cached result, or auto-scan on first open. `run(false)` does exactly that.
  useEffect(() => {
    if (!enginePath || !dataDir) {
      setData(null);
      return;
    }
    run(false);
  }, [enginePath, dataDir, run]);

  return { data, loading, error, run };
}

/** Session cache of batch thumbnails, keyed by `dataDir::enginePath`. */
const thumbnailsCache = new Map<string, Map<string, string>>();

/** Lazily render and cache thumbnails for every map (name -> PNG data URL). */
export function useUnitsyncThumbnails(enginePath?: string, dataDir?: string) {
  const [thumbs, setThumbs] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enginePath || !dataDir) {
      setThumbs(new Map());
      return;
    }
    const key = `${dataDir}::${enginePath}`;
    const cached = thumbnailsCache.get(key);
    if (cached) {
      setThumbs(cached);
      return;
    }
    let cancelled = false;
    setLoading(true);
    unitsyncThumbnails({ enginePath, dataDir, mip: 3 })
      .then((res) => {
        if (cancelled) return;
        const map = new Map(res.thumbnails.map((t) => [t.name, t.dataUrl]));
        thumbnailsCache.set(key, map);
        setThumbs(map);
      })
      .catch(() => {
        if (!cancelled) setThumbs(new Map());
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [enginePath, dataDir]);

  return { thumbs, loading };
}

/** Session cache of game info, keyed by `dataDir::enginePath::gameArchive`. */
const gameInfoCache = new Map<string, GameInfoResult>();

/** Lazily load a game's sides + unit count (loads the game's archive set). */
export function useUnitsyncGameInfo(
  enginePath?: string,
  dataDir?: string,
  gameArchive?: string,
) {
  const [info, setInfo] = useState<GameInfoResult | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enginePath || !dataDir || !gameArchive) {
      setInfo(null);
      return;
    }
    const key = `${dataDir}::${enginePath}::${gameArchive}`;
    const cached = gameInfoCache.get(key);
    if (cached) {
      setInfo(cached);
      return;
    }
    let cancelled = false;
    setLoading(true);
    unitsyncGameInfo({ enginePath, dataDir, gameArchive })
      .then((res) => {
        if (cancelled) return;
        gameInfoCache.set(key, res);
        setInfo(res);
      })
      .catch(() => {
        if (!cancelled) setInfo(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [enginePath, dataDir, gameArchive]);

  return { info, loading };
}

/** Session cache of rendered minimaps, keyed by `dataDir::enginePath::mapName`. */
const minimapCache = new Map<string, string>();

/** Lazily render and cache a map's minimap (PNG data URL) for the detail page. */
export function useUnitsyncMinimap(
  enginePath?: string,
  dataDir?: string,
  mapName?: string,
) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enginePath || !dataDir || !mapName) {
      setDataUrl(null);
      return;
    }
    const key = `${dataDir}::${enginePath}::${mapName}`;
    const cached = minimapCache.get(key);
    if (cached !== undefined) {
      setDataUrl(cached || null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    unitsyncMinimap({ enginePath, dataDir, mapName })
      .then((res) => {
        if (cancelled) return;
        const url = res.dataUrl ?? "";
        minimapCache.set(key, url); // cache "" as "no minimap" to avoid refetch
        setDataUrl(url || null);
        if (!url && res.errors?.length) setError(res.errors.join("; "));
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
  }, [enginePath, dataDir, mapName]);

  return { dataUrl, loading, error };
}
