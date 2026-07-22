import type { ReplayUserState } from "./replayUserState";

/**
 * Which of the replay library's watched/remixed toggle filters could match
 * at least one row. A filter that can never match anything is noise, so
 * `ReplaysPage` hides its control when this says false. (The tag filter's
 * own visibility is already handled by its options list being empty — see
 * `ReplaysPage`'s `tagOptions`.)
 *
 * Takes the unfiltered (or map/search-scoped, but never toggle-scoped) list
 * so toggling one filter never hides another filter's own control — each
 * flag answers "does at least one row have this property", independent of
 * whatever else is currently active.
 */
export interface ReplayFilterVisibility {
  watched: boolean;
  remixed: boolean;
  short: boolean;
}

/** Replays under this duration are considered "short" for the hide-short filter. */
export const SHORT_REPLAY_SECONDS = 60;

/**
 * Whether a replay counts as "short" for the hide-short filter. A missing
 * duration is never short — an unknown length shouldn't be hidden.
 */
export function isShortReplay(durationSec: number | undefined): boolean {
  return durationSec != null && durationSec < SHORT_REPLAY_SECONDS;
}

export function computeReplayFilterVisibility(
  replays: Array<{
    filename: string;
    remixed?: boolean;
    durationSec?: number;
  }>,
  userStateOf: (filename: string) => ReplayUserState,
): ReplayFilterVisibility {
  let watched = false;
  let remixed = false;
  let short = false;
  for (const r of replays) {
    if (r.remixed) remixed = true;
    if (userStateOf(r.filename).watched) watched = true;
    if (isShortReplay(r.durationSec)) short = true;
    if (watched && remixed && short) break;
  }
  return { watched, remixed, short };
}
