import { beforeEach, describe, expect, it, vi } from "vitest";

const ingest = vi.fn();
const emit = vi.fn();
const listReplays = vi.fn();
const demoInfo = vi.fn();
vi.mock("../content/bindings", () => ({
  contentStatsIngest: (args: unknown) => ingest(args),
  contentListReplays: (args: unknown) => listReplays(args),
  contentDemoInfo: (args: unknown) => demoInfo(args),
  STATS_UPDATED_EVENT: "coilbox-content://stats-updated",
}));
vi.mock("@tauri-apps/api/event", () => ({
  emit: (...args: unknown[]) => emit(...args),
}));

import { detectBattleResult } from "./detect";
import { forgetIngestedReplays } from "./ingestFinishedReplay";

const target = {
  enginePath: "/engine",
  executable: "/engine/spring",
  dataDir: "/data",
  engineVersion: "1",
};
const replay = {
  filename: "a.sdfz",
  path: "/data/demos/a.sdfz",
  sizeBytes: 1,
  modifiedMs: 1,
};

beforeEach(() => {
  ingest.mockReset();
  emit.mockReset();
  listReplays.mockReset();
  demoInfo.mockReset();
  forgetIngestedReplays();
  listReplays.mockResolvedValue({ replays: [replay] });
  demoInfo.mockResolvedValue({
    info: {
      winnersKnown: true,
      players: [{ name: "Me", spectator: false, won: true }],
    },
  });
  ingest.mockResolvedValue({
    summary: { added: 1, updated: 0, skipped: 0, failed: 0, total: 1 },
    records: [],
  });
});

describe("detectBattleResult ingest", () => {
  it("ingests the replay it found and still returns the result", async () => {
    const res = await detectBattleResult({
      target,
      beforePaths: new Set(),
      playerName: "Me",
    });
    expect(res).toEqual({ outcome: "victory", replay });
    expect(ingest).toHaveBeenCalledTimes(1);
    expect(ingest).toHaveBeenCalledWith({
      roots: ["/data"],
      enginePath: "/engine",
    });
  });

  it("returns the result when the ingest fails", async () => {
    ingest.mockRejectedValue(new Error("boom"));
    const res = await detectBattleResult({
      target,
      beforePaths: new Set(),
      playerName: "Me",
    });
    expect(res.outcome).toBe("victory");
  });

  it("does not ingest a replay that was already there", async () => {
    vi.useFakeTimers();
    const p = detectBattleResult({
      target,
      beforePaths: new Set([replay.path]),
      playerName: "Me",
    });
    await vi.runAllTimersAsync();
    expect(await p).toEqual({ outcome: "ambiguous", replay: null });
    vi.useRealTimers();
    expect(ingest).not.toHaveBeenCalled();
  });
});
