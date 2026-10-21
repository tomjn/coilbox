import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { Button } from "@picoframe/frame";
import { ExternalLink } from "lucide-react";
import { useState } from "react";
import { usePlay } from "../../../play/PlayProvider";
import type { ReplayWatch } from "../../replayEngine";
import type { ReplayClock } from "../../replayMapView/clock";
import {
  isBlocked,
  launchBlockedReason,
  useWatchTarget,
} from "./useWatchTarget";

/**
 * Open the engine on the playback game, paused at the moment the map view
 * shows (#3809). The frame is read from the clock when the button is pressed,
 * because the address lags it while the match plays or the knob is dragged.
 *
 * The engine and the content folder are the Watch button's, from
 * {@link useWatchTarget}. The launch goes through the play provider, so crash
 * triage and the running state are the same as for any other game.
 */
export function OpenInEngineButton({
  replayPath,
  engineVersion,
  watch,
  dependencyBlock,
  game,
  clock,
}: {
  replayPath: string;
  engineVersion: string;
  watch: ReplayWatch;
  /** `replayDependencyBlock`: why the replay's game cannot run, or null. */
  dependencyBlock?: string | null;
  /** Another installed version of the replay's game, when its own is missing. */
  game?: string;
  clock: ReplayClock;
}) {
  const { t: tr } = useLingui();
  const resolveTarget = useWatchTarget(engineVersion, watch);
  const { running, launchReplayPlayback } = usePlay();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onOpen() {
    if (isBlocked(watch) || dependencyBlock) return;
    setPending(true);
    setError(null);
    try {
      const target = await resolveTarget();
      if (!target) return;
      const res = await launchReplayPlayback({
        replayPath,
        executable: target.executable,
        dataDir: target.dataDir,
        game,
        // The clock can sit between two frames.
        startFrame: Math.max(0, Math.round(clock.frame)),
        paused: true,
      });
      if (res.exitCode && res.exitCode !== 0) {
        const exitCode = res.exitCode;
        setError(t`Engine exited with code ${exitCode}.`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  }

  const title =
    launchBlockedReason(watch, dependencyBlock) ??
    (running && !pending
      ? tr`A game is already running.`
      : tr`Opens the engine, paused at the moment shown.`);

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onOpen}
        disabled={isBlocked(watch) || !!dependencyBlock || running || pending}
        title={title}
        className="gap-1.5"
      >
        <ExternalLink className="size-4" />
        {pending ? tr`Opening…` : tr`Open in engine`}
      </Button>
      {error && (
        <p className="max-w-xs text-right text-xs text-destructive">{error}</p>
      )}
    </div>
  );
}
