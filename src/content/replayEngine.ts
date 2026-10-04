/**
 * What the replay page offers for the engine a replay was recorded on, and what
 * its Watch button does about it (issue #3370).
 *
 * A replay only plays back on the engine version that recorded it. Pure, so the
 * decision is tested without React. The version comparison is
 * `compareEngineVersions`, the one `useReplayTarget` already picks an engine
 * with, so "installed" here and "the engine Watch launches" cannot disagree.
 */

import { compareEngineVersions } from "./engineVersion";
import type { ContentRequirement } from "./resolveContent";

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
  /** The version each installed engine reports. */
  installedVersions: string[];
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
  /** It is not installed but can be downloaded. Watch opens the download first
   *  and runs on the engine it installs. */
  | { kind: "download" }
  /** It cannot be had. Watch runs on another installed engine, which may not
   *  sync, and the page says so. */
  | { kind: "fallback" }
  /** Still reading. Watch waits. */
  | { kind: "wait" }
  /** No engine can run it. */
  | { kind: "none" };

export function replayEngineDecision(r: ReplayEngineReadings): {
  notice: ReplayEngineNotice;
  watch: ReplayWatch;
} {
  const hasAnyEngine = r.installedVersions.length > 0;
  const fallback: ReplayWatch = hasAnyEngine
    ? { kind: "fallback" }
    : { kind: "none" };
  const recorded = r.recorded.trim();

  // A header with no version gives nothing to match or to download.
  if (recorded === "") return { notice: { kind: "none" }, watch: fallback };

  const installed = replayEngineRequirement(recorded).isInstalled({
    games: [],
    maps: [],
    engineVersions: r.installedVersions,
  });
  if (installed) {
    return { notice: { kind: "none" }, watch: { kind: "recorded" } };
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
    watch: fallback,
  };
}
