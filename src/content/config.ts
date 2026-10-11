import { useSetting } from "@picoframe/frame";
import { listen } from "@tauri-apps/api/event";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { rememberShortnames } from "../container/shortnames";
import { unitsyncHeaderUrl, unitsyncThumbUrl } from "../lib/assetUrl";
import type { MapAppearance } from "../mapconv/bindings";
import {
  type Archive,
  type ArchiveFileResult,
  type ArchiveTreeResult,
  type ContentState,
  contentCandidates,
  contentDemoInfo,
  contentKeybindsRead,
  contentKeybindsWrite,
  contentListSaves,
  contentStatsIngest,
  contentStatsQuery,
  contentStatsWatchStart,
  contentStatsWatchStop,
  type DemoInfo,
  type EngineConfigResult,
  type GameInfoResult,
  type HeightFieldResult,
  type HeightmapResult,
  type IngestSummary,
  type MapInfoResult,
  type MapSkyboxResult,
  type MetalmapResult,
  type MinimapResult,
  type SaveFile,
  type ScanResult,
  STATS_UPDATED_EVENT,
  type MatchSetup,
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
  unitsyncHeightField,
  unitsyncHeightmap,
  unitsyncMapInfo,
  unitsyncMapMeta,
  unitsyncMapSkybox,
  unitsyncMetalmap,
  unitsyncMinimap,
  unitsyncScan,
  unitsyncThumbnails,
  unitsyncUnitBuildpics,
  unitsyncUnitDataset,
  unitsyncUnitModels,
} from "./bindings";
import { liveCacheHit } from "./cachedFile";
import { useContentState } from "./contentState";
import { engineLabel, newestEngineId } from "./engineVersion";
import { settleWithin, shareInFlight } from "./inFlight";
import { invalidateInstalledContent } from "./installedContent";
import { writeLastScan } from "./lastScan";
import { useRecordMapAppearance } from "./mapAppearanceCache";
import { readCachedModel } from "./modelFile";
import { forgetScanHints, rememberScanHints } from "./scanHints";
import { deriveSetup } from "./setup";
import { unitIconDataUrl } from "./unitIcon";

export type { SetupStatus } from "./setup";

/** Lightweight UI prefs (the only thing routed through the frame settings store;
 * the roots/engines themselves live in the plugin's own Rust state.json). */
export interface ContentPrefs {
  /** Rescan automatically the first time the Content pages open. */
  autoScanOnStartup: boolean;
  /** Fetch the download indexes, engine lists and hub games list after launch. */
  fetchListsInBackground: boolean;
  /** Also probe Steam/Zero-K install locations during detection. */
  probeZeroK: boolean;
  /** Snapshot the current engine config to an "Auto-backup" profile before a restore. */
  autoBackupEngineConfig: boolean;
}

export const defaultPrefs: ContentPrefs = {
  autoScanOnStartup: true,
  fetchListsInBackground: true,
  probeZeroK: false,
  autoBackupEngineConfig: false,
};

export function useContentPrefs() {
  return useSetting<ContentPrefs>("content.prefs", defaultPrefs);
}

export { useContentState };

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

/**
 * How to name a target where somebody has to choose one: by its engine.
 *
 * Not by its content folder, which the picker used to show alongside. The
 * engine's own `SPRING_DATADIR` handling is additive rather than exclusive (it
 * adds `~/.spring` and its own folder whatever coilbox passes), so the folder
 * half of a target never narrowed what a scan came back with. Naming it there
 * promised a filter that does not exist.
 */
export function targetLabel(t: ScanTarget): string {
  return engineLabel({ version: t.engineVersion, path: t.enginePath });
}

/** Flatten the content state into every (root, engine) scan target. */
export function targetsFromState(state: ContentState | null): ScanTarget[] {
  return (state?.roots ?? [])
    .filter((r) => r.engines.length > 0)
    .flatMap((r) =>
      r.engines.map((e) => ({
        rootPath: r.path,
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

/**
 * The archive record the last scan gave a game, by the file name of its primary
 * archive, or undefined when the target has not been scanned this session. For
 * a cache key that needs the archive's size and CRC without waiting on a scan.
 */
export function scannedGameArchive(
  enginePath: string,
  dataDir: string,
  archiveName: string,
): Archive | undefined {
  return scanCache
    .get(`${dataDir}::${enginePath}`)
    ?.games.find((g) => g.primaryArchive.name === archiveName)?.primaryArchive;
}

/** Session cache of scan *failures*, so a failed target doesn't silently re-run
 * a multi-minute scan on every navigation. Cleared by a forced retry. */
const scanErrorCache = new Map<string, string>();

/**
 * A scan whose unitsync `Init` failed. The worker prints a result for it, with
 * empty lists and the engine's reason, so the scan did not throw. That result
 * does not say what is installed, so `primeScan` throws this instead of handing
 * it out as an answer, and carries the result for the two list pages that show
 * it beside the failure (issue #3423). The message is the engine's reason.
 */
export class ScanInitFailure extends Error {
  constructor(readonly result: ScanResult) {
    super(result.initFailure);
    this.name = "ScanInitFailure";
  }
}

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

/**
 * Scans that were running when the library changed on disk, keyed like the scan
 * cache. Such a scan may have listed the folders before the change, so its
 * answer is handed to nobody and the scan runs again.
 */
const staleScans = new Set<string>();

/**
 * The last scan kept for each target. Unlike `scanCache` it survives the
 * library changing, so the batch loaders hold what they have until the next
 * scan lands and read again only then.
 */
const landedScans = new Map<string, ScanResult>();
/** The targets whose last scan failed, until one lands. */
const failedScans = new Set<string>();
const landedListeners = new Set<() => void>();

/**
 * What a batch read of a target was made against: the last scan kept for it,
 * or, while its scans fail, the epoch they failed in. A failing target has no
 * newer scan to wait for, so there the epoch is what says the library may have
 * changed.
 */
type ScanToken = ScanResult | string | undefined;

function scanToken(key: string): ScanToken {
  return failedScans.has(key)
    ? `failed:${scanEpochs.get(key) ?? 0}`
    : landedScans.get(key);
}

/**
 * The target's {@link scanToken}, changing each time a batch read should be
 * made again. Holding it counts as a list on screen, so the target is rescanned
 * when the library changes.
 */
function useScanToken(enginePath?: string, dataDir?: string): ScanToken {
  const key = enginePath && dataDir ? `${dataDir}::${enginePath}` : "";
  useEffect(() => {
    if (!enginePath || !dataDir) return;
    return watchScans(enginePath, dataDir, () => {});
  }, [enginePath, dataDir]);
  return useSyncExternalStore(
    (cb) => {
      landedListeners.add(cb);
      epochListeners.add(cb);
      return () => {
        landedListeners.delete(cb);
        epochListeners.delete(cb);
      };
    },
    () => scanToken(key),
  );
}

/**
 * Told about every scan of a target as it starts, or `null` when what the
 * target's lists show has been deleted from.
 */
type ScanWatcher = (scan: Promise<ScanResult> | null) => void;

/** The mounted scan hooks of each target, keyed like the scan cache. */
const scanWatchers = new Map<
  string,
  { enginePath: string; dataDir: string; watchers: Set<ScanWatcher> }
>();

function watchScans(
  enginePath: string,
  dataDir: string,
  watcher: ScanWatcher,
): () => void {
  const key = `${dataDir}::${enginePath}`;
  let entry = scanWatchers.get(key);
  if (!entry) {
    entry = { enginePath, dataDir, watchers: new Set() };
    scanWatchers.set(key, entry);
  }
  entry.watchers.add(watcher);
  const watched = entry;
  return () => {
    watched.watchers.delete(watcher);
    if (watched.watchers.size === 0 && scanWatchers.get(key) === watched)
      scanWatchers.delete(key);
  };
}

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
    invalidateInstalledContent();
    // A forced rescan can surface content added since the last scan, so the
    // readers that follow the target's epoch read again.
    bumpScanEpoch(key);
  }
  const cached = scanCache.get(key);
  if (!force && cached) return cached;
  const cachedErr = scanErrorCache.get(key);
  if (!force && cachedErr) throw new Error(cachedErr);
  // Join a scan already running for this target rather than starting a second.
  const inFlight = inFlightScans.get(key);
  if (inFlight) return inFlight.promise;

  const running = { promise: undefined as never, opId: "" } as {
    promise: Promise<ScanResult>;
    opId: string;
  };
  running.promise = (async () => {
    let cancelled = false;
    try {
      // One scan, and one more for as long as the library changed under the
      // last. Whoever waits gets the answer of the scan nothing overtook.
      for (;;) {
        staleScans.delete(key);
        running.opId = crypto.randomUUID();
        let res: ScanResult;
        try {
          res = await unitsyncScan({ enginePath, dataDir, opId: running.opId });
          // Cached nowhere, not even as a failure: an `Init` that fails does
          // so fast, so the next open can afford to ask again, and by then the
          // disk may have room.
          if (res.initFailure) throw new ScanInitFailure(res);
        } catch (e) {
          cancelled = /cancelled/i.test(
            e instanceof Error ? e.message : `${e}`,
          );
          // A cancel is the user stopping the scan, so nothing restarts it.
          if (staleScans.has(key) && !cancelled) continue;
          throw e;
        }
        if (staleScans.has(key)) continue;
        scanCache.set(key, res);
        landedScans.set(key, res);
        failedScans.delete(key);
        for (const l of landedListeners) l();
        writeLastScan(enginePath, dataDir, res);
        // What a cached read of this library is looked up by (issue #3714).
        rememberScanHints(dataDir, enginePath, res);
        // The one place every game modinfo this machine reads goes through, so
        // it is where the shortnames are picked up. They outlive the build they
        // came from, so an export pinned to a superseded build still knows its
        // game's shortname (issue #1364).
        rememberShortnames(res.games);
        return res;
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // A cancel is not a failure of the target, so it is not kept as one, or
      // the next open would show "cancelled" as a scan error.
      if (!(e instanceof ScanInitFailure) && !cancelled)
        scanErrorCache.set(key, msg);
      // A rescan that failed leaves nothing to vouch for the answer before it,
      // so a page opened next must not be handed that answer. A cancel learned
      // nothing, so it keeps it (issue #3431).
      if (!cancelled) {
        scanCache.delete(key);
        forgetScanHints(dataDir, enginePath);
        failedScans.add(key);
        for (const l of landedListeners) l();
      }
      throw e;
    } finally {
      inFlightScans.delete(key);
      staleScans.delete(key);
    }
  })();
  inFlightScans.set(key, running);
  const watched = scanWatchers.get(key);
  if (watched) for (const w of [...watched.watchers]) w(running.promise);
  return running.promise;
}

/**
 * The newest scan of a target: the one running now, else the cached one, else
 * a fresh one. A reader woken while a rescan runs waits for that answer here
 * and does not take the one it replaces.
 */
export function currentScan(
  enginePath: string,
  dataDir: string,
): Promise<ScanResult> {
  const inFlight = inFlightScans.get(`${dataDir}::${enginePath}`);
  return inFlight ? inFlight.promise : primeScan(enginePath, dataDir);
}

/**
 * Drop every cached unitsync scan so the next open re-scans from disk. Called
 * after a content download so a freshly-installed game/map shows up (e.g. in the
 * singleplayer picker) without a manual rescan. Also bumps each known target's
 * epoch for the readers that follow it. A scan running now may have missed the
 * change, so it runs again before it answers. Nothing else rescans here: the
 * next read does, or {@link rescanMounted}.
 */
export function forgetScans(): void {
  invalidateInstalledContent();
  const keys = new Set([
    ...scanCache.keys(),
    ...scanErrorCache.keys(),
    ...failedScans,
  ]);
  scanCache.clear();
  scanErrorCache.clear();
  forgetScanHints();
  for (const key of inFlightScans.keys()) staleScans.add(key);
  for (const key of keys) bumpScanEpoch(key);
}

/**
 * Scan again for every target a mounted list is showing, one scan a target, so
 * the list updates where it is. A target with a fresh answer is left alone, and
 * so is one being scanned, since a scan the change overtook runs again itself.
 */
export function rescanMounted(): void {
  for (const [key, { enginePath, dataDir }] of scanWatchers) {
    if (scanCache.has(key) || inFlightScans.has(key)) continue;
    primeScan(enginePath, dataDir).catch(() => {});
  }
}

/**
 * The library changed on disk: forget every scan and rescan for the lists on
 * screen. `removed` is for a delete. A mounted list then drops what it shows
 * until the rescan answers, where after an install it keeps showing it.
 */
export function invalidateScans(removed = false): void {
  forgetScans();
  if (removed) {
    for (const { watchers } of scanWatchers.values())
      for (const w of [...watchers]) w(null);
  }
  rescanMounted();
}

/* -------------------------------------------------------------------------- *
 * Content epoch. A per-target counter bumped on each forced rescan and each
 * time the scans are forgotten. Readers outside this file fold it into their
 * cache key and effect deps, so they read again once the library may have
 * changed. The batch loaders here follow the scan answer itself instead (see
 * `batchForScan`), so they wait for the new scan and keep what they hold until
 * it lands.
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

/** What one run of the scan hook found, and why when it found nothing. */
export interface ScanOutcome {
  data: ScanResult | null;
  error: string | null;
}

/** Run / read a cached unitsync scan for the given target. */
export function useUnitsyncScan(enginePath?: string, dataDir?: string) {
  const [data, setData] = useState<ScanResult | null>(null);
  // The result of a scan whose `Init` failed. Not an answer, so it is not
  // `data`; only a page that shows the partial list beside the failure reads it.
  const [unvouched, setUnvouched] = useState<ScanResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cancelled, setCancelled] = useState(false);

  // The one scan path. Resolves with what the scan found and, when it found
  // nothing, the reason, so a caller that has to act on the answer need not
  // wait a render for `error`. A cancel has no reason: nothing went wrong.
  const runWithReason = useCallback(
    async (force = false): Promise<ScanOutcome> => {
      if (!enginePath || !dataDir) return { data: null, error: null };
      const key = `${dataDir}::${enginePath}`;
      if (!force && scanCache.has(key)) {
        const cached = scanCache.get(key) ?? null;
        setData(cached);
        setUnvouched(null);
        return { data: cached, error: null };
      }
      setLoading(true);
      setError(null);
      setUnvouched(null);
      setCancelled(false);
      try {
        const found = await primeScan(enginePath, dataDir, force);
        setData(found);
        return { data: found, error: null };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (e instanceof ScanInitFailure) setUnvouched(e.result);
        // A cancel lands in a stable "cancelled" state rather than an error,
        // and keeps the answer before it: nothing was learned. Any other
        // failure drops that answer, since the reason to rescan is that
        // something changed and the old lists no longer describe the install.
        if (/cancelled/i.test(msg)) {
          setCancelled(true);
          return { data: null, error: null };
        }
        setData(null);
        setError(msg);
        return { data: null, error: msg };
      } finally {
        setLoading(false);
      }
    },
    [enginePath, dataDir],
  );

  // Resolves with what the scan found, or null when it found nothing to
  // report (it threw, or its `Init` failed). Callers that show why use
  // `runWithReason`.
  const run = useCallback(
    async (force = false): Promise<ScanResult | null> =>
      (await runWithReason(force)).data,
    [runWithReason],
  );

  const cancel = useCallback(() => {
    cancelScan(enginePath, dataDir);
  }, [enginePath, dataDir]);

  // Take the answer of every scan of this target, whoever started it, so a
  // list updates where it is after a download, a delete or another screen's
  // rescan. `loading` is left alone, so the list is not swapped for a skeleton
  // while a scan nobody here asked for runs.
  useEffect(() => {
    if (!enginePath || !dataDir) return;
    let live = true;
    const take: ScanWatcher = (scan) => {
      if (!scan) {
        setData(null);
        return;
      }
      scan.then(
        (found) => {
          if (!live) return;
          setData(found);
          setUnvouched(null);
          setError(null);
          setCancelled(false);
        },
        (e) => {
          if (!live) return;
          const msg = e instanceof Error ? e.message : String(e);
          // As in `runWithReason`: a cancel keeps the answer before it, and
          // every hook of the target says it was cancelled, not only the one
          // whose page stopped it.
          if (/cancelled/i.test(msg)) {
            setCancelled(true);
            return;
          }
          if (e instanceof ScanInitFailure) setUnvouched(e.result);
          setData(null);
          setError(msg);
        },
      );
    };
    const stop = watchScans(enginePath, dataDir, take);
    // A scan already running when this mounted is one it was not told about.
    const running = inFlightScans.get(`${dataDir}::${enginePath}`);
    if (running) take(running.promise);
    return () => {
      live = false;
      stop();
    };
  }, [enginePath, dataDir]);

  // When a target becomes available, show its content immediately: serve the
  // cached result, or auto-scan on first open. `run(false)` does exactly that.
  useEffect(() => {
    if (!enginePath || !dataDir) {
      setData(null);
      setUnvouched(null);
      return;
    }
    run(false);
  }, [enginePath, dataDir, run]);

  return {
    data,
    unvouched,
    loading,
    error,
    cancelled,
    run,
    runWithReason,
    cancel,
  };
}

/**
 * A URL for one of the worker's rendered images. The worker reports the cache
 * file name whenever the render reached disk, which the webview fetches over the
 * asset protocol instead of paying for base64 on the bridge, and only inlines a
 * `data:` URL when nothing was cached. Either way callers get one URL string.
 */
function renderedUrl(
  res: { file?: string; dataUrl?: string },
  toUrl: (file: string) => string,
): string | null {
  if (res.file) return toUrl(res.file);
  return res.dataUrl ?? null;
}

/**
 * Wait for the target's scan before a batch read that names the scan's maps or
 * games, so the plugin has the list to answer from disk with (issue #3736). A
 * page that asks first would otherwise go without it and start a worker for an
 * answer already saved. A scan that fails is not this read's failure: it goes
 * on without a list and a worker answers, as it did before.
 *
 * The answer is kept beside the scan it was read for and is good for as long
 * as that scan is the newest. A newer scan means the library may have changed,
 * so the whole answer is read again in one call. It is one call and not one per
 * new archive because a worker reads the whole library whenever the plugin
 * cannot answer every archive named from disk (issue #3721).
 */
async function batchForScan<T>(
  cache: Map<string, { token: ScanToken; value: T }>,
  pending: Map<string, Promise<T>>,
  enginePath: string,
  dataDir: string,
  read: () => Promise<T>,
): Promise<T> {
  const key = `${dataDir}::${enginePath}`;
  const scan = await currentScan(enginePath, dataDir).catch(() => undefined);
  const token = scan ?? scanToken(key);
  const held = cache.get(key);
  if (held && held.token === token) return held.value;
  // Keyed on the token too, so a caller after a rescan does not join a read
  // that was opened before it.
  const open = typeof token === "string" ? token : scanSerial(token);
  return shareInFlight(pending, `${key}::${open}`, async () => {
    const value = await read();
    cache.set(key, { token, value });
    return value;
  });
}

/** A number for each scan answer, so an open read can be keyed on its scan. */
const scanSerials = new WeakMap<ScanResult, number>();
let lastScanSerial = 0;
function scanSerial(scan: ScanResult | undefined): number {
  if (!scan) return 0;
  let serial = scanSerials.get(scan);
  if (serial === undefined) {
    serial = ++lastScanSerial;
    scanSerials.set(scan, serial);
  }
  return serial;
}

/** A rendered map thumbnail plus its true proportions (for undistorted display). */
export interface MapThumbData {
  url: string;
  width?: number;
  height?: number;
}

/** Session cache of batch thumbnails, keyed by `dataDir::enginePath`. */
const thumbnailsCache = new Map<
  string,
  { token: ScanToken; value: Map<string, MapThumbData> }
>();
/** Open renders, keyed like the cache, so the warm-up and a page share one. */
const thumbnailsPending = new Map<string, Promise<Map<string, MapThumbData>>>();

/**
 * Render (or read from cache) every map's thumbnail for a target, populating
 * `thumbnailsCache` (name -> thumbnail + dimensions). Shared by the page hook and
 * the launch warm-up. The PNGs themselves are cached on disk by the worker, so
 * this is fast after the first run even across restarts.
 */
export async function primeThumbnails(
  enginePath: string,
  dataDir: string,
): Promise<Map<string, MapThumbData>> {
  return batchForScan(
    thumbnailsCache,
    thumbnailsPending,
    enginePath,
    dataDir,
    async () => {
      const res = await unitsyncThumbnails({ enginePath, dataDir, mip: 3 });
      const map = new Map<string, MapThumbData>();
      for (const t of res.thumbnails) {
        const url = renderedUrl(t, unitsyncThumbUrl);
        if (url) map.set(t.name, { url, width: t.width, height: t.height });
      }
      return map;
    },
  );
}

/** Lazily render and cache thumbnails for every map (name -> thumbnail + dims). */
export function useUnitsyncThumbnails(enginePath?: string, dataDir?: string) {
  const scan = useScanToken(enginePath, dataDir);
  const [thumbs, setThumbs] = useState<Map<string, MapThumbData>>(new Map());
  const [loading, setLoading] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: a newer scan is what re-runs the read, not read in the body
  useEffect(() => {
    if (!enginePath || !dataDir) {
      setThumbs(new Map());
      return;
    }
    let cancelled = false;
    setLoading(true);
    primeThumbnails(enginePath, dataDir)
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
  }, [enginePath, dataDir, scan]);

  return { thumbs, loading };
}

/** Session cache of batch map metadata, keyed by `dataDir::enginePath`. */
const mapMetaCache = new Map<
  string,
  { token: ScanToken; value: Map<string, Record<string, string>> }
>();
/** Open reads, keyed like the cache. */
const mapMetaPending = new Map<
  string,
  Promise<Map<string, Record<string, string>>>
>();

/**
 * Read (or serve from cache) every map's mapinfo metadata for a target, as
 * name -> info. The scan used to carry this, but `GetMapInfoEx` opens each map's
 * archive at about 86ms a map, so the whole maps list waited on it. Only the map
 * detail page and the singleplayer map card read it, and both tolerate it being
 * empty until this lands. The worker caches each map on disk, so after the first
 * run only new or replaced archives cost anything.
 */
export async function primeMapMeta(
  enginePath: string,
  dataDir: string,
): Promise<Map<string, Record<string, string>>> {
  return batchForScan(
    mapMetaCache,
    mapMetaPending,
    enginePath,
    dataDir,
    async () => {
      const res = await unitsyncMapMeta({ enginePath, dataDir });
      const map = new Map<string, Record<string, string>>();
      for (const m of res.maps) map.set(m.name, m.info);
      return map;
    },
  );
}

/** Lazily read and cache mapinfo metadata for every map (name -> info). */
export function useUnitsyncMapMeta(enginePath?: string, dataDir?: string) {
  const scan = useScanToken(enginePath, dataDir);
  const [meta, setMeta] = useState<Map<string, Record<string, string>>>(
    new Map(),
  );
  const [loading, setLoading] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: a newer scan is what re-runs the read, not read in the body
  useEffect(() => {
    if (!enginePath || !dataDir) {
      setMeta(new Map());
      return;
    }
    let cancelled = false;
    setLoading(true);
    primeMapMeta(enginePath, dataDir)
      .then((map) => {
        if (!cancelled) setMeta(map);
      })
      .catch(() => {
        if (!cancelled) setMeta(new Map());
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [enginePath, dataDir, scan]);

  return { meta, loading };
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
/** Open reads, so two askers for one game wait on one worker. */
const gameInfoPending = new Map<string, Promise<GameInfoResult>>();

/**
 * Fetch (or read from cache) a game's info, sharing `useUnitsyncGameInfo`'s
 * session cache. For a caller that needs the answer at a moment rather than as
 * render state: a launch has to know the game's options before it writes the
 * start script, and cannot wait a render for a hook to settle. Only a syncable
 * result is cached, matching the hook.
 */
export async function primeGameInfo(
  enginePath: string,
  dataDir: string,
  gameArchive: string,
): Promise<GameInfoResult> {
  const key = `${dataDir}::${enginePath}::${gameArchive}`;
  const cached = gameInfoCache.get(key);
  if (cached) return cached;
  const res = await shareInFlight(gameInfoPending, key, () =>
    unitsyncGameInfo({ enginePath, dataDir, gameArchive }),
  );
  if (res.checksum) gameInfoCache.set(key, res);
  return res;
}

/** Lazily load a game's sides + unit count (loads the game's archive set). */
export function useUnitsyncGameInfo(
  enginePath?: string,
  dataDir?: string,
  gameArchive?: string,
) {
  const [info, setInfo] = useState<GameInfoResult | null>(null);
  const [status, setStatus] = useState<UnitsyncInfoStatus>("idle");
  // The key `info` and `status` belong to. A result is only returned while this
  // matches the current key, so a changed key never shows the old one's result.
  const [loadedKey, setLoadedKey] = useState<string | undefined>(undefined);
  const key =
    enginePath && dataDir && gameArchive
      ? `${dataDir}::${enginePath}::${gameArchive}`
      : undefined;
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((n) => n + 1), []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: nonce is a manual retry trigger that re-runs the fetch, not read in the body
  useEffect(() => {
    if (!enginePath || !dataDir || !gameArchive || !key) {
      setInfo(null);
      setStatus("idle");
      setLoadedKey(undefined);
      return;
    }
    const cached = gameInfoCache.get(key);
    if (cached) {
      setInfo(cached);
      setStatus("ready");
      setLoadedKey(key);
      return;
    }
    let cancelled = false;
    setInfo(null);
    setStatus("loading");
    setLoadedKey(key);
    shareInFlight(gameInfoPending, key, () =>
      unitsyncGameInfo({ enginePath, dataDir, gameArchive }),
    )
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
  }, [enginePath, dataDir, gameArchive, key, nonce]);

  const current = loadedKey === key;
  const shownStatus: UnitsyncInfoStatus = current
    ? status
    : key
      ? "loading"
      : "idle";
  return {
    info: current ? info : null,
    status: shownStatus,
    reload,
    loading: shownStatus === "loading",
  };
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

/**
 * The session cache key of one unit dataset read. A read for one match (#3847)
 * is a different list from the game's own, so it is kept under the setup too,
 * as the text Rust wrote it in. Two replays with the same setup share a key.
 */
export function unitDatasetKey(
  enginePath: string,
  dataDir: string,
  gameArchive: string,
  matchSetup?: string,
): string {
  const game = `${dataDir}::${enginePath}::${gameArchive}`;
  return matchSetup ? `${game}::${matchSetup}` : game;
}

/** Session cache of unit datasets, keyed by {@link unitDatasetKey}. */
const unitDatasetCache = new Map<string, UnitDatasetResult>();
/** Open reads, so a page mounting the hook eight times spawns one worker. */
const unitDatasetPending = new Map<string, Promise<UnitDatasetResult>>();

/**
 * Lazily load a game's reusable unit graph (units + `buildoptions` edges). Loads
 * the game's archive set, so it's fetched on demand — never during the scan.
 * Cached for the session only when syncable (mirrors the worker's disk cache).
 *
 * With `matchSetup` the read is of the unit list the engine built for that
 * match, which is what a replay's unit ids count into (#3847).
 */
export function useUnitsyncUnitDataset(
  enginePath?: string,
  dataDir?: string,
  gameArchive?: string,
  matchSetup?: MatchSetup,
) {
  const [dataset, setDataset] = useState<UnitDatasetResult | null>(null);
  const [status, setStatus] = useState<UnitsyncInfoStatus>("idle");
  // The key `dataset` and `status` belong to, as in `useUnitsyncGameInfo`.
  const [loadedKey, setLoadedKey] = useState<string | undefined>(undefined);
  // As text, so the effect depends on what the setup says and not on which
  // object holds it.
  const setup = matchSetup ? JSON.stringify(matchSetup) : undefined;
  const key =
    enginePath && dataDir && gameArchive
      ? unitDatasetKey(enginePath, dataDir, gameArchive, setup)
      : undefined;
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((n) => n + 1), []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: nonce is a manual retry trigger that re-runs the fetch, not read in the body
  useEffect(() => {
    if (!enginePath || !dataDir || !gameArchive || !key) {
      setDataset(null);
      setStatus("idle");
      setLoadedKey(undefined);
      return;
    }
    const cached = unitDatasetCache.get(key);
    if (cached) {
      setDataset(cached);
      setStatus("ready");
      setLoadedKey(key);
      return;
    }
    let cancelled = false;
    setDataset(null);
    setStatus("loading");
    setLoadedKey(key);
    shareInFlight(unitDatasetPending, key, () =>
      unitsyncUnitDataset({
        enginePath,
        dataDir,
        gameArchive,
        ...(setup ? { matchSetup: JSON.parse(setup) as MatchSetup } : {}),
      }),
    )
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
  }, [enginePath, dataDir, gameArchive, setup, key, nonce]);

  const current = loadedKey === key;
  const shownStatus: UnitsyncInfoStatus = current
    ? status
    : key
      ? "loading"
      : "idle";
  return {
    dataset: current ? dataset : null,
    status: shownStatus,
    reload,
    loading: shownStatus === "loading",
  };
}

/**
 * Read a game's unit dataset outside a component, off the same session cache
 * and in-flight reads as {@link useUnitsyncUnitDataset}. For a caller that only
 * knows at load time whether it needs the units, such as a terrain map naming a
 * placed model by its unit name.
 */
export async function loadUnitsyncUnitDataset(
  enginePath: string,
  dataDir: string,
  gameArchive: string,
  matchSetup?: MatchSetup,
): Promise<UnitDatasetResult> {
  const key = unitDatasetKey(
    enginePath,
    dataDir,
    gameArchive,
    matchSetup ? JSON.stringify(matchSetup) : undefined,
  );
  const cached = unitDatasetCache.get(key);
  if (cached) return cached;
  const res = await shareInFlight(unitDatasetPending, key, () =>
    unitsyncUnitDataset({
      enginePath,
      dataDir,
      gameArchive,
      ...(matchSetup ? { matchSetup } : {}),
    }),
  );
  // Cached on the hook's terms: a read that loaded units and is syncable.
  if (res.checksum && !(res.units.length === 0 && res.errors.length > 0)) {
    unitDatasetCache.set(key, res);
  }
  return res;
}

/**
 * Drop a game's session-cached unit dataset so the next `reload()` refetches
 * from the worker instead of serving the cache. The same gap `reload()` alone
 * has on `useUnitsyncGameInfo`: a ready result stays cached for the session,
 * so a nonce bump reaches the effect but the cache lookup inside it still
 * answers first. Needed after an in-place write changes what the game's units
 * are (issue #2637).
 */
export function invalidateUnitDataset(
  enginePath?: string,
  dataDir?: string,
  gameArchive?: string,
) {
  if (!enginePath || !dataDir || !gameArchive) return;
  // The game's own dataset and every list read from it for a match.
  const game = unitDatasetKey(enginePath, dataDir, gameArchive);
  for (const key of [...unitDatasetCache.keys()]) {
    if (key === game || key.startsWith(`${game}::`)) {
      unitDatasetCache.delete(key);
    }
  }
}

/**
 * How long a model read may take before the screen asking for it stops waiting
 * and offers a retry (issue #1916). The same limit as the worker's
 * `MODEL_TIMEOUT` in the unitsync plugin, where the measurements behind it are
 * written down. This one also covers reading the files back and a reply that
 * never arrives, which the worker's cannot.
 */
const MODEL_READ_TIMEOUT_MS = 120_000;

/** Session cache of read models, keyed by `dataDir::engine::game::object`.
 *  Null for an object the game has no model for, so it is not asked again. */
const unitModelCache = new Map<string, UnitModelResult | null>();
/** In-flight batch reads, so two draws asking for one list wait once. */
const unitModelsPending = new Map<
  string,
  Promise<Map<string, UnitModelResult | null>>
>();

/**
 * Read several units' models in one archive mount, off the session cache for
 * any already read.
 *
 * For a view that needs many models at once rather than one: the scenario
 * editor draws every unit a document places, which is a list it only knows at
 * render time and cannot turn into a fixed number of hook calls. One mount for
 * the list rather than one a model, because a mount is a second or more on a
 * large game (issue #1684). The models come back as files in the model cache
 * dir and are read over the asset protocol, so a whole scenario's geometry
 * never crosses the IPC bridge at once.
 *
 * The map answers every object asked for: the model, or null for one the game
 * has no model for.
 */
export async function loadUnitsyncUnitModels(
  enginePath: string,
  dataDir: string,
  gameArchive: string,
  objects: string[],
): Promise<Map<string, UnitModelResult | null>> {
  const prefix = `${dataDir}::${enginePath}::${gameArchive}`;
  const out = new Map<string, UnitModelResult | null>();
  const wanted: string[] = [];
  for (const object of objects) {
    const cached = unitModelCache.get(`${prefix}::${object}`);
    if (cached !== undefined) out.set(object, cached);
    else wanted.push(object);
  }
  if (wanted.length === 0) return out;
  wanted.sort();
  const read = await shareInFlight(
    unitModelsPending,
    `${prefix}::${wanted.join("|")}`,
    () =>
      settleWithin(
        (async () => {
          const res = await unitsyncUnitModels({
            enginePath,
            dataDir,
            gameArchive,
            objects: wanted,
          });
          const got = new Map<string, UnitModelResult | null>();
          await Promise.all(
            wanted.map(async (object) => {
              const file = res.models[object];
              got.set(object, file ? await readCachedModel(file.file) : null);
            }),
          );
          return got;
        })(),
        MODEL_READ_TIMEOUT_MS,
        `reading the model out of ${gameArchive} took longer than ${MODEL_READ_TIMEOUT_MS / 1000} seconds`,
      ).then((got) => {
        for (const [object, model] of got) {
          unitModelCache.set(`${prefix}::${object}`, model);
        }
        return got;
      }),
  );
  for (const [object, model] of read) out.set(object, model);
  return out;
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
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  // The key the state above belongs to, so a changed key shows nothing of the
  // old one from the render it changes in.
  const [loadedKey, setLoadedKey] = useState<string | undefined>(undefined);
  const key =
    enginePath && dataDir && gameArchive && object
      ? `${dataDir}::${enginePath}::${gameArchive}::${object}`
      : undefined;

  // A retry reads again rather than answering from the session cache, which
  // also remembers a model the game had none of.
  const retry = useCallback(() => {
    if (enginePath && dataDir && gameArchive && object) {
      unitModelCache.delete(
        `${dataDir}::${enginePath}::${gameArchive}::${object}`,
      );
    }
    setAttempt((n) => n + 1);
  }, [enginePath, dataDir, gameArchive, object]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` is only here so a retry runs the read again
  useEffect(() => {
    setError(null);
    setLoadedKey(key);
    if (!enginePath || !dataDir || !gameArchive || !object || !key) {
      setModel(null);
      setLoading(false);
      setFailed(false);
      return;
    }
    const cached = unitModelCache.get(key);
    if (cached !== undefined) {
      setModel(cached);
      setLoading(false);
      setFailed(cached === null);
      return;
    }
    let cancelled = false;
    setModel(null);
    setFailed(false);
    setLoading(true);
    loadUnitsyncUnitModels(enginePath, dataDir, gameArchive, [object])
      .then((got) => {
        if (cancelled) return;
        const res = got.get(object) ?? null;
        setModel(res);
        setFailed(res === null);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        setFailed(true);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [enginePath, dataDir, gameArchive, object, key, attempt]);

  if (loadedKey !== key) {
    return { model: null, loading: !!key, failed: false, error: null, retry };
  }
  return { model, loading, failed, error, retry };
}

/** Session cache of unit build icons, keyed by dataDir::engine::game::units. */
const buildpicsCache = new Map<string, UnitBuildpicsResult>();
/** Open reads, keyed like the cache. */
const buildpicsPending = new Map<string, Promise<UnitBuildpicsResult>>();

/** Lazily resolve build icons for a game's start units. */
export function useUnitsyncUnitBuildpics(
  enginePath?: string,
  dataDir?: string,
  gameArchive?: string,
  units?: string[],
) {
  const [loaded, setLoaded] = useState<{
    key: string;
    data: UnitBuildpicsResult;
  } | null>(null);
  // Stable, order-independent key for the requested unit set. The effect derives
  // the unit list back from this string so it depends only on stable values
  // (arrays are unstable references that would refetch every render).
  const unitsKey = (units ?? []).slice().sort().join(",");
  const key =
    enginePath && dataDir && gameArchive && unitsKey !== ""
      ? `${dataDir}::${enginePath}::${gameArchive}::${unitsKey}`
      : undefined;

  useEffect(() => {
    if (!enginePath || !dataDir || !gameArchive || !key) {
      setLoaded(null);
      return;
    }
    const unitList = unitsKey.split(",");
    const cached = buildpicsCache.get(key);
    if (cached) {
      setLoaded({ key, data: cached });
      return;
    }
    let cancelled = false;
    shareInFlight(buildpicsPending, key, () =>
      unitsyncUnitBuildpics({
        enginePath,
        dataDir,
        gameArchive,
        units: unitList,
      }),
    )
      .then((res) => {
        if (cancelled) return;
        buildpicsCache.set(key, res);
        setLoaded({ key, data: res });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [enginePath, dataDir, gameArchive, unitsKey, key]);

  // Icons read for another game or unit set are not this one's.
  return loaded && loaded.key === key ? loaded.data : null;
}

/**
 * Gather resolved build pics for an export: merge every cached buildpics entry
 * for this game (whatever the open drawer already fetched across factions), then
 * make a single unitsync call for any units still missing a pic so an
 * all-factions export is complete even for tabs the user never opened. Seeds the
 * shared cache. Returns an id -> display map; units that resolve to nothing are
 * simply absent (the exporter renders a "no pic" placeholder).
 *
 * Icons are inlined on the way out. Everywhere else a unit's icon is the cache
 * file name the page loads over the asset protocol, but an export writes the
 * bytes into an HTML file or a zip that leaves this machine.
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
    const key = `${prefix}${missing.slice().sort().join(",")}`;
    const res = await shareInFlight(buildpicsPending, key, () =>
      unitsyncUnitBuildpics({
        enginePath,
        dataDir,
        gameArchive,
        units: missing,
      }),
    );
    buildpicsCache.set(key, res);
    for (const [id, display] of Object.entries(res.units)) merged[id] = display;
  }
  const inlined = await Promise.all(
    Object.entries(merged).map(
      async ([id, display]) =>
        [
          id,
          {
            ...display,
            iconFile: undefined,
            icon: await unitIconDataUrl(display),
          },
        ] as const,
    ),
  );
  return Object.fromEntries(inlined);
}

/** Session cache of map info, keyed by `dataDir::enginePath::mapName`. */
const mapInfoCache = new Map<string, MapInfoResult>();
/** Open reads, so two askers for one map wait on one worker. */
const mapInfoPending = new Map<string, Promise<MapInfoResult>>();

/**
 * Read one map's info through the same session cache `useUnitsyncMapInfo` fills,
 * for a caller with no loaded hook to hand. The map-side twin of
 * `primeGameInfo`, down to caching only a syncable result.
 */
export async function primeMapInfo(
  enginePath: string,
  dataDir: string,
  mapName: string,
): Promise<MapInfoResult> {
  const key = `${dataDir}::${enginePath}::${mapName}`;
  const cached = mapInfoCache.get(key);
  if (cached) return cached;
  const res = await shareInFlight(mapInfoPending, key, () =>
    unitsyncMapInfo({ enginePath, dataDir, mapName }),
  );
  if (res.checksum) mapInfoCache.set(key, res);
  return res;
}

/** Lazily load one map's options + warnings (mounts the map's archive). */
export function useUnitsyncMapInfo(
  enginePath?: string,
  dataDir?: string,
  mapName?: string,
) {
  const [info, setInfo] = useState<MapInfoResult | null>(null);
  const [status, setStatus] = useState<UnitsyncInfoStatus>("idle");
  // The map `info` describes. A read settles a render or more after `mapName`
  // changes, so until then both `info` and `status` still belong to the previous
  // map. A caller acting on the options (rather than just displaying them) has to
  // be able to tell, which is why this is returned rather than kept private.
  const [loadedMap, setLoadedMap] = useState<string | undefined>(undefined);
  // The engine and data folder `loadedMap` was read under. A changed map or
  // target returns no info from the render it changes in, not from the effect.
  const [loadedKey, setLoadedKey] = useState<string | undefined>(undefined);
  const key =
    enginePath && dataDir && mapName
      ? `${dataDir}::${enginePath}::${mapName}`
      : undefined;
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((n) => n + 1), []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: nonce is a manual retry trigger that re-runs the fetch, not read in the body
  useEffect(() => {
    if (!enginePath || !dataDir || !mapName || !key) {
      setInfo(null);
      setStatus("idle");
      setLoadedMap(undefined);
      setLoadedKey(undefined);
      return;
    }
    const cached = mapInfoCache.get(key);
    if (cached) {
      setInfo(cached);
      setStatus("ready");
      setLoadedMap(mapName);
      setLoadedKey(key);
      return;
    }
    let cancelled = false;
    setInfo(null);
    setStatus("loading");
    setLoadedMap(undefined);
    setLoadedKey(key);
    shareInFlight(mapInfoPending, key, () =>
      unitsyncMapInfo({ enginePath, dataDir, mapName }),
    )
      .then((res) => {
        if (cancelled) return;
        setInfo(res);
        setLoadedMap(mapName);
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
          setLoadedMap(mapName);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [enginePath, dataDir, mapName, key, nonce]);

  const current = loadedKey === key;
  const shownStatus: UnitsyncInfoStatus = current
    ? status
    : key
      ? "loading"
      : "idle";
  return {
    info: current ? info : null,
    status: shownStatus,
    loadedMap: current ? loadedMap : undefined,
    reload,
    loading: shownStatus === "loading",
  };
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

/** What `content_keybinds_read` hands back: the file, and whether it is ours. */
export interface KeybindsFile {
  path: string;
  exists: boolean;
  text: string;
  ours: boolean;
}

/**
 * The `uikeys.txt` in one engine's config directory, read on demand.
 *
 * Deliberately uncached, unlike the engine-config reader beside it. The file is
 * a few kilobytes, the player may well have edited it outside coilbox between
 * visits, and showing a stale keymap is worse than reading it again.
 */
export function useKeybinds(configDir?: string) {
  const [data, setData] = useState<KeybindsFile | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!configDir) {
      setData(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setData(await contentKeybindsRead({ configDir }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [configDir]);

  /** Write the file. Resolves to an error message, or `null` when it worked. */
  const write = useCallback(
    async (text: string): Promise<string | null> => {
      if (!configDir) return "No engine config directory to write to.";
      try {
        const res = await contentKeybindsWrite({ configDir, text });
        setData({ path: res.path, exists: true, text, ours: true });
        return null;
      } catch (e) {
        return e instanceof Error ? e.message : String(e);
      }
    },
    [configDir],
  );

  useEffect(() => {
    reload();
  }, [reload]);

  return { data, loading, error, reload, write };
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
/** Open listings, keyed like the cache. */
const archiveTreePending = new Map<string, Promise<ArchiveTreeResult>>();

/** Lazily list one archive's member tree (one unitsync session per archive). */
export function useUnitsyncArchiveTree(
  enginePath?: string,
  dataDir?: string,
  archive?: string,
) {
  const [tree, setTree] = useState<ArchiveTreeResult | null>(null);
  const [loading, setLoading] = useState(false);
  // The key `tree` belongs to, so a changed archive shows nothing of the old one.
  const [loadedKey, setLoadedKey] = useState<string | undefined>(undefined);
  const key =
    enginePath && dataDir && archive
      ? `${dataDir}::${enginePath}::${archive}`
      : undefined;

  useEffect(() => {
    if (!enginePath || !dataDir || !archive || !key) {
      setTree(null);
      setLoadedKey(undefined);
      return;
    }
    const cached = archiveTreeCache.get(key);
    if (cached) {
      setTree(cached);
      setLoadedKey(key);
      return;
    }
    let cancelled = false;
    setTree(null);
    setLoadedKey(key);
    setLoading(true);
    shareInFlight(archiveTreePending, key, () =>
      unitsyncArchiveTree({ enginePath, dataDir, archive }),
    )
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
  }, [enginePath, dataDir, archive, key]);

  const current = loadedKey === key;
  return {
    tree: current ? tree : null,
    loading: current ? loading : !!key,
  };
}

/**
 * Drop one archive's cached member tree, so the next {@link useUnitsyncArchiveTree}
 * re-lists it from disk. Called after a `.3do` install (issue #2622) changes
 * which files the archive holds: without this the tree pane on the archive
 * detail page would go on showing the `.3do` files the install just moved
 * aside and hiding the `.s3o` files it just wrote.
 */
export function invalidateArchiveTree(
  enginePath: string,
  dataDir: string,
  archive: string,
): void {
  const key = `${dataDir}::${enginePath}::${archive}`;
  archiveTreeCache.delete(key);
  // A listing still open was started before the change, so a caller after it
  // must not be handed that one.
  archiveTreePending.delete(key);
}

/** Session cache of member previews, keyed by `dataDir::enginePath::archive::file`. */
const archiveFileCache = new Map<string, ArchiveFileResult>();
/** Open reads, keyed like the cache. */
const archiveFilePending = new Map<string, Promise<ArchiveFileResult>>();

/** Lazily read one archive member for preview (fetches only when a file is set). */
export function useUnitsyncArchiveFile(
  enginePath?: string,
  dataDir?: string,
  archive?: string,
  file?: string,
) {
  const [data, setData] = useState<ArchiveFileResult | null>(null);
  const [loading, setLoading] = useState(false);
  // The key `data` belongs to, as in `useUnitsyncArchiveTree`.
  const [loadedKey, setLoadedKey] = useState<string | undefined>(undefined);
  const key =
    enginePath && dataDir && archive && file
      ? `${dataDir}::${enginePath}::${archive}::${file}`
      : undefined;

  useEffect(() => {
    if (!enginePath || !dataDir || !archive || !file || !key) {
      setData(null);
      setLoadedKey(undefined);
      return;
    }
    const cached = archiveFileCache.get(key);
    if (cached) {
      setData(cached);
      setLoadedKey(key);
      return;
    }
    let cancelled = false;
    setData(null);
    setLoadedKey(key);
    setLoading(true);
    shareInFlight(archiveFilePending, key, () =>
      unitsyncArchiveFile({ enginePath, dataDir, archive, file }),
    )
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
  }, [enginePath, dataDir, archive, file, key]);

  const current = loadedKey === key;
  return {
    data: current ? data : null,
    loading: current ? loading : !!key,
  };
}

/** Session cache of batch game-header art, keyed by `dataDir::enginePath`. */
const gameHeadersCache = new Map<
  string,
  { token: ScanToken; value: Map<string, string> }
>();
/** Open renders, keyed like the cache. */
const gameHeadersPending = new Map<string, Promise<Map<string, string>>>();

/**
 * Render (or read from cache) header art for every game of a target, populating
 * `gameHeadersCache` (game name -> URL). Games with no usable art are
 * omitted. The images are cached on disk by the worker (keyed on cheap file
 * identity), so this is fast after the first run even across restarts.
 */
export async function primeGameHeaders(
  enginePath: string,
  dataDir: string,
): Promise<Map<string, string>> {
  return batchForScan(
    gameHeadersCache,
    gameHeadersPending,
    enginePath,
    dataDir,
    async () => {
      const res = await unitsyncGameHeaders({ enginePath, dataDir });
      const map = new Map<string, string>();
      for (const h of res.headers) {
        const url = renderedUrl(h, unitsyncHeaderUrl);
        if (url) map.set(h.name, url);
      }
      return map;
    },
  );
}

/** Lazily render and cache header art for every game (name -> URL). */
export function useUnitsyncGameHeaders(enginePath?: string, dataDir?: string) {
  const scan = useScanToken(enginePath, dataDir);
  const [headers, setHeaders] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: a newer scan is what re-runs the read, not read in the body
  useEffect(() => {
    if (!enginePath || !dataDir) {
      setHeaders(new Map());
      return;
    }
    let cancelled = false;
    setLoading(true);
    primeGameHeaders(enginePath, dataDir)
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
  }, [enginePath, dataDir, scan]);

  return { headers, loading };
}

/**
 * Session cache of minimap results, keyed by
 * `dataDir::enginePath::mapName::mip`. The mip is part of the key because the
 * same map is rendered at two sizes: a list thumbnail and a full preview.
 *
 * What is cached is the name of the file the worker wrote, not the picture, and
 * the thumb cache is swept, so every hit goes through {@link liveCacheHit}
 * rather than being trusted outright (issue #1551). The same is true of the
 * three caches below.
 */
const minimapCache = new Map<string, MinimapResult>();
/** Open renders, keyed like the cache. */
const minimapPending = new Map<string, Promise<MinimapResult>>();

/**
 * The mip a list of small thumbnails should ask for: `1024 >> 3` = 128px, ample
 * for the ~56 CSS px a row draws at 2× density. Extracting the full 1024px
 * texture for these costs the same as it does for the preview, which a screen
 * showing hundreds of rows pays hundreds of times over.
 */
export const THUMB_MINIMAP_MIP = 3;

/**
 * Render (or read from cache) one map's minimap at one size. The hook below and
 * the home page's card art both read through it, so they share one cache and one
 * running render per map and size.
 */
export async function loadUnitsyncMinimap(
  enginePath: string,
  dataDir: string,
  mapName: string,
  mip = 0,
): Promise<MinimapResult> {
  const key = `${dataDir}::${enginePath}::${mapName}::${mip}`;
  const cached = await liveCacheHit(minimapCache, key, (r) => r.file);
  if (cached) return cached;
  // mip 0 = 1024px, the engine's minimap ceiling. That is what the 3D
  // preview needs, because the minimap is the diffuse texture draped over
  // its terrain.
  const res = await shareInFlight(minimapPending, key, () =>
    unitsyncMinimap({ enginePath, dataDir, mapName, mip }),
  );
  // Only remember a render that produced an image. A map unitsync cannot
  // see yet answers successfully with nothing, and caching that pins the
  // blank box for the rest of the session: asking for a map mid-download,
  // or before the rescan that follows it, would leave it without a
  // minimap even after it had installed.
  if (renderedUrl(res, unitsyncThumbUrl)) minimapCache.set(key, res);
  return res;
}

/**
 * Lazily render and cache a map's minimap + start positions for the detail page.
 *
 * `mip` picks the resolution as `1024 >> mip`, defaulting to the full 1024px the
 * 3D preview drapes over its terrain. Anything drawing a small thumbnail should
 * pass {@link THUMB_MINIMAP_MIP} instead.
 */
export function useUnitsyncMinimap(
  enginePath?: string,
  dataDir?: string,
  mapName?: string,
  mip = 0,
) {
  const [url, setUrl] = useState<string | null>(null);
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
  // The key the state above belongs to, so a changed map or size shows nothing
  // of the old one from the render it changes in.
  const [loadedKey, setLoadedKey] = useState<string | undefined>(undefined);
  const key =
    enginePath && dataDir && mapName
      ? `${dataDir}::${enginePath}::${mapName}::${mip}`
      : undefined;

  useEffect(() => {
    setLoadedKey(key);
    if (!enginePath || !dataDir || !mapName || !key) {
      setUrl(null);
      setStartPositions([]);
      setEnv({});
      setAppearance(null);
      return;
    }
    const apply = (res: MinimapResult) => {
      const url = renderedUrl(res, unitsyncThumbUrl);
      setUrl(url);
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
      if (!url && res.errors?.length) setError(res.errors.join("; "));
    };
    let cancelled = false;
    setUrl(null);
    setStartPositions([]);
    setEnv({});
    setAppearance(null);
    setLoading(true);
    setError(null);
    (async () => {
      const res = await loadUnitsyncMinimap(enginePath, dataDir, mapName, mip);
      if (cancelled) return;
      apply(res);
    })()
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [enginePath, dataDir, mapName, mip, key, recordAppearance]);

  if (loadedKey !== key) {
    return {
      url: null,
      startPositions: [] as StartPos[],
      env: {} as typeof env,
      appearance: null,
      loading: !!key,
      error: null,
    };
  }
  return { url, startPositions, env, appearance, loading, error };
}

/** Session cache of height picture results, keyed by
 *  `dataDir::enginePath::mapName`. No size in the key: the vocabulary decides
 *  it, so one map has one picture (issue #1730). */
const heightmapCache = new Map<string, HeightmapResult>();
const heightmapPending = new Map<string, Promise<HeightmapResult>>();

/** Session cache of raw height grids, keyed by `dataDir::enginePath::mapName`.
 *  The result is a file name, not the grid, so this is small. */
const heightFieldCache = new Map<string, HeightFieldResult>();
const heightFieldPending = new Map<string, Promise<HeightFieldResult>>();

/** Session cache of metalmap results, keyed by `dataDir::enginePath::mapName`. */
const metalmapCache = new Map<string, MetalmapResult>();
const metalmapPending = new Map<string, Promise<MetalmapResult>>();

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
  // The minimap is cached per mip, so drop every size of this map rather than
  // the one key: a thumbnail left behind would outlive the map it describes.
  for (const cached of minimapCache.keys()) {
    if (cached === key || cached.startsWith(`${key}::`)) {
      minimapCache.delete(cached);
    }
  }
  // The heightmap is cached per cap for the same reason.
  for (const cached of heightmapCache.keys()) {
    if (cached === key || cached.startsWith(`${key}::`)) {
      heightmapCache.delete(cached);
    }
  }
  heightFieldCache.delete(key);
  metalmapCache.delete(key);
}

/**
 * Shared shape behind {@link useUnitsyncHeightmap}, {@link useUnitsyncHeightField}
 * and {@link useUnitsyncMetalmap}: fetch one map asset from unitsync, keyed by
 * `dataDir::enginePath::mapName`, live-checked against the thumb cache the same
 * way every render in this file is (issue #1551). An empty render is a state,
 * not an answer, so only a result with a URL is remembered, and a retry re-runs
 * it.
 *
 * `fetchAsset` is the unitsync binding to call, and `cache` is that binding's
 * own module-level Map. The URL always comes from {@link renderedUrl} against
 * `unitsyncThumbUrl`, which fits all three results: a cache file when the
 * render reached disk, or the inlined `dataUrl` when it did not.
 *
 * `useUnitsyncMapSkybox` is not built on this. It caches "no skybox" as a
 * valid, permanent answer rather than an unanswered one, which this hook's
 * caching rule would refetch on every mount. `useUnitsyncMinimap` is not built
 * on this either, for its own mip-keyed cache and start-position/appearance
 * side effects.
 */
function useUnitsyncMapAsset<
  T extends { file?: string; dataUrl?: string; errors?: string[] },
>(
  cache: Map<string, T>,
  pending: Map<string, Promise<T>>,
  fetchAsset: (args: {
    enginePath: string;
    dataDir: string;
    mapName: string;
  }) => Promise<T>,
  enginePath?: string,
  dataDir?: string,
  mapName?: string,
) {
  const [data, setData] = useState<T | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enginePath || !dataDir || !mapName) {
      setData(null);
      setUrl(null);
      return;
    }
    const key = `${dataDir}::${enginePath}::${mapName}`;
    const apply = (res: T) => {
      setData(res);
      const url = renderedUrl(res, unitsyncThumbUrl);
      setUrl(url);
      if (!url && res.errors?.length) setError(res.errors.join("; "));
    };
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      const cached = await liveCacheHit(cache, key, (r) => r.file);
      if (cancelled) return;
      if (cached) {
        apply(cached);
        return;
      }
      const res = await shareInFlight(pending, key, () =>
        fetchAsset({ enginePath, dataDir, mapName }),
      );
      if (cancelled) return;
      // Same rule as the minimap: an empty render is a state, not an answer.
      if (renderedUrl(res, unitsyncThumbUrl)) cache.set(key, res);
      apply(res);
    })()
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [cache, pending, fetchAsset, enginePath, dataDir, mapName]);

  return { data, url, loading, error };
}

/**
 * Lazily render and cache a map's height picture (WebP URL plus the world
 * heights its black and white stand for).
 *
 * No size to ask for: the shared asset vocabulary caps it, which is what keeps
 * the preview and the hub's own copy the same bytes. A caller that has to
 * measure the ground rather than draw it reads
 * {@link useUnitsyncHeightField} instead.
 */
export function useUnitsyncHeightmap(
  enginePath?: string,
  dataDir?: string,
  mapName?: string,
) {
  const { data, url, loading, error } = useUnitsyncMapAsset(
    heightmapCache,
    heightmapPending,
    unitsyncHeightmap,
    enginePath,
    dataDir,
    mapName,
  );

  // What the picture's black and white stand for, which is not the map's own
  // pair: it is rescaled into the window its samples occupy (issue #1730).
  // Undefined on a render that did not say, so a caller falls back to the map's.
  const min = data?.pictureMinHeight;
  const max = data?.pictureMaxHeight;
  const range = min != null && max != null ? { min, max } : undefined;

  return { data, url, range, loading, error };
}

/**
 * Lazily write and cache a map's raw 16 bit heights, for the terrain check
 * (issue #1490).
 *
 * The url is the file the worker wrote, which the caller fetches as bytes. The
 * bounds come back with it because a word means nothing without them.
 */
export function useUnitsyncHeightField(
  enginePath?: string,
  dataDir?: string,
  mapName?: string,
) {
  return useUnitsyncMapAsset(
    heightFieldCache,
    heightFieldPending,
    unitsyncHeightField,
    enginePath,
    dataDir,
    mapName,
  );
}

/** Lazily render and cache a map's metal infomap (green-on-transparent PNG overlay). */
export function useUnitsyncMetalmap(
  enginePath?: string,
  dataDir?: string,
  mapName?: string,
) {
  return useUnitsyncMapAsset(
    metalmapCache,
    metalmapPending,
    unitsyncMetalmap,
    enginePath,
    dataDir,
    mapName,
  );
}

/** Session cache of skybox results, keyed by `dataDir::enginePath::mapName`. */
const skyboxCache = new Map<string, MapSkyboxResult>();
const skyboxPending = new Map<string, Promise<MapSkyboxResult>>();

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
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enginePath || !dataDir || !mapName) {
      setDataUrl(null);
      setLoading(false);
      return;
    }
    const key = `${dataDir}::${enginePath}::${mapName}`;
    const cached = skyboxCache.get(key);
    if (cached) {
      setDataUrl(cached.dataUrl ?? null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setDataUrl(null);
    setLoading(true);
    shareInFlight(skyboxPending, key, () =>
      unitsyncMapSkybox({ enginePath, dataDir, mapName }),
    )
      .then((res) => {
        if (cancelled) return;
        skyboxCache.set(key, res);
        setDataUrl(res.dataUrl ?? null);
      })
      // A skybox is optional; a failed read just leaves the flat sky colour.
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [enginePath, dataDir, mapName]);

  return { dataUrl, loading };
}

/* -------------------------------------------------------------------------- *
 * Replays — list a root's demo files, and lazily decode one for its detail view.
 * -------------------------------------------------------------------------- */

export { useReplays } from "./replayList";

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

/** Session cache of decoded demos, keyed by `enginePath::replayPath` (the engine
 * part is empty when no engine is installed). */
const demoInfoCache = new Map<string, DemoInfo>();
/** Open decodes, keyed like the cache. */
const demoInfoPending = new Map<string, Promise<{ info: DemoInfo }>>();

/**
 * Lazily decode one replay (native header, start-script and trailer, with
 * demotool asked only as a fallback for a trailer format the decoder
 * refuses). Cached for the session, decoding re-reads the file. `enginePath`
 * is optional: with no engine installed the header and script still decode, and
 * only a winner the trailer cannot give is left unknown.
 */
export function useDemoInfo(enginePath?: string, replayPath?: string) {
  // The replay `settled` belongs to, so another replay shows nothing of it.
  const [settled, setSettled] = useState<{
    path: string;
    info: DemoInfo | null;
    error: string | null;
  } | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!replayPath) {
      setSettled(null);
      return;
    }
    const key = `${enginePath ?? ""}::${replayPath}`;
    const cached = demoInfoCache.get(key);
    if (cached) {
      setSettled({ path: replayPath, info: cached, error: null });
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    shareInFlight(demoInfoPending, key, () =>
      contentDemoInfo({ enginePath, replayPath }),
    )
      .then((res) => {
        if (cancelled) return;
        demoInfoCache.set(key, res.info);
        setSettled({ path: replayPath, info: res.info, error: null });
      })
      .catch((e) => {
        if (!cancelled)
          setSettled({
            path: replayPath,
            info: null,
            error: e instanceof Error ? e.message : String(e),
          });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [enginePath, replayPath]);

  const current = !!replayPath && settled?.path === replayPath;
  return {
    info: current ? settled.info : null,
    loading: replayPath ? (current ? loading : true) : false,
    error: current ? settled.error : null,
  };
}

/* -------------------------------------------------------------------------- *
 * Replay stats — the local stats database (ingest + query). See `stats.rs`.
 * -------------------------------------------------------------------------- */

/**
 * The stored stats records, read without ingesting. For a view that only needs
 * to look people up in the library, such as the replay page's chart: an ingest
 * walks every root and rewrites the whole stats file. Empty when `enabled` is
 * false, and until a page that ingests has filled the store.
 */
export function useStoredStatsRecords(enabled: boolean): StatRecord[] {
  const [records, setRecords] = useState<StatRecord[]>([]);
  useEffect(() => {
    if (!enabled) {
      setRecords([]);
      return;
    }
    let cancelled = false;
    contentStatsQuery(undefined)
      .then((q) => {
        if (!cancelled) setRecords(q.records);
      })
      .catch(() => {
        // Leave the records empty. The chart just has no "me" to highlight.
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);
  return records;
}

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
