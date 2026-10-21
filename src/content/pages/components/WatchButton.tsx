import { useLingui } from "@lingui/react/macro";
import { Button } from "@picoframe/frame";
import { Play } from "lucide-react";
import { usePlay } from "../../../play/PlayProvider";
import type { ReplayWatch } from "../../replayEngine";
import { useWatchReplay } from "./useWatchReplay";
import { isBlocked, launchBlockedReason } from "./useWatchTarget";

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
  const { t } = useLingui();
  const { running } = usePlay();
  const {
    watchReplay: onWatch,
    pending,
    error,
  } = useWatchReplay(replayPath, engineVersion, watch, dependencyBlock);

  const title =
    launchBlockedReason(watch, dependencyBlock) ??
    (running && !pending ? t`A game is already running.` : undefined);

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        onClick={onWatch}
        disabled={isBlocked(watch) || !!dependencyBlock || running || pending}
        title={title}
        className="gap-1.5"
      >
        <Play className="size-4 fill-current" />
        {pending ? t`Watching…` : t`Watch`}
      </Button>
      {error && (
        <p className="max-w-xs text-right text-xs text-destructive">{error}</p>
      )}
    </div>
  );
}
