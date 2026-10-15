import type { StoredReplayAnalysis, StoredReplayTrack } from "./bindings";

/**
 * What Watch with rewind does for a replay (#3803), worked out from the same
 * facts the analysis and recording section reads, so the two cannot disagree.
 *
 * - `ready`: the track is current, so the button opens the playback game.
 * - `recording`: the replay is being recorded or is queued.
 * - `diverged`: the playback did not reproduce the match, so there is no track
 *   and a run will not make one on the same engine and game.
 * - `record`: there is no current track and one can be made. `why` says which
 *   of the three it is, for the words.
 * - `unavailable`: no track, and none can be made now. `reason` says why.
 */
export type RewindOffer =
  | { kind: "ready" }
  | { kind: "recording" }
  | { kind: "diverged" }
  | { kind: "record"; why: "none" | "stale" | "failed" }
  | { kind: "unavailable"; reason: string };

export function rewindOffer(facts: {
  track: StoredReplayTrack | undefined;
  stored: StoredReplayAnalysis | undefined;
  /** The replay's job is running or queued. */
  busy: boolean;
  /** The last run of this replay failed this session. */
  failed: boolean;
  /** The first reason a run cannot be asked for now, or null. */
  recordBlocker: string | null;
}): RewindOffer {
  if (facts.track?.state === "current") return { kind: "ready" };
  if (facts.busy) return { kind: "recording" };
  if (facts.stored?.state === "diverged") return { kind: "diverged" };
  if (facts.recordBlocker) {
    return { kind: "unavailable", reason: facts.recordBlocker };
  }
  if (facts.failed) return { kind: "record", why: "failed" };
  if (facts.track) return { kind: "record", why: "stale" };
  return { kind: "record", why: "none" };
}
