import { useCallback, useSyncExternalStore } from "react";
import { contentDemoBuildOrders, type DemoBuildOrders } from "./bindings";

/**
 * One replay's build orders, read once for the whole page (#1152).
 *
 * Reading them walks the whole demo stream, so nothing reads until a surface
 * asks. The build order section asks when its button is pressed, and the map
 * asks when a layer that draws them is switched on. Whichever asks first does
 * the walk and the other gets the same answer, as the chat log and the
 * timeline share `useReplayChat`.
 *
 * Only the last replay asked for is kept. A failed read is kept as failed
 * until somebody asks again.
 */

export type BuildOrdersRead =
  | { status: "idle"; result: null }
  | { status: "loading"; result: null }
  | { status: "failed"; result: null }
  | { status: "done"; result: DemoBuildOrders };

const IDLE: BuildOrdersRead = { status: "idle", result: null };

let held: { path: string; read: BuildOrdersRead } | null = null;
const listeners = new Set<() => void>();

function set(path: string, read: BuildOrdersRead) {
  held = { path, read };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Read a replay's build orders unless a read for it is in flight or done. */
export function loadReplayBuildOrders(replayPath: string): void {
  if (held?.path === replayPath) {
    const { status } = held.read;
    if (status === "loading" || status === "done") return;
  }
  set(replayPath, { status: "loading", result: null });
  contentDemoBuildOrders({ replayPath }).then(
    (result) => {
      // Another replay was asked for while this one was read.
      if (held?.path === replayPath)
        set(replayPath, { status: "done", result });
    },
    () => {
      if (held?.path === replayPath)
        set(replayPath, { status: "failed", result: null });
    },
  );
}

/** Forget what was read. For tests, which share the module between cases. */
export function resetReplayBuildOrders(): void {
  held = null;
  for (const listener of listeners) listener();
}

export function useReplayBuildOrders(replayPath: string) {
  const read = useSyncExternalStore(subscribe, () =>
    held?.path === replayPath ? held.read : IDLE,
  );
  const load = useCallback(
    () => loadReplayBuildOrders(replayPath),
    [replayPath],
  );
  return {
    result: read.result,
    status: read.status,
    loading: read.status === "loading",
    failed: read.status === "failed",
    load,
  };
}
