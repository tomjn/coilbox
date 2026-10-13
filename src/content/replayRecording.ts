import { isProfileHidden } from "../profile/hidden";
import {
  contentRecordingEnqueue,
  type ReplayAnalysisFailure,
  type ReplayAnalysisQueue,
  type ReplayDisagreement,
} from "./bindings";
import {
  acceptQueue,
  analysisPercent,
  useAnalysisQueue,
} from "./replayAnalysis";

/**
 * Recording a replay as a track (#3785), for the replay page's button to call
 * (#3788).
 *
 * A recording is a job in the analysis queue, so its state is read from that
 * queue. {@link useRecordingJob} follows one replay's job, and
 * {@link requestRecording} asks for one. To cancel, use `cancelAnalysis` with
 * the `id` the state carries. When a run stores a track the queue's `tracks`
 * counter moves and `refreshStoredTracks` is called, so `useStoredTracks`
 * follows without the caller doing anything.
 *
 * A recording runs the engine, so it is gated by `analytics.run` like an
 * analysis is.
 */

/** Where one replay stands with its recording. */
export type RecordingJobState =
  /** No recording job for it, queued, running or remembered. */
  | { state: "idle" }
  /** Waiting its turn. `ahead` counts the jobs that will run first. */
  | {
      state: "queued";
      id: number;
      ahead: number;
      waitingForGame: boolean;
    }
  /**
   * The engine is playing the match with the recorder in it. `percent` is
   * from the frame the run reports against the replay's last frame, and is 0
   * until the match begins.
   */
  | {
      state: "recording";
      id: number;
      phase: "starting" | "loading" | "playing";
      frame: number;
      lastFrame: number;
      percent: number;
      cancelling: boolean;
    }
  /** The engine has exited and the track is being made. No progress. */
  | { state: "thinning"; id: number; cancelling: boolean }
  /**
   * The playback did not reproduce the match, so no track was made. The
   * analysis from the same run is stored as diverged.
   */
  | {
      state: "diverged";
      message: string;
      disagreements: ReplayDisagreement[];
      logExcerpt: string[];
    }
  /**
   * The run ended with no track for another reason. `logExcerpt` is the end of
   * the engine's log.
   */
  | {
      state: "failed";
      reason: ReplayAnalysisFailure["reason"];
      message: string;
      logExcerpt: string[];
    };

/**
 * One replay's recording job in a queue. A job that does not record is not
 * this replay's recording, so an analysis in progress reads as idle. A job
 * that is running or waiting outranks a failure left from an earlier run.
 */
export function recordingJobState(
  queue: ReplayAnalysisQueue,
  gameId: string | undefined,
): RecordingJobState {
  if (!gameId) return { state: "idle" };
  const running = queue.running;
  if (running?.gameId === gameId && running.record) {
    if (running.phase === "thinning") {
      return {
        state: "thinning",
        id: running.id,
        cancelling: running.cancelling,
      };
    }
    return {
      state: "recording",
      id: running.id,
      phase: running.phase,
      frame: running.frame,
      lastFrame: running.lastFrame,
      percent: analysisPercent(running),
      cancelling: running.cancelling,
    };
  }
  const at = queue.queued.findIndex(
    (job) => job.gameId === gameId && job.record,
  );
  if (at >= 0) {
    return {
      state: "queued",
      id: queue.queued[at].id,
      ahead: at + (running ? 1 : 0),
      waitingForGame: queue.waitingForGame,
    };
  }
  const failure = queue.failures.find((f) => f.gameId === gameId && f.record);
  if (!failure) return { state: "idle" };
  if (failure.reason === "diverged") {
    return {
      state: "diverged",
      message: failure.message,
      disagreements: failure.disagreements,
      logExcerpt: failure.logExcerpt,
    };
  }
  return {
    state: "failed",
    reason: failure.reason,
    message: failure.message,
    logExcerpt: failure.logExcerpt,
  };
}

/** One replay's recording job, kept current. Idle for a replay with no key. */
export function useRecordingJob(gameId: string | undefined): RecordingJobState {
  return recordingJobState(useAnalysisQueue(), gameId);
}

/**
 * Ask for a replay to be recorded. The one place the recording command is
 * called, and it refuses when the distribution hides the run. Call it only from
 * a press of the button for that replay. Arguments are those of
 * `requestAnalysis`, and `force` asks for a new track over a current one.
 *
 * Answers `queued`, `joined` (the replay was waiting as an analysis and is now
 * a recording too), `alreadyQueued` or `alreadyRecorded`.
 */
export async function requestRecording(args: {
  replayPath: string;
  enginePath: string;
  dataDir: string;
  /** Another installed version of the replay's game, in place of its own. */
  game?: string;
  force?: boolean;
}): Promise<"queued" | "joined" | "alreadyQueued" | "alreadyRecorded"> {
  if (isProfileHidden("analytics.run")) {
    throw new Error("Replay analysis is turned off in this distribution.");
  }
  const { outcome, queue } = await contentRecordingEnqueue(args);
  acceptQueue(queue);
  return outcome;
}
