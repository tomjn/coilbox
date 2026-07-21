import { Button } from "@picoframe/frame";
import { Play } from "lucide-react";
import { useState } from "react";
import { useReplayTarget } from "../../../play/config";
import { usePlay } from "../../../play/PlayProvider";
import { useReplayUserState } from "../../replayUserState";

/**
 * Launch the engine to watch a replay. Resolves the best-matching installed engine
 * for the demo's recorded version (exact match, else the preferred engine as a
 * fallback with a sync warning). Disabled with a reason when no engine is
 * installed, and while any game/replay is already running.
 */
export function WatchButton({
  replayPath,
  engineVersion,
}: {
  replayPath: string;
  engineVersion: string;
}) {
  const { resolved } = useReplayTarget(engineVersion);
  const { running, launchReplay } = usePlay();
  const userState = useReplayUserState();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onWatch() {
    if (!resolved) return;
    setPending(true);
    setError(null);
    try {
      // Watching a replay marks it watched (keyed by filename, as the list is).
      const filename = replayPath.split(/[\\/]/).pop();
      if (filename) userState.setWatched(filename, true);
      const res = await launchReplay({
        demoPath: replayPath,
        executable: resolved.target.executable,
        dataDir: resolved.target.dataDir,
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

  const title = !resolved
    ? "Install an engine to watch replays."
    : running && !pending
      ? "A game is already running."
      : undefined;

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        onClick={onWatch}
        disabled={!resolved || running}
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
