import { useSetting } from "@picoframe/frame";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  type Archive,
  type ArchiveFileResult,
  type ArchiveTreeResult,
  type ContentState,
  contentDemoInfo,
  contentListReplays,
  contentStateLoad,
  type DemoInfo,
  type EngineConfigResult,
  type GameInfoResult,
  type HeightmapResult,
  type LuaExecResult,
  type MinimapResult,
  type ReplayFile,
  type ScanResult,
  type StartPos,
  unitsyncArchiveFile,
  unitsyncArchiveTree,
  unitsyncEngineConfig,
  unitsyncGameInfo,
  unitsyncHeightmap,
  unitsyncLuaExec,
  unitsyncMinimap,
  unitsyncScan,
  unitsyncThumbnails,
} from "./bindings";
import { newestEngineId } from "./engineVersion";

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

/**
 * Fetch (or read from cache) a unitsync scan for a target, populating
 * `scanCache`. Shared by the page hook and the launch warm-up so both read the
 * same cache. `force` re-runs the scan even on a cache hit.
 */
export async function primeScan(
  enginePath: string,
  dataDir: string,
  force = false,
): Promise<ScanResult> {
  const key = `${dataDir}::${enginePath}`;
  const cached = scanCache.get(key);
  if (!force && cached) return cached;
  const res = await unitsyncScan({ enginePath, dataDir });
  scanCache.set(key, res);
  return res;
}

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
        setData(await primeScan(enginePath, dataDir, force));
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

/**
 * Render (or read from cache) every map's thumbnail for a target, populating
 * `thumbnailsCache` (name -> PNG data URL). Shared by the page hook and the
 * launch warm-up. The PNGs themselves are cached on disk by the worker, so this
 * is fast after the first run even across restarts.
 */
export async function primeThumbnails(
  enginePath: string,
  dataDir: string,
): Promise<Map<string, string>> {
  const key = `${dataDir}::${enginePath}`;
  const cached = thumbnailsCache.get(key);
  if (cached) return cached;
  const res = await unitsyncThumbnails({ enginePath, dataDir, mip: 3 });
  const map = new Map(res.thumbnails.map((t) => [t.name, t.dataUrl]));
  thumbnailsCache.set(key, map);
  return map;
}

/** Lazily render and cache thumbnails for every map (name -> PNG data URL). */
export function useUnitsyncThumbnails(enginePath?: string, dataDir?: string) {
  const [thumbs, setThumbs] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(false);

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

  useEffect(() => {
    if (!enginePath || !dataDir) {
      setData(null);
      return;
    }
    run(false);
  }, [enginePath, dataDir, run]);

  return { data, loading, error, run };
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
  const { data, loading, error, run } = useUnitsyncScan(enginePath, dataDir);
  const archives = useMemo(() => buildArchiveList(data), [data]);
  return { archives, data, loading, error, run };
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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enginePath || !dataDir || !mapName) {
      setDataUrl(null);
      setStartPositions([]);
      return;
    }
    const key = `${dataDir}::${enginePath}::${mapName}`;
    const apply = (res: MinimapResult) => {
      setDataUrl(res.dataUrl ?? null);
      setStartPositions(res.startPositions ?? []);
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
    unitsyncMinimap({ enginePath, dataDir, mapName })
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
  }, [enginePath, dataDir, mapName]);

  return { dataUrl, startPositions, loading, error };
}

/** Session cache of heightmap results, keyed by `dataDir::enginePath::mapName`. */
const heightmapCache = new Map<string, HeightmapResult>();

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

/**
 * Run the Lua console for a target+archive. Unlike the other browser hooks this
 * is imperative (each Run re-executes; nothing is cached): call `run(source)` and
 * read `result` / `loading`. Backend/Lua errors surface in `result.error`.
 */
export function useUnitsyncLuaExec(
  enginePath?: string,
  dataDir?: string,
  archive?: string,
) {
  const [result, setResult] = useState<LuaExecResult | null>(null);
  const [loading, setLoading] = useState(false);

  const run = useCallback(
    async (source: string) => {
      if (!enginePath || !dataDir || !archive) return;
      setLoading(true);
      try {
        setResult(
          await unitsyncLuaExec({ enginePath, dataDir, archive, source }),
        );
      } catch (e) {
        setResult({
          error: e instanceof Error ? e.message : String(e),
          errors: [],
        });
      } finally {
        setLoading(false);
      }
    },
    [enginePath, dataDir, archive],
  );

  return { run, result, loading };
}

/* -------------------------------------------------------------------------- *
 * Replays — list a root's demo files, and lazily decode one for its detail view.
 * -------------------------------------------------------------------------- */

/** List the replays in a content root (re-runs on `rootPath` change / refresh). */
export function useReplays(rootPath?: string) {
  const [replays, setReplays] = useState<ReplayFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!rootPath) {
      setReplays([]);
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
      setLoading(false);
    }
  }, [rootPath]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { replays, loading, error, refresh };
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
