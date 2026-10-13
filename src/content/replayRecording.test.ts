/**
 * Asking for a recording of a replay, and reading a replay's recording job out
 * of the queue (#3785).
 *
 * `requestRecording` is the one call that reaches the enqueue command for a
 * recording, so it is shown to refuse, without the command being called, in a
 * distribution that hides `analytics.run`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const called: { command: string; args: unknown }[] = [];
let reply: unknown = {};
vi.mock("@picoframe/plugin-sdk", () => ({
  defineCommand:
    (_plugin: string, command: string) => async (args: unknown) => {
      called.push({ command, args });
      if (command === "content_recording_enqueue") return reply;
      if (command === "content_replay_tracks") return { tracks: [] };
      if (command === "content_replay_analyses") return { analyses: [] };
      return {};
    },
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: async () => () => {},
}));

let HIDE: string[] = [];
vi.mock("../profile/profile", async (orig) => ({
  ...(await orig<typeof import("../profile/profile")>()),
  getProfile: () => ({ version: 1, hide: HIDE }),
}));

import type {
  ReplayAnalysisFailure,
  ReplayAnalysisQueue,
  ReplayAnalysisQueuedJob,
  ReplayAnalysisRunningJob,
} from "./bindings";
import {
  type RecordingJobState,
  recordingJobState,
  requestRecording,
} from "./replayRecording";

const ID = "a".repeat(32);
const OTHER = "b".repeat(32);
const ARGS = {
  replayPath: "/replays/a.sdfz",
  enginePath: "/engines/1",
  dataDir: "/data",
};

function queue(over: Partial<ReplayAnalysisQueue> = {}): ReplayAnalysisQueue {
  return {
    running: null,
    queued: [],
    waitingForGame: false,
    failures: [],
    stored: 0,
    tracks: 0,
    ...over,
  };
}

function running(
  over: Partial<ReplayAnalysisRunningJob> = {},
): ReplayAnalysisRunningJob {
  return {
    id: 1,
    gameId: ID,
    name: "a.sdfz",
    replayPath: "/replays/a.sdfz",
    matchSeconds: 100,
    startedAtMs: 0,
    phase: "playing",
    frame: 1500,
    lastFrame: 3000,
    cancelling: false,
    record: true,
    ...over,
  };
}

function queued(
  over: Partial<ReplayAnalysisQueuedJob> = {},
): ReplayAnalysisQueuedJob {
  return {
    id: 2,
    gameId: ID,
    name: "a.sdfz",
    replayPath: "/replays/a.sdfz",
    record: true,
    ...over,
  };
}

function failure(
  over: Partial<ReplayAnalysisFailure> = {},
): ReplayAnalysisFailure {
  return {
    gameId: ID,
    name: "a.sdfz",
    reason: "engineFailed",
    message: "the engine stopped",
    logExcerpt: [],
    record: true,
    disagreements: [],
    ...over,
  };
}

beforeEach(() => {
  called.length = 0;
  HIDE = [];
  reply = {
    outcome: "queued",
    queue: queue({ tracks: 0 }),
  };
});

describe("asking for a recording", () => {
  it("calls the recording command with the replay, engine and data folder", async () => {
    await expect(requestRecording({ ...ARGS, force: true })).resolves.toBe(
      "queued",
    );

    const asked = called.filter(
      (c) => c.command === "content_recording_enqueue",
    );
    expect(asked).toHaveLength(1);
    expect(asked[0].args).toEqual({ ...ARGS, force: true });
  });

  it("refuses, and never reaches the command, when the distribution hides the run", async () => {
    HIDE = ["analytics.run"];

    await expect(requestRecording(ARGS)).rejects.toThrow(/turned off/);

    expect(called).toEqual([]);
  });

  it("asks for the tracks again when a queue says one was stored", async () => {
    reply = { outcome: "queued", queue: queue({ tracks: 1 }) };

    await requestRecording(ARGS);

    await vi.waitFor(() =>
      expect(called.map((c) => c.command)).toContain("content_replay_tracks"),
    );
  });
});

describe("a replay's recording job", () => {
  const state = (q: ReplayAnalysisQueue, id = ID): RecordingJobState =>
    recordingJobState(q, id);

  it("is idle when the queue has nothing for it", () => {
    expect(state(queue())).toEqual({ state: "idle" });
    expect(state(queue({ running: running({ gameId: OTHER }) }))).toEqual({
      state: "idle",
    });
  });

  it("is idle for an analysis that does not record, which is not its job", () => {
    expect(state(queue({ running: running({ record: false }) }))).toEqual({
      state: "idle",
    });
    expect(state(queue({ queued: [queued({ record: false })] }))).toEqual({
      state: "idle",
    });
  });

  it("says how many jobs are ahead of a queued recording, and whether a game holds the queue", () => {
    const ahead = queued({ id: 3, gameId: OTHER, record: false });
    expect(
      state(queue({ queued: [ahead, queued()], waitingForGame: true })),
    ).toEqual({ state: "queued", id: 2, ahead: 1, waitingForGame: true });
    // A job already running is ahead of it too.
    expect(
      state(queue({ running: running({ gameId: OTHER }), queued: [queued()] })),
    ).toEqual({ state: "queued", id: 2, ahead: 1, waitingForGame: false });
  });

  it("carries the frame of a recording that is playing, as a share of the match", () => {
    expect(state(queue({ running: running() }))).toEqual({
      state: "recording",
      id: 1,
      phase: "playing",
      frame: 1500,
      lastFrame: 3000,
      percent: 50,
      cancelling: false,
    });
    expect(
      state(queue({ running: running({ phase: "loading", frame: 0 }) })),
    ).toMatchObject({ state: "recording", phase: "loading", percent: 0 });
  });

  it("is thinning once the engine has exited, and has no percent to claim", () => {
    expect(
      state(
        queue({ running: running({ phase: "thinning", cancelling: true }) }),
      ),
    ).toEqual({ state: "thinning", id: 1, cancelling: true });
  });

  it("carries the figures that disagreed for a diverged run", () => {
    const disagreements = [
      {
        figure: "metalProduced",
        team: 0,
        recorded: "1500",
        observed: "1750",
        difference: 250,
      },
    ];
    expect(
      state(
        queue({
          failures: [
            failure({
              reason: "diverged",
              message: "the playback did not reproduce the recorded match",
              disagreements,
            }),
          ],
        }),
      ),
    ).toEqual({
      state: "diverged",
      message: "the playback did not reproduce the recorded match",
      disagreements,
      logExcerpt: [],
    });
  });

  it("carries the end of the engine's log for a run that failed", () => {
    expect(
      state(
        queue({
          failures: [
            failure({
              reason: "engineFailed",
              message: "the engine exited with status 3 before the match ended",
              logExcerpt: ["Fatal: out of memory"],
            }),
          ],
        }),
      ),
    ).toEqual({
      state: "failed",
      reason: "engineFailed",
      message: "the engine exited with status 3 before the match ended",
      logExcerpt: ["Fatal: out of memory"],
    });
  });

  it("leaves the failure of an analysis alone", () => {
    expect(state(queue({ failures: [failure({ record: false })] }))).toEqual({
      state: "idle",
    });
  });

  it("puts a running job before an old failure of the same replay", () => {
    expect(
      state(queue({ running: running(), failures: [failure()] })).state,
    ).toBe("recording");
  });
});
