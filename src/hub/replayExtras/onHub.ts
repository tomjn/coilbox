import { useSetting } from "@picoframe/frame";
import {
  readStoredSettingIfInstalled,
  writeStoredSetting,
} from "@/lib/storedSetting";
import type { AnalysisCheck } from "../archiveUploads";

/**
 * What this machine has sent the hub about a match besides its replay, by game
 * id (issue #5495): the analysis it sent and how the hub's check went, and
 * whether the hub has a track of the match. The hub has no route that says
 * either without sending, so the replay page reads this to know what to offer.
 */
export const REPLAY_EXTRAS_ON_HUB_KEY = "hub.replayExtrasOnHub";

export interface AnalysisOnHub {
  /** The version of the logger that wrote the log that was sent. */
  loggerVersion: number;
  state: AnalysisCheck;
  /** Why the check refused it, when it did. */
  reason: string | null;
}

export interface ReplayExtrasOnHub {
  /** The hub it was sent to, as the hub address setting had it. */
  hubUrl: string;
  analysis?: AnalysisOnHub;
  /** The hub has a track of this match, from this machine or another, made
   *  by this recorder version. */
  trackRecorderVersion?: number;
}

export type ReplayExtras = Record<string, ReplayExtrasOnHub>;

const NONE: ReplayExtras = {};

const base = (url: string) => url.replace(/\/+$/, "");

/** Whether the hub's check passed an analysis. */
export function analysisPassed(analysis: AnalysisOnHub | undefined): boolean {
  return (
    analysis?.state === "kept" ||
    analysis?.state === "agreed" ||
    analysis?.state === "older"
  );
}

export function readReplayExtras(): ReplayExtras {
  return readStoredSettingIfInstalled<ReplayExtras>(
    REPLAY_EXTRAS_ON_HUB_KEY,
    NONE,
  );
}

/** The record for one match on this hub, or undefined when none is known. */
export function replayExtrasOn(
  held: ReplayExtras,
  hubUrl: string,
  gameId: string | undefined,
): ReplayExtrasOnHub | undefined {
  if (!gameId) return undefined;
  const record = held[gameId];
  return record && base(record.hubUrl) === base(hubUrl) ? record : undefined;
}

function change(
  gameId: string,
  hubUrl: string,
  patch: Partial<Omit<ReplayExtrasOnHub, "hubUrl">>,
): void {
  const held = readReplayExtras();
  const earlier = replayExtrasOn(held, hubUrl, gameId);
  writeStoredSetting(REPLAY_EXTRAS_ON_HUB_KEY, {
    ...held,
    [gameId]: { ...earlier, hubUrl, ...patch },
  });
}

/** Note what the hub last said about the analysis sent for this match. */
export function rememberAnalysisOnHub(
  gameId: string,
  hubUrl: string,
  analysis: AnalysisOnHub,
): void {
  change(gameId, hubUrl, { analysis });
}

/** Note that this hub has a track of this match from this recorder version. */
export function rememberTrackOnHub(
  gameId: string,
  hubUrl: string,
  recorderVersion: number,
): void {
  change(gameId, hubUrl, { trackRecorderVersion: recorderVersion });
}

/**
 * Whether a recorded track has nothing the hub lacks: the hub is known to have
 * one of this match from the same recorder version or a newer one. The hub takes
 * a newer one in place of the track it has (issue #5525). A stale track is never
 * sent, so any track the hub has covers it.
 */
export function hubHasTrack(
  record: ReplayExtrasOnHub | undefined,
  track: { recorderVersion?: number | null } | null | undefined,
): boolean {
  const theirs = record?.trackRecorderVersion;
  if (theirs === undefined) return false;
  return (track?.recorderVersion ?? 0) <= theirs;
}

/** Everything this machine has sent besides replays, kept current. */
export function useReplayExtras(): ReplayExtras {
  const [held] = useSetting<ReplayExtras>(REPLAY_EXTRAS_ON_HUB_KEY, NONE);
  return held;
}
