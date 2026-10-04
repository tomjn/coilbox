import { useMemo } from "react";
import { useWriteRoot } from "../downloads/config";
import { useDownloadComplete } from "../downloads/DownloadQueueProvider";
import { useContentTargets } from "./config";
import { replayEngineDecision, replayEngineRequirement } from "./replayEngine";
import { useResolveContent } from "./useResolveContent";

/**
 * The engine a replay was recorded on: what is installed, whether it can be
 * downloaded, and the decision `replayEngineDecision` makes from both (issue
 * #3370). The replay page holds this once and hands the parts to the notice and
 * to the Watch button.
 *
 * Resolved with no scan target on purpose. Only an engine is asked for, and
 * waiting for a unitsync scan of the games and maps before offering one would
 * hold the offer back for a cold scan.
 */
export function useReplayEngine(recorded: string) {
  const { targets, loading: targetsLoading, refresh } = useContentTargets();
  // This hook holds its own read of the installed engines, so an engine that
  // finishes downloading is invisible to it until it looks again.
  useDownloadComplete((done) => {
    if (done.kind === "engineRecoil" || done.kind === "engineSpring") {
      void refresh();
    }
  });

  const requirement = useMemo(
    () => replayEngineRequirement(recorded),
    [recorded],
  );
  const requirements = useMemo(
    () => (recorded.trim() === "" ? [] : [requirement]),
    [recorded, requirement],
  );
  const resolve = useResolveContent(requirements, undefined);
  const writeRoot = useWriteRoot();

  const decision = replayEngineDecision({
    recorded,
    installedVersions: targets.map((t) => t.engineVersion),
    resolve: {
      loading: resolve.loading || targetsLoading || writeRoot.loading,
      canDownload: resolve.canDownload(requirement),
      noWriteRoot: resolve.noWriteRoot,
    },
  });

  return { ...decision, requirement, resolve };
}

/** What {@link useReplayEngine} hands the replay page. */
export type ReplayEngine = ReturnType<typeof useReplayEngine>;
