import { Button } from "@picoframe/frame";
import { Channel } from "@tauri-apps/api/core";
import { Play } from "lucide-react";
import { useState } from "react";
import { type LaunchEvent, playLaunchReplay } from "../../../play/bindings";
import { useReplayTarget } from "../../../play/config";

/**
 * Launch the engine to watch a replay. Resolves the best-matching installed
 * engine for the demo's recorded version (exact match, else the preferred engine
 * as a fallback with a sync warning). Disabled with a reason when no engine is
 * installed, and while a game/replay is already running.
 */
export function WatchButton({
  replayPath,
  engineVersion,
}: {
  replayPath: string;
  engineVersion: string;
}) {
  const { resolved } = useReplayTarget(engineVersion);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onWatch() {
    if (!resolved) return;
    setRunning(true);
    setError(null);
    const onEvent = new Channel<LaunchEvent>();
    // The authoritative "finished" signal is the promise resolving; the channel
    // just lets the engine report its lifecycle.
    onEvent.onmessage = () => {};
    try {
      const res = await playLaunchReplay({
        demoPath: replayPath,
        executable: resolved.target.executable,
        dataDir: resolved.target.dataDir,
        runId: crypto.randomUUID(),
        onEvent,
      });
      if (res.exitCode && res.exitCode !== 0) {
        setError(`Engine exited with code ${res.exitCode}.`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        onClick={onWatch}
        disabled={!resolved || running}
        title={resolved ? undefined : "Install an engine to watch replays."}
        className="gap-1.5"
      >
        <Play className="size-4" />
        {running ? "Watching…" : "Watch"}
      </Button>
      {resolved && !resolved.matched && (
        <p className="max-w-xs text-right text-xs text-amber-600 dark:text-amber-400">
          Recorded on {engineVersion || "an unknown engine"}; watching with{" "}
          {resolved.target.engineVersion} — may not sync.
        </p>
      )}
      {error && (
        <p className="max-w-xs text-right text-xs text-destructive">{error}</p>
      )}
    </div>
  );
}
