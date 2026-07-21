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
}

export function computeReplayFilterVisibility(
  replays: Array<{ filename: string; remixed?: boolean }>,
  userStateOf: (filename: string) => ReplayUserState,
): ReplayFilterVisibility {
  let watched = false;
  let remixed = false;
  for (const r of replays) {
    if (r.remixed) remixed = true;
    if (userStateOf(r.filename).watched) watched = true;
    if (watched && remixed) break;
  }
  return { watched, remixed };
}
