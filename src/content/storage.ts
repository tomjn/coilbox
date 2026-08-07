/**
 * Which replays a bulk cleanup would take (issue #386). Pure, so the selection
 * rule is unit-testable away from the Storage section that renders it.
 *
 * The three filters combine with AND, because that is the only reading that lets
 * someone say "watched games older than a month" in one go. With no filter on,
 * nothing is selected: an empty filter set meaning "every replay you have" is one
 * misclick away from deleting a player's whole history.
 */

import type { ReplayFile } from "./bindings";
import { isShortReplay } from "./replayFilterVisibility";

/** What the cleanup panel's controls add up to. */
export interface ReplayCleanupFilters {
  /** Only replays last modified more than this many days ago. Null is off. */
  olderThanDays: number | null;
  /** Only replays marked watched in `replayUserState`. */
  watched: boolean;
  /** Only replays shorter than {@link SHORT_REPLAY_SECONDS}. */
  short: boolean;
}

export const NO_CLEANUP_FILTERS: ReplayCleanupFilters = {
  olderThanDays: null,
  watched: false,
  short: false,
};

/** Whether any filter is on. None on means the selection is empty. */
export function hasCleanupFilter(f: ReplayCleanupFilters): boolean {
  return f.olderThanDays != null || f.watched || f.short;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Whether one replay matches every active filter. `isWatched` reads the frontend
 * watched flag, which lives in settings rather than on the file.
 */
export function matchesCleanup(
  replay: ReplayFile,
  filters: ReplayCleanupFilters,
  isWatched: (filename: string) => boolean,
  now: number,
): boolean {
  if (!hasCleanupFilter(filters)) return false;
  if (
    filters.olderThanDays != null &&
    now - replay.modifiedMs < filters.olderThanDays * DAY_MS
  ) {
    return false;
  }
  if (filters.watched && !isWatched(replay.filename)) return false;
  if (filters.short && !isShortReplay(replay.durationSec)) return false;
  return true;
}

/** The matching replays' paths and what they occupy, for the preview and delete. */
export interface ReplayCleanupSelection {
  paths: string[];
  count: number;
  bytes: number;
}

export function selectReplaysForCleanup(
  replays: ReplayFile[],
  filters: ReplayCleanupFilters,
  isWatched: (filename: string) => boolean,
  now: number,
): ReplayCleanupSelection {
  const matched = replays.filter((r) =>
    matchesCleanup(r, filters, isWatched, now),
  );
  return {
    paths: matched.map((r) => r.path),
    count: matched.length,
    bytes: matched.reduce((n, r) => n + r.sizeBytes, 0),
  };
}
