import { useSetting } from "@picoframe/frame";
import { listen } from "@tauri-apps/api/event";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import type { MapAppearance } from "../mapconv/bindings";
import {
  type Archive,
  type ArchiveFileResult,
  type ArchiveTreeResult,
  type ContentState,
  contentCandidates,
  contentDemoInfo,
  contentListReplays,
  contentListSaves,
  contentStateLoad,
  contentStatsIngest,
  contentStatsQuery,
  contentStatsWatchStart,
  contentStatsWatchStop,
  type DemoInfo,
  type EngineConfigResult,
  type GameInfoResult,
  type HeightmapResult,
  type IngestSummary,
  type MapInfoResult,
  type MapSkyboxResult,
  type MetalmapResult,
  type MinimapResult,
  type ReplayFile,
  type SaveFile,
  type ScanResult,
  STATS_UPDATED_EVENT,
  type StartPos,
  type StatRecord,
  type UnitBuildpicsResult,
  type UnitDatasetResult,
  type UnitDisplay,
  type UnitModelResult,
  unitsyncArchiveFile,
  unitsyncArchiveTree,
  unitsyncCancel,
  unitsyncEngineConfig,
  unitsyncEngineConfigSet,
  unitsyncGameHeaders,
  unitsyncGameInfo,
  unitsyncHeightmap,
  unitsyncMapInfo,
  unitsyncMapSkybox,
  unitsyncMetalmap,
  unitsyncMinimap,
  unitsyncScan,
  unitsyncThumbnails,
  unitsyncUnitBuildpics,
  unitsyncUnitDataset,
  unitsyncUnitModel,
} from "./bindings";
import { newestEngineId } from "./engineVersion";
import { useRecordMapAppearance } from "./mapAppearanceCache";
import { deriveSetup } from "./setup";

export type { SetupStatus } from "./setup";

/** Lightweight UI prefs (the only thing routed through the frame settings store;
 * the roots/engines themselves live in the plugin's own Rust state.json). */
export interface ContentPrefs {
  /** Rescan automatically the first time the Content pages open. */
  autoScanOnStartup: boolean;
  /** Also probe Steam/Zero-K install locations during detection. */
  probeZeroK: boolean;
  /** Snapshot the current engine config to an "Auto-backup" profile before a restore. */
  autoBackupEngineConfig: boolean;
}

export const defaultPrefs: ContentPrefs = {
  autoScanOnStartup: true,
  probeZeroK: false,
  autoBackupEngineConfig: false,
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
 * First-run setup guidance — what's missing for a playable setup.
 * -------------------------------------------------------------------------- */

/** Setup status driven by live content state + the OS-standard candidate path. */
export function useSetupStatus() {
  const { state, loading, refresh } = useContentState();
  const [standardPath, setStandardPath] = useState<string | undefined>();

  useEffect(() => {
    contentCandidates(undefined)
      .then(({ candidates }) => {
        setStandardPath(
          candidates.find((c) => c.origin === "prd-default")?.path,
        );
      })
      .catch(() => setStandardPath(undefined));
  }, []);

  return { ...deriveSetup(state, standardPath), loading, refresh };
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
export function targetsFromState(state: ContentState | null): ScanTarget[] {
  return (state?.roots ?? [])
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
}

/** Flatten the content state into every (root, engine) scan target. */
export function useContentTargets() {
  const { state, loading, error, refresh } = useContentState();
  return { targets: targetsFromState(state), loading, error, refresh };
}

/**
 * The user's preferred engine: a global default used wherever an engine must be
 * picked unambiguously (the scan target today, battle launching later). Stores a
 * bare `engine.id`; when unset or pointing at a removed engine, it resolves to
 * the newest available version. An explicit pick always wins over newest.
 */
export function usePreferredEngine(
  engines: { id: string; version: string; syncVersion?: string }[],
) {
  const [prefId, setPrefId] = useSetting<string>(
    "content.preferredEngineId",
    "",
  );
  const resolvedId =
    engines.find((e) => e.id === prefId)?.id ?? newestEngineId(engines);
  return { prefId, resolvedId, setPrefId };
}

/**
 * Target selection shared by the Maps and Games pages: the available targets,
 * the persisted current choice, and a setter. With no explicit choice it falls
 * back to the preferred engine (newest by default), then to the first available.
 */
export function useScanTargetSelection() {
  const { targets, loading, error, refresh } = useContentTargets();
  const [selectedKey, setSelectedKey] = useSetting<string>(
    "content.scanTarget",
    "",
  );
  const { resolvedId } = usePreferredEngine(
    targets.map((t) => ({ id: t.engineId, version: t.engineVersion })),
  );
  const selected =
    targets.find((t) => targetKey(t) === selectedKey) ??
    targets.find((t) => t.engineId === resolvedId) ??
    targets[0] ??
    null;
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

/** Session cache of scan *failures*, so a failed target doesn't silently re-run
 * a multi-minute scan on every navigation. Cleared by a forced retry. */
const scanErrorCache = new Map<string, string>();

/**
 * In-flight scans keyed like the scan cache. A page opened while the launch
 * warm-up (or another page) is mid-scan joins that running op — and its
 * cancellable `opId` — instead of kicking off a second worker scan of the same
 * target. This is also what lets a page's Rescan/Cancel control stop the scan
 * that the launch warm-up started.
 */
const inFlightScans = new Map<
  string,
  { promise: Promise<ScanResult>; opId: string }
>();

/** Cancel the in-flight scan for a target, if one is running. */
export function cancelScan(enginePath?: string, dataDir?: string) {
  if (!enginePath || !dataDir) return;
  const inFlight = inFlightScans.get(`${dataDir}::${enginePath}`);
  if (inFlight) unitsyncCancel({ opId: inFlight.opId });
}

/**
 * Fetch (or read from cache) a unitsync scan for a target, populating
 * `scanCache`. Shared by the page hook and the launch warm-up so both read the
 * same cache. `force` re-runs the scan even on a cache hit, and clears any
 * cached failure for the target.
 */
export async function primeScan(
  enginePath: string,
  dataDir: string,
  force = false,
): Promise<ScanResult> {
  const key = `${dataDir}::${enginePath}`;
  if (force) {
    scanErrorCache.delete(key);
    // A forced rescan can surface content added since the last scan; bump the
    // target's epoch so the derived batch loaders (map thumbnails, game headers)
    // refetch instead of serving their now-stale session cache.
    bumpScanEpoch(key);
  }
  const cached = scanCache.get(key);
  if (!force && cached) return cached;
  const cachedErr = scanErrorCache.get(key);
  if (!force && cachedErr) throw new Error(cachedErr);
  // Join a scan already running for this target rather than starting a second.
  const inFlight = inFlightScans.get(key);
  if (inFlight) return inFlight.promise;

  const opId = crypto.randomUUID();
  const promise = (async () => {
    try {
      const res = await unitsyncScan({ enginePath, dataDir, opId });
      scanCache.set(key, res);
      return res;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // A user cancellation isn't a target failure — don't poison the error
      // cache, or the next open would resurface "cancelled" as a scan error.
      if (!/cancelled/i.test(msg)) scanErrorCache.set(key, msg);
      throw e;
    } finally {
      inFlightScans.delete(key);
    }
  })();
  inFlightScans.set(key, { promise, opId });
  return promise;
}

/**
 * Drop every cached unitsync scan so the next open re-scans from disk. Called
 * after a content download so a freshly-installed game/map shows up (e.g. in the
 * singleplayer picker) without a manual rescan. Also bumps each known target's
 * epoch so the derived batch loaders (thumbnails, headers) refetch. Lazy by
 * design: an already-mounted picker refreshes when it next reads the cache
 * (typically on re-navigation after the download).
 */
export function invalidateScans(): void {
  const keys = new Set([...scanCache.keys(), ...scanErrorCache.keys()]);
  scanCache.clear();
  scanErrorCache.clear();
  for (const key of keys) bumpScanEpoch(key);
}

/* -------------------------------------------------------------------------- *
 * Content epoch — a per-target counter bumped on each forced rescan. The batch
 * loaders (map thumbnails, game headers) fold it into their cache key + effect
 * deps so a rescan refetches content added since the last scan instead of serving
 * a stale session cache.
 * -------------------------------------------------------------------------- */

const scanEpochs = new Map<string, number>();
const epochListeners = new Set<() => void>();

/** Bump a target's content epoch (keyed like the scan cache) and notify. */
function bumpScanEpoch(key: string) {
  scanEpochs.set(key, (scanEpochs.get(key) ?? 0) + 1);
  for (const l of epochListeners) l();
}

/** Subscribe to a target's content epoch; changes on each forced rescan. */
export function useScanEpoch(enginePath?: string, dataDir?: string): number {
  const key = enginePath && dataDir ? `${dataDir}::${enginePath}` : "";
  return useSyncExternalStore(
    (cb) => {
      epochListeners.add(cb);
      return () => epochListeners.delete(cb);
    },
    () => (key ? (scanEpochs.get(key) ?? 0) : 0),
  );
}

/** Run / read a cached unitsync scan for the given target. */
export function useUnitsyncScan(enginePath?: string, dataDir?: string) {
  const [data, setData] = useState<ScanResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cancelled, setCancelled] = useState(false);

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
      setCancelled(false);
      try {
        setData(await primeScan(enginePath, dataDir, force));
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        // A cancel lands in a stable "cancelled" state rather than an error.
        if (/cancelled/i.test(msg)) setCancelled(true);
        else setError(msg);
      } finally {
        setLoading(false);
      }
    },
    [enginePath, dataDir],
  );

  const cancel = useCallback(() => {
    cancelScan(enginePath, dataDir);
  }, [enginePath, dataDir]);

  // When a target becomes available, show its content immediately: serve the
  // cached result, or auto-scan on first open. `run(false)` does exactly that.
  useEffect(() => {
    if (!enginePath || !dataDir) {
      setData(null);
      return;
    }
    run(false);
  }, [enginePath, dataDir, run]);

  return { data, loading, error, cancelled, run, cancel };
}

/** A rendered map thumbnail plus its true proportions (for undistorted display). */
export interface MapThumbData {
  dataUrl: string;
  width?: number;
  height?: number;
}

/** Session cache of batch thumbnails, keyed by `dataDir::enginePath`. */
const thumbnailsCache = new Map<string, Map<string, MapThumbData>>();

/**
 * Render (or read from cache) every map's thumbnail for a target, populating
 * `thumbnailsCache` (name -> thumbnail + dimensions). Shared by the page hook and
 * the launch warm-up. The PNGs themselves are cached on disk by the worker, so
 * this is fast after the first run even across restarts.
 */
export async function primeThumbnails(
  enginePath: string,
  dataDir: string,
  epoch = 0,
): Promise<Map<string, MapThumbData>> {
  const key = `${dataDir}::${enginePath}::${epoch}`;
  const cached = thumbnailsCache.get(key);
  if (cached) return cached;
  const res = await unitsyncThumbnails({ enginePath, dataDir, mip: 3 });
  const map = new Map(
    res.thumbnails.map((t) => [
      t.name,
      { dataUrl: t.dataUrl, width: t.width, height: t.height },
    ]),
  );
  thumbnailsCache.set(key, map);
  return map;
}

/** Lazily render and cache thumbnails for every map (name -> thumbnail + dims). */
export function useUnitsyncThumbnails(enginePath?: string, dataDir?: string) {
  const epoch = useScanEpoch(enginePath, dataDir);
  const [thumbs, setThumbs] = useState<Map<string, MapThumbData>>(new Map());
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enginePath || !dataDir) {
      setThumbs(new Map());
      return;
    }
    let cancelled = false;
    setLoading(true);
    primeThumbnails(enginePath, dataDir, epoch)
      .then((map) => {
        if (!cancelled) setThumbs(map);
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
  }, [enginePath, dataDir, epoch]);

  return { thumbs, loading };
}

/**
 * Resolution state of a lazy unitsync info fetch. Distinguishes the two silent
 * failures the callers care about — a resolved-but-unhashable result
 * (`unsyncable`, checksum came back 0) and a worker/IPC failure (`error`) — from
 * genuine in-flight work (`loading`), so the UI needn't conflate them.
 */
export type UnitsyncInfoStatus =
  | "idle"
  | "loading"
  | "ready"
  | "unsyncable"
  | "error";

/** Session cache of game info, keyed by `dataDir::enginePath::gameArchive`. */
const gameInfoCache = new Map<string, GameInfoResult>();

/** Lazily load a game's sides + unit count (loads the game's archive set). */
export function useUnitsyncGameInfo(
  enginePath?: string,
  dataDir?: string,
  gameArchive?: string,
) {
  const [info, setInfo] = useState<GameInfoResult | null>(null);
  const [status, setStatus] = useState<UnitsyncInfoStatus>("idle");
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((n) => n + 1), []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: nonce is a manual retry trigger that re-runs the fetch, not read in the body
  useEffect(() => {
    if (!enginePath || !dataDir || !gameArchive) {
      setInfo(null);
      setStatus("idle");
      return;
    }
    const key = `${dataDir}::${enginePath}::${gameArchive}`;
    const cached = gameInfoCache.get(key);
    if (cached) {
      setInfo(cached);
      setStatus("ready");
      return;
    }
    let cancelled = false;
    setStatus("loading");
    unitsyncGameInfo({ enginePath, dataDir, gameArchive })
      .then((res) => {
        if (cancelled) return;
        setInfo(res);
        // Only a syncable result is cached (mirrors the worker's disk cache), so
        // a zero-checksum result stays retryable rather than sticking forever.
        if (res.checksum) {
          gameInfoCache.set(key, res);
          setStatus("ready");
        } else {
          setStatus("unsyncable");
        }
      })
      .catch(() => {
        if (!cancelled) {
          setInfo(null);
          setStatus("error");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [enginePath, dataDir, gameArchive, nonce]);

  return { info, status, reload, loading: status === "loading" };
}

/**
 * Drop a game's session-cached info so the next `reload()` refetches from the
 * worker instead of serving the cache. Needed by "reload units"-style retries:
 * a ready result is cached for the session, so `reload()` alone would no-op.
 */
export function invalidateGameInfo(
  enginePath?: string,
  dataDir?: string,
  gameArchive?: string,
) {
  if (!enginePath || !dataDir || !gameArchive) return;
  gameInfoCache.delete(`${dataDir}::${enginePath}::${gameArchive}`);
}

/** Session cache of unit datasets, keyed by `dataDir::enginePath::gameArchive`. */
const unitDatasetCache = new Map<string, UnitDatasetResult>();

/**
 * Lazily load a game's reusable unit graph (units + `buildoptions` edges). Loads
 * the game's archive set, so it's fetched on demand — never during the scan.
 * Cached for the session only when syncable (mirrors the worker's disk cache).
 */
export function useUnitsyncUnitDataset(
  enginePath?: string,
  dataDir?: string,
  gameArchive?: string,
) {
  const [dataset, setDataset] = useState<UnitDatasetResult | null>(null);
  const [status, setStatus] = useState<UnitsyncInfoStatus>("idle");
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((n) => n + 1), []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: nonce is a manual retry trigger that re-runs the fetch, not read in the body
  useEffect(() => {
    if (!enginePath || !dataDir || !gameArchive) {
      setDataset(null);
      setStatus("idle");
      return;
    }
    const key = `${dataDir}::${enginePath}::${gameArchive}`;
    const cached = unitDatasetCache.get(key);
    if (cached) {
      setDataset(cached);
      setStatus("ready");
      return;
    }
    let cancelled = false;
    setStatus("loading");
    unitsyncUnitDataset({ enginePath, dataDir, gameArchive })
      .then((res) => {
        if (cancelled) return;
        setDataset(res);
        // A game whose unit defs would not load comes back with no units and a
        // reason, which reads exactly like a game that ships none. Anything
        // asking for a unit list needs to be able to tell those apart.
        if (res.units.length === 0 && res.errors.length > 0) {
          setStatus("error");
          return;
        }
        // Only a syncable result is cached (mirrors the worker's disk cache), so
        // a zero-checksum result stays retryable rather than sticking forever.
        if (res.checksum) {
          unitDatasetCache.set(key, res);
          setStatus("ready");
        } else {
          setStatus("unsyncable");
        }
      })
      .catch(() => {
        if (!cancelled) {
          setDataset(null);
          setStatus("error");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [enginePath, dataDir, gameArchive, nonce]);

  return { dataset, status, reload, loading: status === "loading" };
}

/** Session cache of read models, keyed by `dataDir::engine::game::object`. */
const unitModelCache = new Map<string, UnitModelResult>();
/** In-flight reads, so a view asking for the same model twice waits once. */
const unitModelPending = new Map<string, Promise<UnitModelResult>>();

/**
 * Read one unit's model, off the session cache when it is already there.
 *
 * The promise behind {@link useUnitsyncUnitModel}, for a view that needs many
 * models at once rather than one: the scenario editor draws every unit a
 * document places, which is a list it only knows at render time and cannot turn
 * into a fixed number of hook calls.
 */
export function loadUnitsyncUnitModel(
  enginePath: string,
  dataDir: string,
  gameArchive: string,
  object: string,
): Promise<UnitModelResult> {
  const key = `${dataDir}::${enginePath}::${gameArchive}::${object}`;
  const cached = unitModelCache.get(key);
  if (cached) return Promise.resolve(cached);
  const inFlight = unitModelPending.get(key);
  if (inFlight) return inFlight;
  const read = unitsyncUnitModel({ enginePath, dataDir, gameArchive, object })
    .then((res) => {
      unitModelCache.set(key, res);
      return res;
    })
    .finally(() => unitModelPending.delete(key));
  unitModelPending.set(key, read);
  return read;
}

/**
 * Read one unit's model out of a game's archive. Mounts the game's archive set,
 * so it is fetched on demand and cached for the session, including a result that
 * only carries errors: a unit whose model is missing stays missing until the
 * content is rescanned, and re-mounting the archive to be told so again is a
 * second or more each time.
 */
export function useUnitsyncUnitModel(
  enginePath?: string,
  dataDir?: string,
  gameArchive?: string,
  object?: string,
) {
  const [model, setModel] = useState<UnitModelResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!enginePath || !dataDir || !gameArchive || !object) {
      setModel(null);
      setLoading(false);
      setFailed(false);
      return;
    }
    const key = `${dataDir}::${enginePath}::${gameArchive}::${object}`;
    const cached = unitModelCache.get(key);
    if (cached) {
      setModel(cached);
      setLoading(false);
      setFailed(false);
      return;
    }
    let cancelled = false;
    setModel(null);
    setFailed(false);
    setLoading(true);
    loadUnitsyncUnitModel(enginePath, dataDir, gameArchive, object)
      .then((res) => {
        if (cancelled) return;
        setModel(res);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setFailed(true);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [enginePath, dataDir, gameArchive, object]);

  return { model, loading, failed };
}

/** Session cache of unit build icons, keyed by dataDir::engine::game::units. */
const buildpicsCache = new Map<string, UnitBuildpicsResult>();

/** Lazily resolve build icons for a game's start units. */
export function useUnitsyncUnitBuildpics(
  enginePath?: string,
  dataDir?: string,
  gameArchive?: string,
  units?: string[],
) {
  const [data, setData] = useState<UnitBuildpicsResult | null>(null);
  // Stable, order-independent key for the requested unit set. The effect derives
  // the unit list back from this string so it depends only on stable values
  // (arrays are unstable references that would refetch every render).
  const unitsKey = (units ?? []).slice().sort().join(",");

  useEffect(() => {
    if (!enginePath || !dataDir || !gameArchive || unitsKey === "") {
      setData(null);
      return;
    }
    const unitList = unitsKey.split(",");
    const key = `${dataDir}::${enginePath}::${gameArchive}::${unitsKey}`;
    const cached = buildpicsCache.get(key);
    if (cached) {
      setData(cached);
      return;
    }
    let cancelled = false;
    unitsyncUnitBuildpics({
      enginePath,
      dataDir,
      gameArchive,
      units: unitList,
    })
      .then((res) => {
        if (cancelled) return;
        buildpicsCache.set(key, res);
        setData(res);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [enginePath, dataDir, gameArchive, unitsKey]);

  return data;
}

/**
 * Gather resolved build pics for an export: merge every cached buildpics entry
 * for this game (whatever the open drawer already fetched across factions), then
 * make a single unitsync call for any units still missing a pic so an
 * all-factions export is complete even for tabs the user never opened. Seeds the
 * shared cache. Returns an id -> display map; units that resolve to nothing are
 * simply absent (the exporter renders a "no pic" placeholder).
 */
export async function gatherExportPics(
  enginePath: string,
  dataDir: string,
  gameArchive: string,
  unitIds: string[],
): Promise<Record<string, UnitDisplay>> {
  const prefix = `${dataDir}::${enginePath}::${gameArchive}::`;
  const merged: Record<string, UnitDisplay> = {};
  for (const [key, res] of buildpicsCache) {
    if (!key.startsWith(prefix)) continue;
    for (const [id, display] of Object.entries(res.units)) merged[id] = display;
  }
  const missing = unitIds.filter((id) => !merged[id]);
  if (missing.length > 0) {
    const res = await unitsyncUnitBuildpics({
      enginePath,
      dataDir,
      gameArchive,
      units: missing,
    });
    const key = `${prefix}${missing.slice().sort().join(",")}`;
    buildpicsCache.set(key, res);
    for (const [id, display] of Object.entries(res.units)) merged[id] = display;
  }
  return merged;
}

/** Session cache of map info, keyed by `dataDir::enginePath::mapName`. */
const mapInfoCache = new Map<string, MapInfoResult>();

/** Lazily load one map's options + warnings (mounts the map's archive). */
export function useUnitsyncMapInfo(
  enginePath?: string,
  dataDir?: string,
  mapName?: string,
) {
  const [info, setInfo] = useState<MapInfoResult | null>(null);
  const [status, setStatus] = useState<UnitsyncInfoStatus>("idle");
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((n) => n + 1), []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: nonce is a manual retry trigger that re-runs the fetch, not read in the body
  useEffect(() => {
    if (!enginePath || !dataDir || !mapName) {
      setInfo(null);
      setStatus("idle");
      return;
    }
    const key = `${dataDir}::${enginePath}::${mapName}`;
    const cached = mapInfoCache.get(key);
    if (cached) {
      setInfo(cached);
      setStatus("ready");
      return;
    }
    let cancelled = false;
    setStatus("loading");
    unitsyncMapInfo({ enginePath, dataDir, mapName })
      .then((res) => {
        if (cancelled) return;
        setInfo(res);
        // Only a syncable result is cached (mirrors the worker's disk cache), so
        // a zero-checksum result stays retryable rather than sticking forever.
        if (res.checksum) {
          mapInfoCache.set(key, res);
          setStatus("ready");
        } else {
          setStatus("unsyncable");
        }
      })
      .catch(() => {
        if (!cancelled) {
          setInfo(null);
          setStatus("error");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [enginePath, dataDir, mapName, nonce]);

  return { info, status, reload, loading: status === "loading" };
}

/** Session cache of engine config reads, keyed by `dataDir::enginePath`. */
const engineConfigCache = new Map<string, EngineConfigResult>();

/**
 * Read / hold the curated engine settings for the selected target. Modeled on
 * `useUnitsyncScan`: serves the cached read or runs on target change, with an
 * explicit `run(true)` for the toolbar's Rescan. Cheap (no archive scan), but
 * cached for the session for consistency with the other browser hooks.
 */
export function useUnitsyncEngineConfig(enginePath?: string, dataDir?: string) {
  const [data, setData] = useState<EngineConfigResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (force = false) => {
      if (!enginePath || !dataDir) return;
      const key = `${dataDir}::${enginePath}`;
      if (!force && engineConfigCache.has(key)) {
        setData(engineConfigCache.get(key) ?? null);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const res = await unitsyncEngineConfig({ enginePath, dataDir });
        engineConfigCache.set(key, res);
        setData(res);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    },
    [enginePath, dataDir],
  );

  // Write one setting, then reflect the new value in both local state and the
  // session cache (the cache short-circuits re-reads, so it must stay in sync).
  const write = useCallback(
    async (key: string, value: string) => {
      if (!enginePath || !dataDir) {
        return { ok: false, errors: ["no engine selected"] };
      }
      const res = await unitsyncEngineConfigSet({
        enginePath,
        dataDir,
        key,
        value,
      });
      if (res.ok) {
        const cacheKey = `${dataDir}::${enginePath}`;
        setData((prev) => {
          if (!prev) return prev;
          const next: EngineConfigResult = {
            ...prev,
            settings: prev.settings.map((s) =>
              s.key === key ? { ...s, value } : s,
            ),
          };
          engineConfigCache.set(cacheKey, next);
          return next;
        });
      }
      return res;
    },
    [enginePath, dataDir],
  );

  useEffect(() => {
    if (!enginePath || !dataDir) {
      setData(null);
      return;
    }
    run(false);
  }, [enginePath, dataDir, run]);

  return { data, loading, error, run, write };
}

/* -------------------------------------------------------------------------- *
 * Archives — a unified, classified view derived from the scan, plus lazy
 * member-tree and member-preview loaders.
 * -------------------------------------------------------------------------- */

export type ArchiveKind = "map" | "game" | "other";

/** How a single archive is classified within a scan. */
export interface ArchiveClassification {
  kind: ArchiveKind;
  /** True when the archive is a game's *primary* (own) archive. */
  primary: boolean;
  /** The map this archive backs (when `kind === "map"`). */
  mapName?: string;
  /** The game this archive backs (when `kind === "game"`). */
  gameName?: string;
}

/** An archive plus its classification, for the Archives list/detail. */
export type ClassifiedArchive = Archive & ArchiveClassification;

/**
 * Classify one archive by name against a scan: a game's own archive is `game`
 * (primary), a map's own archive (its first listed archive) is `map`, and
 * everything else is `other`. Used by the Map/Game detail rows.
 */
export function classifyArchive(
  data: ScanResult | null | undefined,
  name: string,
): ArchiveClassification {
  if (!data) return { kind: "other", primary: false };
  const game = data.games.find((g) => g.primaryArchive.name === name);
  if (game) return { kind: "game", primary: true, gameName: game.name };
  const map = data.maps.find((m) => m.archives[0]?.name === name);
  if (map) return { kind: "map", primary: false, mapName: map.name };
  return { kind: "other", primary: false };
}

/**
 * The deduped union of every archive a scan references — game primaries, map
 * primaries, and all dependency archives — each classified. Archives can appear
 * under several maps/games, so we dedup by name, prefer the entry carrying
 * `path`/`size`, and upgrade an `other` classification when a more specific one
 * (map/game) is seen.
 */
function buildArchiveList(data: ScanResult | null): ClassifiedArchive[] {
  if (!data) return [];
  const byName = new Map<string, ClassifiedArchive>();

  const add = (a: Archive, cls: ArchiveClassification) => {
    const existing = byName.get(a.name);
    if (!existing) {
      byName.set(a.name, { ...a, ...cls });
      return;
    }
    existing.path ??= a.path;
    existing.size ??= a.size;
    existing.checksum ??= a.checksum;
    // Upgrade a generic "other" to a specific map/game classification.
    if (existing.kind === "other" && cls.kind !== "other") {
      existing.kind = cls.kind;
      existing.primary = cls.primary;
      existing.mapName = cls.mapName;
      existing.gameName = cls.gameName;
    }
  };

  for (const g of data.games) {
    add(g.primaryArchive, { kind: "game", primary: true, gameName: g.name });
    for (const dep of g.dependencyArchives)
      add(dep, { kind: "other", primary: false });
  }
  for (const m of data.maps) {
    // The map's own archive is listed first; the rest are shared dependencies.
    m.archives.forEach((a, i) => {
      add(
        a,
        i === 0
          ? { kind: "map", primary: false, mapName: m.name }
          : { kind: "other", primary: false },
      );
    });
  }

  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Scan a target and expose its archives as one classified, deduped list. */
export function useArchives(enginePath?: string, dataDir?: string) {
  const { data, loading, error, cancelled, run, cancel } = useUnitsyncScan(
    enginePath,
    dataDir,
  );
  const archives = useMemo(() => buildArchiveList(data), [data]);
  return { archives, data, loading, error, cancelled, run, cancel };
}

/** Session cache of archive member trees, keyed by `dataDir::enginePath::archive`. */
const archiveTreeCache = new Map<string, ArchiveTreeResult>();

/** Lazily list one archive's member tree (one unitsync session per archive). */
export function useUnitsyncArchiveTree(
  enginePath?: string,
  dataDir?: string,
  archive?: string,
) {
  const [tree, setTree] = useState<ArchiveTreeResult | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enginePath || !dataDir || !archive) {
      setTree(null);
      return;
    }
    const key = `${dataDir}::${enginePath}::${archive}`;
    const cached = archiveTreeCache.get(key);
    if (cached) {
      setTree(cached);
      return;
    }
    let cancelled = false;
    setLoading(true);
    unitsyncArchiveTree({ enginePath, dataDir, archive })
      .then((res) => {
        if (cancelled) return;
        archiveTreeCache.set(key, res);
        setTree(res);
      })
      .catch(() => {
        if (!cancelled) setTree(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [enginePath, dataDir, archive]);

  return { tree, loading };
}

/** Session cache of member previews, keyed by `dataDir::enginePath::archive::file`. */
const archiveFileCache = new Map<string, ArchiveFileResult>();

/** Lazily read one archive member for preview (fetches only when a file is set). */
export function useUnitsyncArchiveFile(
  enginePath?: string,
  dataDir?: string,
  archive?: string,
  file?: string,
) {
  const [data, setData] = useState<ArchiveFileResult | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enginePath || !dataDir || !archive || !file) {
      setData(null);
      return;
    }
    const key = `${dataDir}::${enginePath}::${archive}::${file}`;
    const cached = archiveFileCache.get(key);
    if (cached) {
      setData(cached);
      return;
    }
    let cancelled = false;
    setLoading(true);
    unitsyncArchiveFile({ enginePath, dataDir, archive, file })
      .then((res) => {
        if (cancelled) return;
        archiveFileCache.set(key, res);
        setData(res);
      })
      .catch(() => {
        if (!cancelled) setData(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [enginePath, dataDir, archive, file]);

  return { data, loading };
}

/** Session cache of batch game-header art, keyed by `dataDir::enginePath::epoch`. */
const gameHeadersCache = new Map<string, Map<string, string>>();

/**
 * Render (or read from cache) header art for every game of a target, populating
 * `gameHeadersCache` (game name -> data URL). Games with no usable art are
 * omitted. The images are cached on disk by the worker (keyed on cheap file
 * identity), so this is fast after the first run even across restarts.
 */
export async function primeGameHeaders(
  enginePath: string,
  dataDir: string,
  epoch = 0,
): Promise<Map<string, string>> {
  const key = `${dataDir}::${enginePath}::${epoch}`;
  const cached = gameHeadersCache.get(key);
  if (cached) return cached;
  const res = await unitsyncGameHeaders({ enginePath, dataDir });
  const map = new Map<string, string>();
  for (const h of res.headers) if (h.dataUrl) map.set(h.name, h.dataUrl);
  gameHeadersCache.set(key, map);
  return map;
}

/** Lazily render and cache header art for every game (name -> data URL). */
export function useUnitsyncGameHeaders(enginePath?: string, dataDir?: string) {
  const epoch = useScanEpoch(enginePath, dataDir);
  const [headers, setHeaders] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enginePath || !dataDir) {
      setHeaders(new Map());
      return;
    }
    let cancelled = false;
    setLoading(true);
    primeGameHeaders(enginePath, dataDir, epoch)
      .then((map) => {
        if (!cancelled) setHeaders(map);
      })
      .catch(() => {
        if (!cancelled) setHeaders(new Map());
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [enginePath, dataDir, epoch]);

  return { headers, loading };
}

/** Session cache of minimap results, keyed by `dataDir::enginePath::mapName`. */
const minimapCache = new Map<string, MinimapResult>();

/** Lazily render and cache a map's minimap + start positions for the detail page. */
export function useUnitsyncMinimap(
  enginePath?: string,
  dataDir?: string,
  mapName?: string,
) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [startPositions, setStartPositions] = useState<StartPos[]>([]);
  const [env, setEnv] = useState<{
    minWind?: number;
    maxWind?: number;
    tidalStrength?: number;
  }>({});
  // mapinfo.lua water/sky/sun hints, shaped like the mapconv `MapAppearance` so
  // the 3D preview lights and colours content maps the way the engine would.
  const [appearance, setAppearance] = useState<MapAppearance | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recordAppearance = useRecordMapAppearance();

  useEffect(() => {
    if (!enginePath || !dataDir || !mapName) {
      setDataUrl(null);
      setStartPositions([]);
      setEnv({});
      setAppearance(null);
      return;
    }
    const key = `${dataDir}::${enginePath}::${mapName}`;
    const apply = (res: MinimapResult) => {
      setDataUrl(res.dataUrl ?? null);
      setStartPositions(res.startPositions ?? []);
      setEnv({
        minWind: res.minWind,
        maxWind: res.maxWind,
        tidalStrength: res.tidalStrength,
      });
      const appearance: MapAppearance = {
        voidWater: res.voidWater,
        voidGround: res.voidGround,
        voidAlphaMin: res.voidAlphaMin,
        waterColor: res.waterColor,
        waterAlpha: res.waterAlpha,
        waterPlaneColor: res.waterPlaneColor,
        waterAbsorb: res.waterAbsorb,
        waterBaseColor: res.waterBaseColor,
        waterMinColor: res.waterMinColor,
        forceRendering: res.forceRendering,
        skyColor: res.skyColor,
        fogColor: res.fogColor,
        cloudColor: res.cloudColor,
        cloudDensity: res.cloudDensity,
        sunDir: res.sunDir,
        sunColor: res.sunColor,
        groundAmbientColor: res.groundAmbientColor,
        groundDiffuseColor: res.groundDiffuseColor,
        groundSpecularColor: res.groundSpecularColor,
        groundShadowDensity: res.groundShadowDensity,
      };
      setAppearance(appearance);
      // Bank it in the opportunistic cache so conquest (and future features)
      // can read a map's appearance without mounting its archive themselves.
      if (mapName) recordAppearance(mapName, appearance);
      if (!res.dataUrl && res.errors?.length) setError(res.errors.join("; "));
    };
    const cached = minimapCache.get(key);
    if (cached) {
      apply(cached);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    // mip 0 = 1024px, the engine's minimap ceiling — it's the diffuse texture
    // draped over the 3D preview (and the 2D minimap), so take the full res.
    unitsyncMinimap({ enginePath, dataDir, mapName, mip: 0 })
      .then((res) => {
        if (cancelled) return;
        minimapCache.set(key, res);
        apply(res);
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
  }, [enginePath, dataDir, mapName, recordAppearance]);

  return { dataUrl, startPositions, env, appearance, loading, error };
}

/** Session cache of heightmap results, keyed by `dataDir::enginePath::mapName`. */
const heightmapCache = new Map<string, HeightmapResult>();

/** Session cache of metalmap results, keyed by `dataDir::enginePath::mapName`. */
const metalmapCache = new Map<string, MetalmapResult>();

/**
 * Drop the cached minimap + heightmap for one map, so the next render of the
 * preview hooks refetches it. Used after a missing map is downloaded (remount the
 * preview subtree with a new React `key` to trigger the refetch).
 */
export function invalidateMapPreview(
  enginePath: string,
  dataDir: string,
  mapName: string,
) {
  const key = `${dataDir}::${enginePath}::${mapName}`;
  minimapCache.delete(key);
  heightmapCache.delete(key);
  metalmapCache.delete(key);
}

/** Lazily render and cache a map's heightmap (PNG data URL + world-height bounds). */
export function useUnitsyncHeightmap(
  enginePath?: string,
  dataDir?: string,
  mapName?: string,
) {
  const [data, setData] = useState<HeightmapResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enginePath || !dataDir || !mapName) {
      setData(null);
      return;
    }
    const key = `${dataDir}::${enginePath}::${mapName}`;
    const apply = (res: HeightmapResult) => {
      setData(res);
      if (!res.dataUrl && res.errors?.length) setError(res.errors.join("; "));
    };
    const cached = heightmapCache.get(key);
    if (cached) {
      apply(cached);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    unitsyncHeightmap({ enginePath, dataDir, mapName })
      .then((res) => {
        if (cancelled) return;
        heightmapCache.set(key, res);
        apply(res);
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

  return { data, loading, error };
}

/** Lazily render and cache a map's metal infomap (green-on-transparent PNG overlay). */
export function useUnitsyncMetalmap(
  enginePath?: string,
  dataDir?: string,
  mapName?: string,
) {
  const [data, setData] = useState<MetalmapResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enginePath || !dataDir || !mapName) {
      setData(null);
      return;
    }
    const key = `${dataDir}::${enginePath}::${mapName}`;
    const apply = (res: MetalmapResult) => {
      setData(res);
      if (!res.dataUrl && res.errors?.length) setError(res.errors.join("; "));
    };
    const cached = metalmapCache.get(key);
    if (cached) {
      apply(cached);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    unitsyncMetalmap({ enginePath, dataDir, mapName })
      .then((res) => {
        if (cancelled) return;
        metalmapCache.set(key, res);
        apply(res);
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

  return { data, loading, error };
}

/** Session cache of skybox results, keyed by `dataDir::enginePath::mapName`. */
const skyboxCache = new Map<string, MapSkyboxResult>();

/**
 * Lazily read and cache a map's skybox DDS (raw-bytes `data:` URL) for the 3D
 * preview's sky. `dataUrl` is null for the common case of a map without a skybox.
 */
export function useUnitsyncMapSkybox(
  enginePath?: string,
  dataDir?: string,
  mapName?: string,
) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!enginePath || !dataDir || !mapName) {
      setDataUrl(null);
      return;
    }
    const key = `${dataDir}::${enginePath}::${mapName}`;
    const cached = skyboxCache.get(key);
    if (cached) {
      setDataUrl(cached.dataUrl ?? null);
      return;
    }
    let cancelled = false;
    setDataUrl(null);
    unitsyncMapSkybox({ enginePath, dataDir, mapName })
      .then((res) => {
        if (cancelled) return;
        skyboxCache.set(key, res);
        setDataUrl(res.dataUrl ?? null);
      })
      // A skybox is optional; a failed read just leaves the flat sky colour.
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [enginePath, dataDir, mapName]);

  return { dataUrl };
}

/* -------------------------------------------------------------------------- *
 * Replays — list a root's demo files, and lazily decode one for its detail view.
 * -------------------------------------------------------------------------- */

/** List the replays in a content root (re-runs on `rootPath` change / refresh). */
export function useReplays(rootPath?: string) {
  const [replays, setReplays] = useState<ReplayFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The rootPath whose listing `replays`/`error` currently reflect. Until it
  // matches the requested rootPath the list hasn't loaded yet — which the UI
  // must distinguish from "loaded and empty" (a root with no replays), or it
  // would show a skeleton forever instead of an empty state.
  const [loadedFor, setLoadedFor] = useState<string | undefined>(undefined);

  const refresh = useCallback(async () => {
    if (!rootPath) {
      setReplays([]);
      setLoadedFor(undefined);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await contentListReplays({ root: rootPath });
      setReplays(res.replays);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadedFor(rootPath);
      setLoading(false);
    }
  }, [rootPath]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { replays, loading, error, refresh, ready: loadedFor === rootPath };
}

/** List the savegames in a content root (re-runs on `rootPath` change / refresh). */
export function useSaves(rootPath?: string) {
  const [saves, setSaves] = useState<SaveFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadedFor, setLoadedFor] = useState<string | undefined>(undefined);

  const refresh = useCallback(async () => {
    if (!rootPath) {
      setSaves([]);
      setLoadedFor(undefined);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await contentListSaves({ root: rootPath });
      setSaves(res.saves);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadedFor(rootPath);
      setLoading(false);
    }
  }, [rootPath]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { saves, loading, error, refresh, ready: loadedFor === rootPath };
}

/** Session cache of decoded demos, keyed by `enginePath::replayPath`. */
const demoInfoCache = new Map<string, DemoInfo>();

/**
 * Lazily decode one replay (native header + start-script, plus demotool's
 * winner). Cached for the session — decoding re-reads the file and runs demotool.
 */
export function useDemoInfo(enginePath?: string, replayPath?: string) {
  const [info, setInfo] = useState<DemoInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enginePath || !replayPath) {
      setInfo(null);
      return;
    }
    const key = `${enginePath}::${replayPath}`;
    const cached = demoInfoCache.get(key);
    if (cached) {
      setInfo(cached);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    contentDemoInfo({ enginePath, replayPath })
      .then((res) => {
        if (cancelled) return;
        demoInfoCache.set(key, res.info);
        setInfo(res.info);
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
  }, [enginePath, replayPath]);

  return { info, loading, error };
}

/* -------------------------------------------------------------------------- *
 * Replay stats — the local stats database (ingest + query). See `stats.rs`.
 * -------------------------------------------------------------------------- */

/**
 * Load the local stats database for the whole library: it ingests every root's
 * new/changed demos (idempotent, off the UI thread) then holds the record set.
 * `enginePath` locates demotool for the winner read; when absent the native decode
 * still records map/players/game. Re-runs when the set of roots or the engine
 * changes; `refresh` re-ingests on demand. An ingest failure falls back to a
 * read-only query so a decode error still shows whatever's already stored.
 */
export function useReplayStats(roots: string[], enginePath?: string) {
  const [records, setRecords] = useState<StatRecord[]>([]);
  const [summary, setSummary] = useState<IngestSummary | null>(null);
  const [ingesting, setIngesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Stable key so the effect depends on values, not the array's identity.
  const rootsKey = roots.join("|");

  const refresh = useCallback(async () => {
    const rootList = rootsKey ? rootsKey.split("|") : [];
    if (rootList.length === 0) {
      setRecords([]);
      setSummary(null);
      return;
    }
    setIngesting(true);
    setError(null);
    try {
      const res = await contentStatsIngest({
        roots: rootList,
        enginePath: enginePath ?? "",
      });
      setRecords(res.records);
      setSummary(res.summary);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      // Ingest failed — still surface whatever's already in the store.
      try {
        const q = await contentStatsQuery(undefined);
        setRecords(q.records);
      } catch {
        // Leave the last-known records in place.
      }
    } finally {
      setIngesting(false);
    }
  }, [rootsKey, enginePath]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Query-only refresh (no re-decode): used after the live watcher (#462) has
  // already ingested and saved a newly-arrived replay in the background, so
  // an open view just re-reads the store rather than re-running a full pass.
  // `watcherTotal`, when given, updates the visible total record count. It's
  // always the whole store's count, not just this one background pass. The
  // rest of `summary` (e.g. `failed`) is left as the last full scan reported,
  // since a single-file background pass can't speak to the whole library.
  const refreshFromQuery = useCallback(async (watcherTotal?: number) => {
    try {
      const q = await contentStatsQuery(undefined);
      setRecords(q.records);
      if (watcherTotal != null) {
        setSummary((prev) => (prev ? { ...prev, total: watcherTotal } : prev));
      }
    } catch {
      // Leave the last-known records in place.
    }
  }, []);

  // Keep the live watcher pointed at the current roots/engine for as long as
  // this hook is mounted, so a replay dropped into the demos folder while the
  // Stats view (or dossier) is open lands without reopening it. Scan-on-open
  // (the effect above) remains the fallback for replays that arrived while
  // nothing was watching.
  useEffect(() => {
    const rootList = rootsKey ? rootsKey.split("|") : [];
    if (rootList.length === 0) {
      contentStatsWatchStop(undefined).catch(() => {});
      return;
    }
    contentStatsWatchStart({
      roots: rootList,
      enginePath: enginePath ?? "",
    }).catch(() => {
      // No live watcher this session. Scan-on-open above still keeps the
      // store fresh on the next open.
    });
    return () => {
      contentStatsWatchStop(undefined).catch(() => {});
    };
  }, [rootsKey, enginePath]);

  // Refresh from the store whenever the watcher reports a background ingest.
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    listen<IngestSummary>(STATS_UPDATED_EVENT, (e) => {
      refreshFromQuery(e.payload.total);
    }).then((fn) => {
      if (cancelled) {
        fn();
      } else {
        unlisten = fn;
      }
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [refreshFromQuery]);

  return { records, summary, ingesting, error, refresh };
}
