import { useEffect, useState } from "react";
import { createDocumentStore } from "../../lib/documentStore";
import {
  type HandmadeMapList,
  type HandmadeMapSummary,
  listHandmadeMaps,
  loadHandmadeMap,
} from "./library";
import type { HandmadeMapResult } from "./read";

/**
 * The hand-made map list, shared the way the galaxy list is: one read a
 * session, and a refresh after an import or a remove reaches every consumer.
 */
const mapStore = createDocumentStore<HandmadeMapList>(listHandmadeMaps, {
  maps: [],
  unreadable: [],
});

/** Re-read the map folders. Call after an import or a remove. */
export const refreshHandmadeMaps = mapStore.refresh;

/** Every hand-made map, and the folders that could not be listed. */
export function useHandmadeMaps() {
  const { data, loading, error, refresh } = mapStore.useStore();
  return { ...data, loading, error, refresh };
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
 * folders could not be listed at all.
 */
export function useHandmadeMap(id: string | undefined): {
  loading: boolean;
  result: HandmadeMapResult | undefined;
  failure: string | undefined;
} {
  const [loaded, setLoaded] = useState<{
    id: string;
    result?: HandmadeMapResult;
    failure?: string;
  }>();
  useEffect(() => {
    if (id === undefined) return;
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
  }, [id]);
  const current = loaded && loaded.id === id ? loaded : undefined;
  return {
    loading: id !== undefined && !current,
    result: current?.result,
    failure: current?.failure,
  };
}
