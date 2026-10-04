import { Button } from "@picoframe/frame";
import { Play } from "lucide-react";
import { useState } from "react";
import { useReplayTarget } from "../../../play/config";
import { useLaunchContent } from "../../../play/LaunchContentProvider";
import { usePlay } from "../../../play/PlayProvider";
import { type ReplayWatch, replayEngineRequirement } from "../../replayEngine";
import { useReplayUserState } from "../../replayUserState";

/**
 * Launch the engine to watch a replay, on the engine the replay was recorded on
 * when it is installed. When it is not installed but can be downloaded, the
 * shared launch check offers it first and the replay starts on what it installs
 * (issue #3370). Only when the recorded engine cannot be had does it fall back
 * to another installed engine, which may not sync. Disabled with a reason when
 * no engine can run it, and while any game/replay is already running.
 *
 * `watch` is the page's decision from `replayEngineDecision`.
 */
export function WatchButton({
  replayPath,
  engineVersion,
  watch,
}: {
  replayPath: string;
  engineVersion: string;
  watch: ReplayWatch;
}) {
  const { resolved } = useReplayTarget(engineVersion);
  const { ensureContent } = useLaunchContent();
  const { running, launchReplay } = usePlay();
  const userState = useReplayUserState();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onWatch() {
    if (watch.kind === "wait" || watch.kind === "none") return;
    setPending(true);
    setError(null);
    try {
      let target = resolved?.target;
      if (watch.kind === "download") {
        const check = await ensureContent({
          requirements: [replayEngineRequirement(engineVersion)],
          title: "Download the engine this replay needs",
        });
        // Closed the drawer, so the replay is not watched and not marked so.
        if (!check.ready) return;
        target = check.target;
      }
      // `recorded` means the decision found the engine installed. A read of the
      // engines that has not caught up must not fall through to another one.
      if (watch.kind === "recorded" && !resolved?.matched) return;
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
    watch.kind === "none"
      ? "Install an engine to watch replays."
      : watch.kind === "wait"
        ? "Checking for the engine this replay needs."
        : running && !pending
          ? "A game is already running."
          : undefined;

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        onClick={onWatch}
        disabled={
          watch.kind === "wait" || watch.kind === "none" || running || pending
        }
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
