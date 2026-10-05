import { useEffect, useState, useSyncExternalStore } from "react";
import { useScanEpoch } from "../../content/config";
import { createDocumentStore } from "../../lib/documentStore";
import { usePreferredTarget } from "../../play/config";
import type { ArchiveTarget } from "./archive";
import {
  type HandmadeMapList,
  type HandmadeMapSummary,
  listHandmadeMaps,
  loadHandmadeMap,
  setArchiveTarget,
} from "./library";
import type { HandmadeMapResult } from "./read";

/**
 * How many times the game archives have been pointed at a target. Zero until
 * the engine is known, and one more after every rescan of the content, which
 * is when a game may have been updated.
 */
let generation = 0;
let appliedKey: string | undefined;
const listeners = new Set<() => void>();

type StoredList = HandmadeMapList & { generation: number };

/**
 * List the maps for the current generation. A listing started before the
 * target changed is run again, so a slow read of an old target never lands
 * on top of a newer one.
 */
async function listCurrent(): Promise<StoredList> {
  for (;;) {
    const at = generation;
    const list = await listHandmadeMaps();
    if (at === generation) return { ...list, generation: at };
  }
}

/**
 * The hand-made map list, shared the way the galaxy list is: one read a
 * session, and a refresh after an import or a remove reaches every consumer.
 */
const mapStore = createDocumentStore<StoredList>(listCurrent, {
  maps: [],
  unreadable: [],
  onlyOwnMaps: [],
  generation: -1,
});

function applyArchiveTarget(key: string, target: ArchiveTarget | null) {
  if (key === appliedKey) return;
  appliedKey = key;
  setArchiveTarget(target);
  generation++;
  for (const listener of listeners) listener();
  mapStore.refresh().catch(() => {});
}

/**
 * Keep the library pointed at the engine the app plays with. A rescan of the
 * content bumps the scan epoch, so the archives are read again after a game
 * is installed or updated.
 */
function useArchiveTarget(): number {
  const { target, loading } = usePreferredTarget();
  const enginePath = target?.enginePath;
  const dataDir = target?.dataDir;
  const epoch = useScanEpoch(enginePath, dataDir);
  useEffect(() => {
    if (loading) return;
    if (!enginePath || !dataDir) {
      applyArchiveTarget("none", null);
      return;
    }
    applyArchiveTarget(`${dataDir}::${enginePath}::${epoch}`, {
      enginePath,
      dataDir,
    });
  }, [loading, enginePath, dataDir, epoch]);
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    () => generation,
  );
}

/** Re-read the map folders. Call after an import or a remove. */
export const refreshHandmadeMaps = mapStore.refresh;

/** Every hand-made map, and the folders that could not be listed. */
export function useHandmadeMaps() {
  const at = useArchiveTarget();
  const { data, loading, error, refresh } = mapStore.useStore();
  // Until the list covers the game archives of the current target, a map a
  // game carries would look missing, so the list counts as loading.
  const stale = !error && (at === 0 || data.generation !== at);
  return { ...data, loading: loading || stale, error, refresh };
}

/** A listed map from the session cache, for callers outside React. */
export function getCachedHandmadeMap(
  id: string,
): HandmadeMapSummary | undefined {
  return mapStore.getCached()?.maps.find((m) => m.id === id);
}

/**
 * Read one hand-made map into a galaxy document. `id` undefined reads nothing,
 * for a caller that only sometimes has a hand-made map to load. `result` is
 * undefined until the read answers, and `failure` says why when the map
 * folders could not be listed at all. The map is read again when the game
 * archives are, and the last read stays up until the new one answers.
 */
export function useHandmadeMap(id: string | undefined): {
  loading: boolean;
  result: HandmadeMapResult | undefined;
  failure: string | undefined;
} {
  const at = useArchiveTarget();
  const [loaded, setLoaded] = useState<{
    id: string;
    result?: HandmadeMapResult;
    failure?: string;
  }>();
  useEffect(() => {
    if (id === undefined || at === 0) return;
    let cancelled = false;
    loadHandmadeMap(id).then(
      (result) => {
        if (!cancelled) setLoaded({ id, result });
      },
      (e) => {
        if (!cancelled) {
          setLoaded({
            id,
            failure: e instanceof Error ? e.message : String(e),
          });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [id, at]);
  const current = loaded && loaded.id === id ? loaded : undefined;
  return {
    loading: id !== undefined && !current,
    result: current?.result,
    failure: current?.failure,
  };
}
