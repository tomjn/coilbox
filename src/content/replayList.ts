import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { contentListReplays, type ReplayFile } from "./bindings";
import { shareInFlight } from "./inFlight";

/**
 * Session cache of each content root's replay list.
 *
 * The backend keeps decoded summaries on disk, so a listing no longer decodes
 * files that have not changed, but it still walks the folder. The list only
 * changes when a game writes a replay, a replay is deleted or moved, or the
 * player asks, so it is held for the session and callers that ask together
 * share one request. A failed read is not kept, so the next ask tries again.
 */

const held = new Map<string, ReplayFile[]>();
const pending = new Map<string, Promise<ReplayFile[]>>();
/** Bumped by a change, so a read that started before it is not stored after. */
let generation = 0;
const subscribers = new Set<() => void>();

function publish(): void {
  for (const fn of subscribers) fn();
}

/**
 * The replays in `root`, newest first. Pass `refresh` to read the folder again,
 * which the callers that look for a replay a game just wrote do.
 */
export function loadReplays(
  root: string,
  refresh = false,
): Promise<ReplayFile[]> {
  const hit = refresh ? undefined : held.get(root);
  if (hit) return Promise.resolve(hit);
  return shareInFlight(pending, root, async () => {
    const started = generation;
    const { replays } = await contentListReplays({ root });
    if (started === generation) {
      held.set(root, replays);
      publish();
    }
    return replays;
  });
}

/** The list if it is already held, so a page can draw it at once. */
export function heldReplays(root: string): ReplayFile[] | undefined {
  return held.get(root);
}

/**
 * Take a deleted replay out of every held list at once, then read each affected
 * root again so the backend drops its stored summary too.
 */
export function forgetReplay(path: string): void {
  generation += 1;
  const affected: string[] = [];
  for (const [root, list] of held) {
    if (!list.some((r) => r.path === path)) continue;
    held.set(
      root,
      list.filter((r) => r.path !== path),
    );
    affected.push(root);
  }
  publish();
  for (const root of affected) loadReplays(root, true).catch(() => {});
}

/** Forget every held list and open read. For tests. */
export function resetReplays(): void {
  generation += 1;
  held.clear();
  pending.clear();
  publish();
}

function subscribe(fn: () => void): () => void {
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
}

/** List the replays in a content root (re-runs on `rootPath` change / refresh). */
export function useReplays(rootPath?: string) {
  const replays = useSyncExternalStore(
    subscribe,
    () => (rootPath ? held.get(rootPath) : undefined),
    () => undefined,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The rootPath whose read has finished, so the UI can tell "loaded and empty"
  // from "not loaded yet".
  const [loadedFor, setLoadedFor] = useState<string | undefined>(undefined);

  const load = useCallback(
    async (refresh: boolean) => {
      if (!rootPath) {
        setLoadedFor(undefined);
        return;
      }
      if (!refresh && held.has(rootPath)) {
        setLoadedFor(rootPath);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        await loadReplays(rootPath, refresh);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoadedFor(rootPath);
        setLoading(false);
      }
    },
    [rootPath],
  );

  const refresh = useCallback(() => load(true), [load]);

  useEffect(() => {
    load(false);
  }, [load]);

  return {
    replays: replays ?? EMPTY,
    loading,
    error,
    refresh,
    ready: replays !== undefined || loadedFor === rootPath,
  };
}

const EMPTY: ReplayFile[] = [];
