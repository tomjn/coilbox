import { useCallback } from "react";
import { createDocumentStore } from "../lib/documentStore";
import {
  runliteMetaLoad,
  runliteMetaSave,
  runliteStateLoad,
  runliteStateSave,
} from "./bindings";
import { awardFinishedRuns } from "./meta";
import {
  emptyMeta,
  parseRunMeta,
  parseRunStateFile,
  type RogueliteMeta,
  type RogueliteRun,
} from "./model";

/** Read + parse the keyed collection of active runs. Each warpath persists
 *  under its own id (mirroring conquest, which keys many runs by galaxy id),
 *  so runs for different games or factions coexist instead of overwriting each
 *  other. */
async function fetchRuns(): Promise<Record<string, RogueliteRun>> {
  const { json } = await runliteStateLoad({});
  const { runs: parsed, unreadable: damaged } = parseRunStateFile(json);
  unreadable = damaged;
  // The runs as the disk had them the first time this session read it, taken
  // before any battle can end. They seed the meta's `seen` list, and a run that
  // finishes later is not one of them.
  if (finishedOnFirstLoad === null) {
    finishedOnFirstLoad = new Set(
      Object.entries(parsed)
        .filter(([, run]) => run.progress.status !== "active")
        .map(([id]) => id),
    );
  }
  return parsed;
}

let finishedOnFirstLoad: ReadonlySet<string> | null = null;

/** The entries of `run.json` that were not readable as runs, as the disk had
 *  them. Every write puts them back, and none of them is a run for play, so they
 *  are not in the store, not awarded, and not in the baseline above. */
let unreadable: Readonly<Record<string, unknown>> = {};

const store = createDocumentStore<Record<string, RogueliteRun>>(fetchRuns, {});

/** Synchronous best-effort read of a loaded run from the session cache, for
 *  non-React callers that need a run now, chiefly the breadcrumb `crumb`
 *  resolver, which can't use hooks. */
export function getCachedRun(id: string): RogueliteRun | undefined {
  return store.getCached()?.[id];
}

/** Write the keyed collection back and push it to every mounted consumer. */
async function persist(next: Record<string, RogueliteRun>): Promise<void> {
  store.publish(next);
  await runliteStateSave({
    json: JSON.stringify({
      schemaVersion: 1,
      runs: { ...unreadable, ...next },
    }),
  });
}

export function useRuns() {
  const { data: runs, loading, error, refresh } = store.useStore();

  /** Add or replace a run under `id`, preserving every other run. Builds on
   *  the latest cache, so two quick saves don't clobber each other. */
  const saveRun = useCallback(async (id: string, run: RogueliteRun) => {
    if (id in unreadable) {
      throw new Error(
        "That run id is taken by a run that could not be read, so nothing was saved.",
      );
    }
    await persist({ ...store.getForWrite(), [id]: run });
  }, []);

  /** Remove a run (abandon), preserving every other run. */
  const deleteRun = useCallback(async (id: string) => {
    const next = { ...store.getForWrite() };
    delete next[id];
    await persist(next);
  }, []);

  return {
    runs,
    loading,
    error,
    refresh,
    saveRun,
    deleteRun,
    unreadableCount: Object.keys(unreadable).length,
  };
}

/**
 * Single-run view by id: the run (or `null`) plus a `save` that writes it back
 * into the keyed collection, or clears just that run with `null`. Keeps the
 * active-run page's `save(next)` / `save(null)` shape unchanged.
 */
export function useRun(id: string | undefined) {
  const { runs, loading, error, refresh, saveRun, deleteRun } = useRuns();
  const run = id ? (runs[id] ?? null) : null;

  const save = useCallback(
    async (next: RogueliteRun | null) => {
      if (!id) return;
      if (next) await saveRun(id, next);
      else await deleteRun(id);
    },
    [id, saveRun, deleteRun],
  );

  return { run, loading, error, refresh, save };
}

async function fetchMeta(): Promise<RogueliteMeta> {
  const { json } = await runliteMetaLoad({});
  return parseRunMeta(json);
}

/** One copy of the meta for the whole session, so every mounted consumer sees
 *  a write made by any other. */
const metaStore = createDocumentStore<RogueliteMeta>(fetchMeta, emptyMeta);

// Disk writes go one after another, and each writes the latest meta at the
// moment its turn comes, so a slow write can never land after a newer one.
let metaWrites: Promise<void> = Promise.resolve();

/** Make `next` the meta everywhere at once, then write the latest meta. Rejects
 *  without writing when the meta has not loaded, so a failed read is never
 *  replaced by a record built from nothing. */
function commitMeta(next: RogueliteMeta): Promise<void> {
  try {
    metaStore.getForWrite();
  } catch (e) {
    return Promise.reject(e);
  }
  metaStore.publish(next);
  const write = metaWrites
    .catch(() => {})
    .then(async () => {
      const latest = metaStore.getCached();
      if (latest) await runliteMetaSave({ json: JSON.stringify(latest) });
    });
  metaWrites = write;
  return write;
}

/**
 * Count every finished run in `runs` that no record has counted. Every place
 * that shows runs calls this, so there is one rule. It reads the meta from the
 * session store at the moment it runs and publishes the result before
 * returning, so two callers cannot work from different copies, and the second
 * finds the first's `seen` ids and counts nothing. Does nothing until both the
 * meta and the runs have loaded.
 */
export function observeFinishedRuns(
  runs: Readonly<Record<string, RogueliteRun>>,
): void {
  const meta = metaStore.getCached();
  if (!meta || finishedOnFirstLoad === null) return;
  const next = awardFinishedRuns(meta, runs, finishedOnFirstLoad);
  if (next === meta) return;
  commitMeta(next).catch((e) => console.error("Warpath meta save failed", e));
}

/**
 * Load / save persistent meta-progression (between-run unlocks). Small and
 * read-mostly; written only when a run ends.
 */
export function useRunMeta() {
  const { data: meta, loading, error, refresh } = metaStore.useStore();
  const save = useCallback((next: RogueliteMeta) => commitMeta(next), []);
  return { meta, loading, error, refresh, save };
}
