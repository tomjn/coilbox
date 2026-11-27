import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AnalysisAnswer, ArchiveUploadState } from "@/hub/archiveUploads";
import {
  installSettingsStorage,
  memorySettingsStorage,
  writeStoredSetting,
} from "@/lib/storedSetting";

/** The background sender's analysis and track steps (issue #5495). */

vi.mock("@/profile/profile", () => ({
  isHubAssetUploadOffered: () => true,
}));

const GAME_ID = "9f2c4b1ad07e5386c1f4a92b6e8d0375";
let stored: { outcome: string; loggerVersion: number } | null = null;
let track: {
  path: string;
  formatVersion: number;
  recorderVersion: number;
} | null = null;
vi.mock("@/content/bindings", async (actual) => ({
  ...(await actual<typeof import("@/content/bindings")>()),
  contentReplayAnalysis: async () => ({ analysis: stored }),
  contentReplayAnalysisLog: async () => ({
    log:
      stored?.outcome === "reproduced"
        ? { loggerVersion: stored.loggerVersion, events: "{}\n" }
        : null,
  }),
  contentReplayTrackUploadFacts: async () => ({ track }),
}));

const analysed = vi.fn();
const trackStarted = vi.fn();
let announce: (state: ArchiveUploadState) => void = () => {};
vi.mock("@/hub/archiveUploads", () => ({
  sendReplayAnalysis: (...args: unknown[]) => analysed(...args),
  startTrackUpload: (...args: unknown[]) => trackStarted(...args),
  startReplayUpload: async () => {
    throw new Error("no replay is sent here");
  },
  cancelArchiveUpload: async () => {},
  listArchiveUploads: async () => [],
  onArchiveUploadChanged: async (
    handler: (state: ArchiveUploadState) => void,
  ) => {
    announce = handler;
    return () => {};
  },
}));
vi.mock("@/hub/manualSend/run", () => ({ noteHubChanged: () => {} }));
vi.mock("@/hub/manualSend/status", () => ({
  gamePageUrl: () => "",
  mapPageUrl: () => "",
}));
vi.mock("@/hub/maps/lookup", () => ({ fetchMapFacts: async () => ({}) }));
const notified = vi.fn();
vi.mock("@/notify/notify", () => ({
  notify: (input: unknown) => notified(input),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: async () => {} }));

import { readReplayExtras, rememberTrackOnHub } from "@/hub/replayExtras/onHub";
import { rememberReplayOnHub } from "@/hub/replaysOnHub";
import { forgetArchiveUploads } from "@/hub/upload/store";
import {
  AUTO_SEND_REPLAYS_KEY,
  queueReplayExtras,
  readReplayExtrasQueue,
} from "./queue";
import {
  RECHECK_MS,
  RETRY_DELAYS_MS,
  runDueReplaySends,
  type SendContext,
  stopReplaySends,
} from "./runner";

const HUB = "https://hub.test";
let now = 1_000_000;
const context = (patch: Partial<SendContext> = {}): SendContext => ({
  hubUrl: HUB,
  names: ["Alice"],
  account: "in",
  now: () => now,
  ...patch,
});

const sent = (state: string, reason: string | null = null): AnalysisAnswer => ({
  kind: "sent",
  id: 1,
  state: state as never,
  reason,
  again: false,
});

function upload(patch: Partial<ArchiveUploadState> = {}): ArchiveUploadState {
  return {
    opId: "track-op",
    hubUrl: HUB,
    filename: `${GAME_ID}.cbtrack`,
    kind: "track",
    sha256: "d".repeat(64),
    phase: "reserving",
    sent: 0,
    size: 100,
    uploadId: null,
    pageUrl: null,
    heldAlready: false,
    outcome: null,
    ...patch,
  };
}

/** Make the next track start answer, then end as `outcome` says. */
function trackEnds(
  outcome: ArchiveUploadState["outcome"],
  recorderVersion = 5,
) {
  trackStarted.mockImplementationOnce(async () => {
    const first = upload({ recorderVersion });
    setTimeout(() => announce({ ...first, phase: "done", outcome }), 0);
    return first;
  });
}

const queued = () =>
  queueReplayExtras({ gameId: GAME_ID, mapName: "Tabula" }, now);
const onHub = () => rememberReplayOnHub(GAME_ID, { hubUrl: HUB, url: null });

beforeEach(() => {
  now = 1_000_000;
  installSettingsStorage(memorySettingsStorage());
  writeStoredSetting(AUTO_SEND_REPLAYS_KEY, true);
  forgetArchiveUploads();
  stored = { outcome: "reproduced", loggerVersion: 8 };
  track = {
    path: `/data/content/replay-tracks/${GAME_ID}.cbtrack`,
    formatVersion: 1,
    recorderVersion: 5,
  };
  analysed.mockReset();
  trackStarted.mockReset();
  notified.mockClear();
});
afterEach(async () => {
  await stopReplaySends();
  installSettingsStorage(null);
});

describe("sending a match's analysis and track", () => {
  it("waits for the hub to list the replay before sending anything", async () => {
    queued();
    await runDueReplaySends(context());
    expect(analysed).not.toHaveBeenCalled();
    expect(readReplayExtrasQueue()).toHaveLength(1);
  });

  it("waits for a sign-in", async () => {
    onHub();
    queued();
    await runDueReplaySends(context({ account: "out" }));
    expect(analysed).not.toHaveBeenCalled();
    expect(readReplayExtrasQueue()).toHaveLength(1);
  });

  it("sends the analysis, asks again while the hub checks it, then sends the track", async () => {
    onHub();
    queued();
    analysed.mockResolvedValueOnce(sent("checking"));
    await runDueReplaySends(context());
    expect(analysed).toHaveBeenCalledWith(HUB, GAME_ID, 8, "{}\n", undefined);
    expect(trackStarted).not.toHaveBeenCalled();
    expect(readReplayExtrasQueue()[0]).toMatchObject({
      attempts: 0,
      notBefore: now + RECHECK_MS,
    });

    now += RECHECK_MS;
    analysed.mockResolvedValueOnce({ ...sent("kept"), again: true });
    trackEnds({ kind: "listed" });
    await runDueReplaySends(context());
    expect(analysed).toHaveBeenCalledTimes(2);
    expect(trackStarted).toHaveBeenCalledWith(
      HUB,
      GAME_ID,
      track?.path,
      1,
      5,
      undefined,
    );
    expect(readReplayExtras()[GAME_ID]).toEqual({
      hubUrl: HUB,
      analysis: { loggerVersion: 8, state: "kept", reason: null },
      trackRecorderVersion: 5,
    });
    expect(readReplayExtrasQueue()).toEqual([]);
    expect(notified).not.toHaveBeenCalled();
  });

  it("does not send the analysis again once the hub has passed it", async () => {
    onHub();
    queued();
    analysed.mockResolvedValueOnce(sent("agreed"));
    track = null;
    await runDueReplaySends(context());
    expect(readReplayExtrasQueue()).toEqual([]);

    track = { path: "/t", formatVersion: 1, recorderVersion: 5 };
    trackEnds({ kind: "listed" });
    queued();
    await runDueReplaySends(context());
    expect(analysed).toHaveBeenCalledTimes(1);
    expect(trackStarted).toHaveBeenCalledTimes(1);
  });

  it("sends a newer recorder's track in place of the one the hub has (#5525)", async () => {
    onHub();
    rememberTrackOnHub(GAME_ID, HUB, 4);
    analysed.mockResolvedValueOnce(sent("kept"));
    trackEnds({ kind: "listed" });
    queued();
    await runDueReplaySends(context());
    expect(trackStarted).toHaveBeenCalledTimes(1);
    expect(readReplayExtras()[GAME_ID]?.trackRecorderVersion).toBe(5);

    queued();
    await runDueReplaySends(context());
    expect(trackStarted).toHaveBeenCalledTimes(1);
  });

  it("stops quietly when the hub cannot replace its older track yet (#5525)", async () => {
    onHub();
    queued();
    analysed.mockResolvedValueOnce(sent("kept"));
    trackEnds({
      kind: "stopped",
      source: "hub",
      code: "older_kept",
      status: 200,
      said: "said",
    });
    await runDueReplaySends(context());
    expect(readReplayExtrasQueue()).toEqual([]);
    expect(readReplayExtras()[GAME_ID]?.trackRecorderVersion).toBeUndefined();
    expect(notified).not.toHaveBeenCalled();
  });

  it("never sends a run that diverged", async () => {
    onHub();
    stored = { outcome: "diverged", loggerVersion: 8 };
    queued();
    await runDueReplaySends(context());
    expect(analysed).not.toHaveBeenCalled();
    expect(trackStarted).not.toHaveBeenCalled();
    expect(readReplayExtrasQueue()).toEqual([]);
  });

  it("says so and sends no track when the hub refuses the analysis", async () => {
    onHub();
    queued();
    analysed.mockResolvedValueOnce(sent("refused", "total_mismatch"));
    await runDueReplaySends(context());
    expect(trackStarted).not.toHaveBeenCalled();
    expect(readReplayExtrasQueue()).toEqual([]);
    expect(notified).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "The analysis of the match on Tabula was not sent",
        level: "error",
      }),
    );
  });

  it("tries again later when the hub does not list the replay yet", async () => {
    onHub();
    queued();
    analysed.mockResolvedValueOnce({
      kind: "stopped",
      source: "hub",
      code: "not_listed",
      status: 404,
      said: "said",
    });
    await runDueReplaySends(context());
    expect(readReplayExtrasQueue()[0]).toMatchObject({
      attempts: 1,
      notBefore: now + RETRY_DELAYS_MS[0],
    });
    expect(notified).not.toHaveBeenCalled();
  });

  it.each([
    "no_analysis",
    "uploading",
  ])("tries the track again later on %s, and says nothing yet", async (code) => {
    onHub();
    queued();
    analysed.mockResolvedValueOnce(sent("kept"));
    trackEnds({
      kind: "stopped",
      source: "hub",
      code,
      status: 409,
      said: "said",
    });
    await runDueReplaySends(context());
    expect(readReplayExtrasQueue()[0]).toMatchObject({
      attempts: 1,
      notBefore: now + RETRY_DELAYS_MS[0],
    });
    expect(readReplayExtras()[GAME_ID]?.trackRecorderVersion).toBeUndefined();
    expect(notified).not.toHaveBeenCalled();
  });

  it("gives up on a track the hub will not take", async () => {
    onHub();
    queued();
    analysed.mockResolvedValueOnce(sent("kept"));
    trackEnds({
      kind: "stopped",
      source: "hub",
      code: "unknown_format",
      status: 422,
      said: "said",
    });
    await runDueReplaySends(context());
    expect(readReplayExtrasQueue()).toEqual([]);
    expect(notified).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "The track of the match on Tabula was not sent",
        body: "The hub does not take tracks in this format.",
      }),
    );
  });
});
