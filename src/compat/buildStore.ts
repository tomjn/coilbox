import { Channel } from "@tauri-apps/api/core";
import { useSyncExternalStore } from "react";
import type { Convert3doProgress } from "../content/bindings";
import { type CompatBuilt, compatBuild } from "./bindings";

/**
 * The compat builds under way, so a component that mounts mid build reads the
 * count here, and a second asker joins the build instead of writing the same
 * folder again. A `Channel` belongs to the one call that made it, which is why
 * the count is kept here rather than read from the channel.
 */
interface RunningBuild {
  done: Promise<CompatBuilt>;
  progress?: Convert3doProgress;
}

const builds = new Map<string, RunningBuild>();
const listeners = new Set<() => void>();

function changed() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** One game's mutator at one manifest version, which is one folder on disk. */
export function compatBuildKey(
  dataDir: string | undefined,
  archiveName: string,
  manifestVersion: number,
): string {
  return `${dataDir}::${archiveName}::${manifestVersion}`;
}

/** Build a mutator, or join the build of it already running. */
export function buildCompatOnce(
  args: Omit<Parameters<typeof compatBuild>[0], "onProgress">,
): Promise<CompatBuilt> {
  const key = compatBuildKey(
    args.dataDir,
    args.archiveName,
    args.manifestVersion,
  );
  const running = builds.get(key);
  if (running) return running.done;

  const onProgress = new Channel<Convert3doProgress>();
  const done = compatBuild({ ...args, onProgress }).finally(() => {
    builds.delete(key);
    changed();
  });
  onProgress.onmessage = (line) => {
    if (!builds.has(key)) return;
    builds.set(key, { done, progress: line });
    changed();
  };
  builds.set(key, { done });
  changed();
  return done;
}

/** The build running for `key`, or undefined. Rerenders as it counts and ends. */
export function useCompatBuild(key: string | null): RunningBuild | undefined {
  return useSyncExternalStore(subscribe, () =>
    key === null ? undefined : builds.get(key),
  );
}
