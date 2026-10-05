import { useEffect, useState, useSyncExternalStore } from "react";
import { useScanEpoch } from "../../content/config";
import { createDocumentStore } from "../../lib/documentStore";
import { usePreferredTarget } from "../../play/config";
import type { GameItem } from "../../content/bindings";
import { type ArchiveTarget, archiveGameOf } from "./archive";
import {
  type HandmadeMapList,
  type HandmadeMapSummary,
  listHandmadeMaps,
  listHandmadeMapsForGame,
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

/** The generation of a list that holds nothing yet. */
const NOTHING_LISTED = -2;
/** The generation of a list of the saved maps alone, before any game is read. */
const SAVED_ONLY = -1;

/**
 * A list and the generation of game archives it covers. {@link SAVED_ONLY}
 * and {@link NOTHING_LISTED} cover none.
 */
type StoredList = HandmadeMapList & { generation: number };

function coversArchives(list: StoredList | null): boolean {
  return list !== null && list.generation >= 0;
}

/**
 * List the maps for the current generation. A listing started before the
 * target changed is run again, so a slow read of an old target never lands
 * on top of a newer one.
 *
 * Reading the game archives takes one unitsync run a game, so while no list
 * covers them the saved maps are published first and the page can show them
 * (issue #3616). A list that already covers an older generation stays up
 * instead, so a rescan does not take the archive maps away and give them back.
 */
async function listCurrent(): Promise<StoredList> {
  if (!coversArchives(mapStore.getCached())) {
    const saved = await listHandmadeMaps({ archives: false });
    if (!coversArchives(mapStore.getCached())) {
      mapStore.publish({ ...saved, generation: SAVED_ONLY });
    }
  }
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
  generation: NOTHING_LISTED,
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

/**
 * Every hand-made map, and the folders that could not be listed.
 *
 * `loading` holds until the list covers the game archives of the current
 * target, because before then a map a game carries would look missing.
 * `savedLoading` holds only until the saved maps are known, for a page that
 * can show those first and say it is still searching the games.
 */
export function useHandmadeMaps() {
  const at = useArchiveTarget();
  const { data, loading, error, refresh } = mapStore.useStore();
  const stale = !error && (at === 0 || data.generation !== at);
  const savedLoading = !error && data.generation === NOTHING_LISTED;
  return {
    ...data,
    loading: loading || stale,
    savedLoading,
    error,
    refresh,
  };
}

/** What a form needs to know about one game's own maps. */
type GameMapFacts = Pick<HandmadeMapList, "maps" | "onlyOwnMaps">;

const NO_FACTS: GameMapFacts = { maps: [], onlyOwnMaps: [] };

/**
 * The hand-made maps for one game and whether it asks for its own maps only,
 * for a form that has to decide which map styles to offer (issue #3674). It
 * reads that one game's archive, and none while no game is chosen. A game read
 * before is answered from the cache the Conquest list shares, so switching
 * back to it costs nothing.
 *
 * `loading` holds from the moment a game is chosen until its answer is in, and
 * the form keeps its style choice empty until then, so a game that hides the
 * generated styles never has them offered and taken away.
 */
export function useGameMapFacts(game: GameItem | null | undefined): {
  loading: boolean;
  facts: GameMapFacts;
} {
  const at = useArchiveTarget();
  const [answered, setAnswered] = useState<{
    key: string;
    facts: GameMapFacts;
  }>();
  const archive = game ? archiveGameOf(game) : undefined;
  const key = archive
    ? `${at}\0${archive.archive}\0${archive.size ?? ""}\0${archive.checksum ?? ""}`
    : undefined;
  // The game as a string, so a render that makes the same game again does not
  // start the read again.
  const wanted = archive ? JSON.stringify(archive) : undefined;
  useEffect(() => {
    if (wanted === undefined || key === undefined || at === 0) return;
    let cancelled = false;
    listHandmadeMapsForGame(JSON.parse(wanted)).then(
      (facts) => {
        if (!cancelled) setAnswered({ key, facts });
      },
      () => {
        // The saved maps could not be listed. Nothing is known to hide the
        // styles, so the form offers them rather than waiting for ever.
        if (!cancelled) setAnswered({ key, facts: NO_FACTS });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [wanted, key, at]);
  if (key === undefined) return { loading: false, facts: NO_FACTS };
  const current = answered?.key === key ? answered : undefined;
  return { loading: !current, facts: current?.facts ?? NO_FACTS };
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
