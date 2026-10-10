import { useMemo } from "react";
import type {
  GameItem,
  ReplayAnalysisAttempt,
  StoredReplayAnalysis,
} from "./bindings";
import { useContentState } from "./contentState";
import {
  compareEngineVersions,
  engineLabel,
  isRealEngineVersion,
} from "./engineVersion";
import { pickUnitSource } from "./replayBuildOrders";

/**
 * What an analysis can be offered when the engine or the game the replay was
 * recorded on is not installed (#3869).
 *
 * A playback on another engine usually computes another match, and the run's
 * check against the replay's own recorded result decides whether it is kept.
 * Nothing here runs anything. It works out what the replay page can put in
 * front of a person who then presses a button.
 */

/** An installed engine, with the content folder it sits in. */
export interface InstalledEngine {
  path: string;
  dataDir: string;
  /** The folder's name. */
  version: string;
  /** What the engine reported, once it has. */
  syncVersion?: string;
}

/** An engine an analysis could use in place of the recorded one. */
export interface EngineOption {
  path: string;
  dataDir: string;
  /** The engine's version, or its folder when it has none. */
  label: string;
  /** An earlier run on this engine and this game did not reproduce the match. */
  tried: boolean;
}

/** The installed engines, kept current. */
export function useInstalledEngines(): InstalledEngine[] {
  const { state } = useContentState();
  return useMemo(
    () =>
      (state?.roots ?? []).flatMap((root) =>
        root.engines.map((e) => ({
          path: e.path,
          dataDir: root.path,
          version: e.version,
          syncVersion: e.syncVersion,
        })),
      ),
    [state],
  );
}

/**
 * The attempts a stored analysis records as not reproducing the match. A
 * diverged file from before attempts were kept holds one, in its own fields.
 */
export function divergedAttempts(
  stored: StoredReplayAnalysis | undefined,
): ReplayAnalysisAttempt[] {
  if (stored?.outcome !== "diverged") return [];
  if (stored.attempts && stored.attempts.length > 0) return stored.attempts;
  return [
    {
      engine: stored.engine,
      game: stored.game,
      analysedAtMs: stored.analysedAtMs,
      disagreements: stored.disagreements,
    },
  ];
}

function versionOf(e: InstalledEngine): string {
  return e.syncVersion ?? e.version;
}

/**
 * The installed engines an analysis can use in place of the recorded one.
 *
 * Only engines with a headless build, which `headless` lists by path, because
 * the analysis runs with no window. An engine that is the recorded one by
 * version is left out, so the exact engine is never offered as "another".
 *
 * The app has an order for engine versions, `compareEngineVersions`, and no
 * measure of how near one version is to another. So the engines come newest
 * first, and no engine is picked as nearest. An engine an earlier attempt on
 * `game` did not reproduce the match on comes after the ones not yet tried.
 */
export function otherEngineOptions(args: {
  recorded: string;
  engines: InstalledEngine[];
  headless: readonly string[];
  attempts: readonly ReplayAnalysisAttempt[];
  /** The game the run would depend on. */
  game: string;
}): EngineOption[] {
  const recorded = args.recorded.trim();
  const headless = new Set(args.headless);
  const options = args.engines
    .filter((e) => headless.has(e.path))
    .filter(
      (e) =>
        !isRealEngineVersion(recorded) ||
        compareEngineVersions(recorded, versionOf(e)) !== 0,
    )
    .map((e, order) => ({ e, order }))
    // Newest first. The input order breaks a tie, so the list does not shuffle.
    .sort(
      (a, b) =>
        compareEngineVersions(versionOf(b.e), versionOf(a.e)) ||
        a.order - b.order,
    )
    .map(({ e }) => ({
      path: e.path,
      dataDir: e.dataDir,
      label: engineLabel(e),
      tried: args.attempts.some(
        (a) =>
          a.game === args.game &&
          compareEngineVersions(a.engine, versionOf(e)) === 0,
      ),
    }));
  return [
    ...options.filter((o) => !o.tried),
    ...options.filter((o) => o.tried),
  ];
}

/**
 * Another installed version of the replay's game, when the exact one is not
 * installed, or null. It is the one `pickUnitSource` picks for the unit names:
 * the highest name of the game's family, which for numbered versions is the
 * newest. The app has no measure of which version is closest.
 */
export function otherGameVersion(
  recorded: string,
  games: GameItem[],
): GameItem | null {
  const source = pickUnitSource(recorded, games);
  return source.kind === "differentBuild" ? source.game : null;
}
