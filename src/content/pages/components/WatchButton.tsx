import { Button } from "@picoframe/frame";
import { Play } from "lucide-react";
import { useState } from "react";
import { usePlay } from "../../../play/PlayProvider";
import type { ReplayWatch } from "../../replayEngine";
import { useReplayUserState } from "../../replayUserState";
import {
  isBlocked,
  launchBlockedReason,
  useWatchTarget,
} from "./useWatchTarget";

/**
 * Launch the engine to watch a replay, on the engine the replay was recorded on
 * when it is installed. When it is not installed but can be downloaded, the
 * shared launch check offers it first and the replay starts on what it installs
 * (issue #3370). An engine that has not reported its version is checked first,
 * when Watch is pressed and not before. A replay never runs on another engine: when the recorded one
 * cannot be had, Watch is disabled and says which version is needed. Only a
 * header that names no version falls back to an installed engine. Also disabled
 * while any game/replay is already running, and when the replay's game depends on
 * an archive that is not installed, which would stop the engine (issue #3489).
 *
 * `watch` is the page's decision from `replayEngineDecision`.
 */
export function WatchButton({
  replayPath,
  engineVersion,
  watch,
  dependencyBlock,
}: {
  replayPath: string;
  engineVersion: string;
  watch: ReplayWatch;
  /** `replayDependencyBlock`: why the replay's game cannot run, or null. */
  dependencyBlock?: string | null;
}) {
  const resolveTarget = useWatchTarget(engineVersion, watch);
  const { running, launchReplay } = usePlay();
  const userState = useReplayUserState();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onWatch() {
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

  const title =
    launchBlockedReason(watch, dependencyBlock) ??
    (running && !pending ? "A game is already running." : undefined);

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        onClick={onWatch}
        disabled={isBlocked(watch) || !!dependencyBlock || running || pending}
        title={title}
        className="gap-1.5"
      >
        <Play className="size-4 fill-current" />
        {pending ? "Watching…" : "Watch"}
      </Button>
      {error && (
        <p className="max-w-xs text-right text-xs text-destructive">{error}</p>
      )}
    </div>
  );
}
