/**
 * What the replay page offers for the engine a replay was recorded on, and what
 * its Watch button does about it (issue #3370).
 *
 * A replay only plays back on the engine version that recorded it. Pure, so the
 * decision is tested without React. The version comparison is
 * `compareEngineVersions`, the one `useReplayTarget` already picks an engine
 * with, so "installed" here and "the engine Watch launches" cannot disagree.
 *
 * Whether the engine is installed is `concludeEngine`'s answer, the one the
 * launch check gives, so this page and Watch apply one rule: only a version the
 * engine binary reported counts, and a folder name is not a version (issue
 * #3452). This page never starts an engine to find out. It says an unchecked
 * engine has not been checked, and Watch checks it.
 */

import {
  concludeEngine,
  type InstalledEngine,
} from "../play/engineConfirmation";
import { missingLaunchDependency } from "../play/launchContent";
import { compareEngineVersions } from "./engineVersion";
import { dependencyBlockReason } from "./gameDependencies";
import {
  type ContentRequirement,
  gameNamesMatch,
  type InstalledContentSnapshot,
} from "./resolveContent";

/**
 * The engine a replay was recorded on, as something the shared launch check and
 * the download queue can resolve. Matches an installed engine by release and
 * commit count, so a different branch label on the same build still counts.
 * `downloadKey` is the header's own text, which has to equal a catalog version
 * for a download to be found.
 */
export function replayEngineRequirement(version: string): ContentRequirement {
  const recorded = version.trim();
  return {
    kind: "engine",
    label: recorded,
    downloadKey: recorded,
    isInstalled: (i) =>
      i.engineVersions.some((v) => compareEngineVersions(recorded, v) === 0),
  };
}

export interface ReplayEngineReadings {
  /** The engine version in the replay header. Blank when it names none. */
  recorded: string;
  /** Every installed engine, with the version it reported once it has. */
  engines: InstalledEngine[];
  /** What the download resolver says about the recorded engine. */
  resolve: {
    /** The engine catalogs have not answered. */
    loading: boolean;
    canDownload: boolean;
    /** The download folder was read and there is none. */
    noWriteRoot: boolean;
  };
}

export type ReplayEngineNotice =
  /** Nothing to say. */
  | { kind: "none" }
  /** Still reading. Say nothing yet. */
  | { kind: "pending" }
  /** No engine has reported the version, but one sits in a folder named for it.
   *  It may be the engine, so this is neither "installed" nor "download". */
  | { kind: "unchecked"; version: string }
  /** Not installed, and it can be downloaded. */
  | { kind: "download"; version: string }
  /** Not installed and cannot be downloaded. Names the version so the player
   *  knows which engine to find. */
  | {
      kind: "unavailable";
      version: string;
      reason: "no-write-root" | "no-build";
    };

export type ReplayWatch =
  /** The recorded engine is installed. Watch runs on it. */
  | { kind: "recorded" }
  /** An engine in a folder named for it has not been checked. Watch checks it,
   *  then runs on it, or opens the download if it is another build. */
  | { kind: "verify" }
  /** It is not installed but can be downloaded. Watch opens the download first
   *  and runs on the engine it installs. */
  | { kind: "download" }
  /** The header names no engine version, so there is nothing to match. Watch
   *  runs on another installed engine, which may not sync, and the page says
   *  so. */
  | { kind: "fallback" }
  /** The recorded engine is not installed and cannot be downloaded here. Watch
   *  is disabled, because a replay must not run on any other engine. */
  | { kind: "unavailable"; version: string }
  /** Still reading. Watch waits. */
  | { kind: "wait" }
  /** No engine can run it. */
  | { kind: "none" };

export function replayEngineDecision(r: ReplayEngineReadings): {
  notice: ReplayEngineNotice;
  watch: ReplayWatch;
} {
  const hasAnyEngine = r.engines.length > 0;
  const fallback: ReplayWatch = hasAnyEngine
    ? { kind: "fallback" }
    : { kind: "none" };
  const recorded = r.recorded.trim();

  // A header with no version gives nothing to match or to download.
  if (recorded === "") return { notice: { kind: "none" }, watch: fallback };

  // What the launch check would conclude, with no verification run yet.
  const conclusion = concludeEngine(
    [replayEngineRequirement(recorded)],
    r.engines,
    [],
  );
  if (conclusion.kind === "installed") {
    return { notice: { kind: "none" }, watch: { kind: "recorded" } };
  }
  // Ahead of the catalogs and the download offer: a folder that may already
  // hold the engine must not send the player to download it.
  if (conclusion.kind === "verify" || conclusion.kind === "unconfirmed") {
    return {
      notice: { kind: "unchecked", version: recorded },
      watch: { kind: "verify" },
    };
  }

  if (r.resolve.loading) {
    return { notice: { kind: "pending" }, watch: { kind: "wait" } };
  }
  if (r.resolve.canDownload) {
    return {
      notice: { kind: "download", version: recorded },
      watch: { kind: "download" },
    };
  }
  return {
    notice: {
      kind: "unavailable",
      version: recorded,
      reason: r.resolve.noWriteRoot ? "no-write-root" : "no-build",
    },
    watch: { kind: "unavailable", version: recorded },
  };
}

/**
 * Why Watch cannot start, when the replay's game is installed but depends on an
 * archive that is not (issue #3489), or null. The same sentence the other launch
 * paths give. The game is matched the way the replay page matches it, so a
 * version-string difference does not hide it.
 */
export function replayDependencyBlock(
  gameType: string,
  games: InstalledContentSnapshot["games"],
): string | null {
  const game = games.find((g) => gameNamesMatch(g.name, gameType));
  if (!game) return null;
  const dependency = missingLaunchDependency(game.name, games);
  return dependency?.gameName
    ? dependencyBlockReason(dependency.label, dependency.gameName)
    : null;
}
