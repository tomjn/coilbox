/**
 * Reading and writing the blueprint library (issue #1415).
 *
 * The `coilbox-content` plugin keeps one JSON file per layout under the app data
 * dir and reads none of it, so this is where a file becomes a
 * {@link StoredBlueprint} and where the timestamps are stamped. Callers work
 * with records, never with JSON text or file names.
 *
 * Same shape as `../lego/projects.ts` and `../campaign/campaigns.ts`: a
 * module-level cache so coming back to the list does not re-read every document,
 * and a listener set so a save in the detail view updates the list without a
 * round trip through the router.
 */

import { useEffect, useState } from "react";

import {
  contentBlueprintDelete,
  contentBlueprintSave,
  contentBlueprints,
} from "../content/bindings";
import {
  parseStoredBlueprintJson,
  type StoredBlueprint,
  sortLibrary,
} from "./library";

let cache: StoredBlueprint[] | null = null;
const listeners = new Set<(records: StoredBlueprint[]) => void>();

/** Where one layout is edited. Here rather than on the page it addresses, so
 *  that anything wanting the address does not pull the page in behind it. */
export function blueprintRoute(id: string): string {
  return `/content/blueprints/${encodeURIComponent(id)}`;
}

/** Read and parse every stored document, newest edit first. A document that
 *  will not read is skipped with a warning: one bad file must not empty the
 *  library. */
async function fetchLibrary(): Promise<StoredBlueprint[]> {
  const { items } = await contentBlueprints({});
  const loaded: StoredBlueprint[] = [];
  for (const item of items) {
    const record = parseStoredBlueprintJson(item.json);
    if (record) {
      loaded.push(record);
    } else {
      console.warn("skipping a blueprint that could not be read", item.id);
    }
  }
  return sortLibrary(loaded);
}

/** Re-read from disk and push the result to every mounted hook. */
export async function refreshBlueprints(): Promise<StoredBlueprint[]> {
  const loaded = await fetchLibrary();
  cache = loaded;
  for (const listener of listeners) listener(loaded);
  return loaded;
}

/**
 * Persist a layout, stamping `updatedAt` and, on the first save, `createdAt`.
 * Returns the stamped record so the caller holds what was written rather than a
 * value whose timestamps have already drifted.
 */
export async function saveBlueprint(
  record: StoredBlueprint,
): Promise<StoredBlueprint> {
  const written = await write(record);
  await refreshBlueprints();
  return written;
}

/**
 * Persist several layouts, and re-read the library once at the end.
 *
 * Taking twenty layouts out of a pack file is one import rather than twenty
 * (issue #1313), and going back to disk for the whole library after each one
 * would be nineteen reads nobody asked for. They are written one at a time
 * because that is what the plugin offers, so a failure halfway leaves the ones
 * before it kept, which is why this throws with them already on disk rather
 * than pretending nothing happened.
 */
export async function saveBlueprints(
  records: readonly StoredBlueprint[],
): Promise<StoredBlueprint[]> {
  const written: StoredBlueprint[] = [];
  try {
    for (const record of records) written.push(await write(record));
  } finally {
    await refreshBlueprints();
  }
  return written;
}

/** One layout onto disk, stamped. */
async function write(record: StoredBlueprint): Promise<StoredBlueprint> {
  const now = new Date().toISOString();
  const stamped: StoredBlueprint = {
    ...record,
    createdAt: record.createdAt || now,
    updatedAt: now,
  };
  await contentBlueprintSave({
    id: stamped.id,
    json: JSON.stringify(stamped),
  });
  return stamped;
}

/** Drop one layout from the library. */
export async function deleteBlueprint(id: string): Promise<void> {
  await contentBlueprintDelete({ id });
  await refreshBlueprints();
}

/** The library as this session last read it, for a breadcrumb that has to name
 *  a layout before the page it belongs to has loaded. */
export function cachedBlueprint(id: string): StoredBlueprint | undefined {
  return cache?.find((record) => record.id === id);
}

const EMPTY: StoredBlueprint[] = [];

/** Every stored layout, newest edit first. Stays in step with saves and deletes
 *  made anywhere else. */
export function useBlueprintLibrary() {
  const [records, setRecords] = useState<StoredBlueprint[]>(cache ?? EMPTY);
  const [loading, setLoading] = useState(cache === null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const listener = (loaded: StoredBlueprint[]) => setRecords(loaded);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  useEffect(() => {
    if (cache) {
      setRecords(cache);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetchLibrary()
      .then((loaded) => {
        cache = loaded;
        if (!cancelled) {
          setRecords(loaded);
          setError(null);
        }
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
  }, []);

  return { records, loading, error };
}
