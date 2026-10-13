import { useState } from "react";
import { usePlay } from "../../../play/PlayProvider";
import type { ReplayWatch } from "../../replayEngine";
import { useReplayUserState } from "../../replayUserState";
import { isBlocked, useWatchTarget } from "./useWatchTarget";

/**
 * Watch a replay in the engine, as the Watch button does: resolve the engine,
 * mark the replay watched, launch it, and report an engine that exited badly.
 * Shared so another button can offer the same plain Watch.
 */
export function useWatchReplay(
  replayPath: string,
  engineVersion: string,
  watch: ReplayWatch,
  dependencyBlock?: string | null,
) {
  const resolveTarget = useWatchTarget(engineVersion, watch);
  const { launchReplay } = usePlay();
  const userState = useReplayUserState();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function watchReplay() {
    if (isBlocked(watch) || dependencyBlock) return;
    setPending(true);
    setError(null);
    try {
      const target = await resolveTarget();
      if (!target) return;
      // Watching a replay marks it watched (keyed by filename, as the list is).
      const filename = replayPath.split(/[\\/]/).pop();
      if (filename) userState.setWatched(filename, true);
      const res = await launchReplay({
        demoPath: replayPath,
        executable: target.executable,
        dataDir: target.dataDir,
      });
      if (res.exitCode && res.exitCode !== 0) {
        setError(`Engine exited with code ${res.exitCode}.`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  }

  return { watchReplay, pending, error };
}
