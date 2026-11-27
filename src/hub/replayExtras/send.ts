import {
  contentReplayAnalysisLog,
  contentReplayTrackUploadFacts,
} from "@/content/bindings";
import {
  type AnalysisAnswer,
  type ArchiveUploadState,
  sendReplayAnalysis,
  startTrackUpload,
} from "../archiveUploads";
import { rememberUpload } from "../upload/store";
import { rememberAnalysisOnHub } from "./onHub";

/**
 * Sending a match's analysis and track to the hub once the hub lists its
 * replay (issue #5495). The replay page and the background sender both go
 * through these.
 */

/** How often a page asks again about an analysis the hub is checking. A
 *  choice: the hub checks one with a queued job and does not say how long it
 *  takes. */
export const ANALYSIS_RECHECK_MS = 10_000;

export type AnalysisSent = AnalysisAnswer | { kind: "none" };

/**
 * Send the stored analysis of this match, and note what the hub said. `none`
 * is a match with no analysis that reproduced it, which is never sent.
 */
export async function sendStoredAnalysis(
  hubUrl: string,
  gameId: string,
  grant?: string,
): Promise<AnalysisSent> {
  const { log } = await contentReplayAnalysisLog({ gameId });
  if (!log) return { kind: "none" };
  const answer = await sendReplayAnalysis(
    hubUrl,
    gameId,
    log.loggerVersion,
    log.events,
    grant,
  );
  if (answer.kind === "sent") {
    rememberAnalysisOnHub(gameId, hubUrl, {
      loggerVersion: log.loggerVersion,
      state: answer.state,
      reason: answer.reason,
    });
  }
  return answer;
}

/**
 * Start sending the stored track of this match. Null when it has no current
 * track. The upload is followed in `../upload/store.ts`.
 */
export async function startStoredTrack(
  hubUrl: string,
  gameId: string,
  label: string,
  grant?: string,
): Promise<ArchiveUploadState | null> {
  const { track } = await contentReplayTrackUploadFacts({ gameId });
  if (!track) return null;
  const upload = await startTrackUpload(
    hubUrl,
    gameId,
    track.path,
    track.formatVersion,
    grant,
  );
  rememberUpload(upload, { kind: "track", label, gameId });
  return upload;
}

/** The file name a track upload goes by, which is how a page finds it. */
export const trackFilename = (gameId: string) => `${gameId}.cbtrack`;
