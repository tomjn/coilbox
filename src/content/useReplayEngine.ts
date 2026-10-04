import { useMemo } from "react";
import { useWriteRoot } from "../downloads/config";
import { useDownloadComplete } from "../downloads/DownloadQueueProvider";
import { useContentState } from "./config";
import { replayEngineDecision, replayEngineRequirement } from "./replayEngine";
import type { InstalledEngine } from "../play/engineConfirmation";
import { useResolveContent } from "./useResolveContent";

/**
 * The engine a replay was recorded on: what is installed, whether it can be
 * downloaded, and the decision `replayEngineDecision` makes from both (issue
 * #3370). The replay page holds this once and hands the parts to the notice and
 * to the Watch button.
 *
 * Nothing here starts an engine. An engine that has not reported its version is
 * read by its folder name only to see whether it might be the one, and the page
 * says it has not been checked. Watch does the checking (issue #3452).
 *
 * Resolved with no scan target on purpose. Only an engine is asked for, and
 * waiting for a unitsync scan of the games and maps before offering one would
 * hold the offer back for a cold scan.
 */
export function useReplayEngine(recorded: string) {
  const { state, loading: targetsLoading, refresh } = useContentState();
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
  const engines = useMemo<InstalledEngine[]>(
    () =>
      (state?.roots ?? []).flatMap((r) =>
        r.engines.map((e) => ({
          executable: e.executable,
          folder: e.version,
          verified: e.syncVersion || undefined,
        })),
      ),
    [state],
  );
  // Without this the resolver reads the same engines by folder name.
  const reading = useMemo(
    () => ({
      versions: engines.flatMap((e) => (e.verified ? [e.verified] : [])),
      unconfirmed: null,
    }),
    [engines],
  );
  const resolve = useResolveContent(requirements, undefined, false, reading);
  const writeRoot = useWriteRoot();

  const decision = replayEngineDecision({
    recorded,
    engines,
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
