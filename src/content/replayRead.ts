import { useCallback, useSyncExternalStore } from "react";

/**
 * One replay's read of something that walks the whole demo stream, kept for the
 * page, as `useReplayBuildOrders` keeps the build orders.
 *
 * Nothing reads until a surface asks. Whoever asks first does the walk and the
 * others get the same answer. Only the last replay asked for is kept, and a
 * read shows only under the path it was made for, so going from one replay's
 * page to another's never shows the first's data under the second's name and a
 * late answer for the first cannot overwrite the second. A failed read is kept
 * as failed until somebody asks again.
 */

export type ReplayRead<T> =
  | { status: "idle"; result: null }
  | { status: "loading"; result: null }
  | { status: "failed"; result: null }
  | { status: "done"; result: T };

export function createReplayRead<T>(read: (replayPath: string) => Promise<T>) {
  const idle: ReplayRead<T> = { status: "idle", result: null };
  let held: { path: string; read: ReplayRead<T> } | null = null;
  const listeners = new Set<() => void>();

  const set = (path: string, next: ReplayRead<T>) => {
    held = { path, read: next };
    for (const listener of listeners) listener();
  };
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };

  function load(replayPath: string): void {
    if (held?.path === replayPath) {
      const { status } = held.read;
      if (status === "loading" || status === "done") return;
    }
    set(replayPath, { status: "loading", result: null });
    read(replayPath).then(
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
  function reset(): void {
    held = null;
    for (const listener of listeners) listener();
  }

  function useRead(replayPath: string) {
    const current = useSyncExternalStore(subscribe, () =>
      held?.path === replayPath ? held.read : idle,
    );
    const ask = useCallback(() => load(replayPath), [replayPath]);
    return {
      result: current.result,
      status: current.status,
      loading: current.status === "loading",
      failed: current.status === "failed",
      load: ask,
    };
  }

  return { useRead, load, reset };
}
