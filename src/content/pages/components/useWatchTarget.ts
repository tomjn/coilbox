import { t } from "@lingui/core/macro";
import { type PlayTarget, useReplayTarget } from "../../../play/config";
import { useLaunchContent } from "../../../play/LaunchContentProvider";
import { type ReplayWatch, replayEngineRequirement } from "../../replayEngine";

/** Whether the page's engine decision leaves nothing to launch on. */
export const isBlocked = (watch: ReplayWatch) =>
  watch.kind === "wait" ||
  watch.kind === "none" ||
  watch.kind === "unavailable";

/** Why the page cannot launch this replay on an engine, or undefined. */
export function launchBlockedReason(
  watch: ReplayWatch,
  dependencyBlock?: string | null,
): string | undefined {
  if (dependencyBlock) return dependencyBlock;
  if (watch.kind === "none") return t`Install an engine to watch replays.`;
  if (watch.kind === "unavailable") {
    const { version } = watch;
    return t`This replay needs engine ${version}, which is not installed and cannot be downloaded here.`;
  }
  if (watch.kind === "wait")
    return t`Checking for the engine this replay needs.`;
  return undefined;
}

/**
 * The engine a launch of this replay runs on, as the Watch button resolves it.
 * Call the result when the button is pressed. It gives the engine and the
 * content folder, or null when there is nothing to launch on: the person closed
 * the download drawer, or the engine the decision found has not been read yet.
 *
 * When the recorded engine is not installed but can be downloaded, the shared
 * launch check offers it first and the launch uses what it installs (issue
 * #3370). An engine that has not reported its version is checked first, when
 * the button is pressed and not before. A replay never runs on another engine
 * when the recorded one can be had.
 */
export function useWatchTarget(engineVersion: string, watch: ReplayWatch) {
  const { resolved } = useReplayTarget(engineVersion);
  const { ensureContent } = useLaunchContent();

  return async (): Promise<PlayTarget | null> => {
    let target = resolved?.target;
    // `verify` is an engine in a folder named for the recorded version that has
    // not said what it is. The shared check asks it, and offers the download if
    // it is another build (issues #3405, #3452). This is the only place the
    // replay page starts an engine to ask.
    if (watch.kind === "download" || watch.kind === "verify") {
      const check = await ensureContent({
        requirements: [replayEngineRequirement(engineVersion)],
        title: t`Download the engine this replay needs`,
      });
      // Closed the drawer, so nothing is launched.
      if (!check.ready) return null;
      target = check.target;
    }
    // `recorded` means the decision found the engine installed. A read of the
    // engines that has not caught up must not fall through to another one.
    if (watch.kind === "recorded" && !resolved?.matched) return null;
    return target ?? null;
  };
}
