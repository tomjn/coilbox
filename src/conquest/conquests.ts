import { useCallback } from "react";
import { createDocumentStore } from "../lib/documentStore";
import { conquestList, conquestStateLoad, conquestStateSave } from "./bindings";
import {
  type ConquestState,
  type ConquestStateFile,
  type GalaxyDoc,
  parseGalaxyJson,
  reconcileState,
} from "./model";

/** A parsed galaxy plus where it came from (bundled galaxies are read-only). */
export interface LoadedGalaxy {
  galaxy: GalaxyDoc;
  source: "local" | "bundled";
}

/** Read + parse every stored galaxy document, skipping invalid ones. */
async function fetchGalaxies(): Promise<LoadedGalaxy[]> {
  const { items } = await conquestList({});
  const loaded: LoadedGalaxy[] = [];
  for (const item of items) {
    const galaxy = parseGalaxyJson(item.json);
    if (galaxy) {
      loaded.push({ galaxy, source: item.source });
    } else {
      console.warn("skipping invalid galaxy document", item.source);
    }
  }
  return loaded;
}

const galaxyStore = createDocumentStore<LoadedGalaxy[]>(fetchGalaxies, []);

/**
 * Re-read the galaxy list from disk, refresh the shared session cache, and
 * push the result to every mounted {@link useGalaxies}. Call after a
 * save/delete/import.
 */
export const refreshGalaxies = galaxyStore.refresh;

/**
 * Load every stored galaxy. Serves the session cache on mount, else reads and
 * parses each document, skipping (with a console warning) any that fail
 * validation, so one malformed bundled or imported galaxy can't break the hub.
 */
export function useGalaxies() {
  const { data: galaxies, loading, error, refresh } = galaxyStore.useStore();
  return { galaxies, loading, error, refresh };
}

/**
 * Synchronous read of a loaded galaxy from the session cache, or `undefined`
 * if the list hasn't loaded yet. For non-React callers that need a best-effort
 * title now, chiefly the breadcrumb `crumb` resolvers.
 */
export function getCachedGalaxy(id: string): LoadedGalaxy | undefined {
  return galaxyStore.getCached()?.find((l) => l.galaxy.id === id);
}

/** The empty state document, matching the plugin's default. */
const emptyStateFile: ConquestStateFile = { schemaVersion: 1, conquests: {} };

/** Read + parse the run-state file from disk (empty on parse failure). */
async function fetchStateFile(): Promise<ConquestStateFile> {
  const { json } = await conquestStateLoad({});
  try {
    return JSON.parse(json) as ConquestStateFile;
  } catch {
    return emptyStateFile;
  }
}

/**
 * Shared run-state store, so a save in one consumer (chiefly the battle
 * overlay's `useConquestBattleRun`) is seen immediately by every other mounted
 * {@link useConquestState}, above all the map. Without this each hook call held
 * its own `useState` copy, so a resolved battle updated the overlay's copy and
 * disk but left the map rendering the pre-battle turn and owners until a
 * remount.
 */
const stateStore = createDocumentStore<ConquestStateFile>(
  fetchStateFile,
  emptyStateFile,
);

/** Re-read the run-state file, refresh the shared cache, and notify consumers. */
export const refreshConquestState = stateStore.refresh;

/**
 * Persist one galaxy's run state (or remove it with `undefined`), updating the
 * shared cache and pushing it to every consumer so the map re-renders at once.
 * Builds on the latest cache, so two quick saves don't clobber each other.
 */
async function saveConquestState(
  galaxyId: string,
  state: ConquestState | undefined,
): Promise<void> {
  const conquests = { ...(stateStore.getCached() ?? emptyStateFile).conquests };
  if (state) {
    conquests[galaxyId] = state;
  } else {
    delete conquests[galaxyId];
  }
  const next: ConquestStateFile = { schemaVersion: 1, conquests };
  stateStore.publish(next);
  await conquestStateSave({ json: JSON.stringify(next) });
}

/**
 * Load / save wrappers around the run-state commands, backed by the shared
 * store above. State is stored separately from galaxy documents so bundled
 * (read-only) galaxies still track runs. Each galaxy's saved state is healed
 * against its (possibly updated) document via {@link reconcileState} on read.
 */
export function useConquestState() {
  const { data: file, loading, error, refresh } = stateStore.useStore();

  /** A galaxy's saved run, healed against the current document. */
  const stateFor = useCallback(
    (galaxy: GalaxyDoc): ConquestState | undefined => {
      const saved = file.conquests[galaxy.id];
      return saved ? reconcileState(galaxy, saved) : undefined;
    },
    [file],
  );

  return {
    file,
    loading,
    error,
    refresh,
    saveFor: saveConquestState,
    stateFor,
  };
}
