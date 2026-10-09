import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { type ContentState, contentStateLoad } from "./bindings";
import { shareInFlight } from "./inFlight";

/**
 * The content state for the session, held once and read by every hook.
 *
 * Almost every screen asks where the content folders and engines are. Each
 * `useContentState` used to ask the backend itself and start on a loading
 * state. Now the first read fills this store, a hook that mounts later gets the
 * value on its first render, and readers that ask together share one request.
 * A failed read is not kept, so the next reader asks again.
 */

let held: ContentState | null = null;
/** Bumped by every write, so a read that started before it is not stored after. */
let generation = 0;
const pending = new Map<string, Promise<ContentState>>();
const subscribers = new Set<() => void>();

function publish(next: ContentState | null): void {
  // An unchanged answer keeps the old object, so a focus check that finds
  // nothing new does not re-render every screen.
  if (JSON.stringify(next) === JSON.stringify(held)) return;
  held = next;
  for (const fn of subscribers) fn();
}

/** Replace the held state, as the commands that change it do with their result. */
export function setContentState(
  next:
    | ContentState
    | null
    | ((current: ContentState | null) => ContentState | null),
): void {
  generation += 1;
  publish(typeof next === "function" ? next(held) : next);
}

/**
 * Read the state from the backend, which checks it against the disk, and hold
 * it. Callers that ask together share one request.
 */
export function refreshContentState(): Promise<ContentState> {
  return shareInFlight(pending, "state", async () => {
    const started = generation;
    const { state } = await contentStateLoad(undefined);
    // A write landed while this read was open, and its answer is newer.
    if (started !== generation && held) return held;
    publish(state);
    return held ?? state;
  });
}

/** The held state, or the first read when there is none yet. */
export function loadContentState(): Promise<ContentState> {
  return held ? Promise.resolve(held) : refreshContentState();
}

/** Forget the held state and any open read. For tests. */
export function resetContentState(): void {
  held = null;
  generation += 1;
  pending.clear();
}

function onFocus(): void {
  refreshContentState().catch(() => {});
}

function subscribe(fn: () => void): () => void {
  // A folder or engine can be deleted while coilbox runs, so coming back to the
  // window checks the disk again. Only while something is reading the state.
  if (subscribers.size === 0) window.addEventListener("focus", onFocus);
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
    if (subscribers.size === 0) window.removeEventListener("focus", onFocus);
  };
}

function snapshot(): ContentState | null {
  return held;
}

/**
 * Read the shared content state. `state` is `null` until the first read has
 * finished anywhere in the app. `setState` applies the result of a command that
 * changed it (rescan, add, remove, verify) without a second round-trip.
 */
export function useContentState() {
  const state = useSyncExternalStore(subscribe, snapshot);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      await refreshContentState();
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (snapshot()) return;
    loadContentState().then(
      () => setError(null),
      (e) => setError(e instanceof Error ? e.message : String(e)),
    );
  }, []);

  return {
    state,
    setState: setContentState,
    loading: busy || (state === null && error === null),
    error,
    refresh,
  };
}
