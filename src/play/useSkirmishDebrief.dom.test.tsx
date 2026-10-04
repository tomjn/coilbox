// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReplayFile } from "../content/bindings";

const ingest = vi.fn();
const demoInfo = vi.fn();
const tagFresh = vi.fn();
const emit = vi.fn();
vi.mock("../content/bindings", () => ({
  contentStatsIngest: (args: unknown) => ingest(args),
  contentDemoInfo: (args: unknown) => demoInfo(args),
  STATS_UPDATED_EVENT: "coilbox-content://stats-updated",
}));
vi.mock("@tauri-apps/api/event", () => ({
  emit: (...args: unknown[]) => emit(...args),
}));
vi.mock("./tagReplayProvenance", () => ({
  tagFreshReplay: (...args: unknown[]) => tagFresh(...args),
}));

import { forgetIngestedReplays } from "./ingestFinishedReplay";
import { useSkirmishDebrief } from "./useSkirmishDebrief";

const replay: ReplayFile = {
  filename: "a.sdfz",
  path: "/data/demos/a.sdfz",
  sizeBytes: 1,
  modifiedMs: 1,
};

const info = {
  winnersKnown: true,
  durationSec: 600,
  players: [{ name: "Me", spectator: false, won: true }],
};

function opts() {
  return {
    target: {
      enginePath: "/engine",
      executable: "/engine/spring",
      dataDir: "/data",
      engineVersion: "1",
    },
    beforePaths: new Set<string>(),
    playerName: "Me",
    setProvenance: vi.fn(),
    preset: null,
    recordResult: vi.fn(),
  };
}

const summary = { added: 1, updated: 0, skipped: 0, failed: 0, total: 1 };

beforeEach(() => {
  ingest.mockReset();
  demoInfo.mockReset();
  tagFresh.mockReset();
  emit.mockReset();
  forgetIngestedReplays();
  tagFresh.mockResolvedValue(replay);
  demoInfo.mockResolvedValue({ info });
  ingest.mockResolvedValue({ summary, records: [] });
});

afterEach(cleanup);

describe("useSkirmishDebrief ingest at game end", () => {
  it("ingests the found replay's root once and announces the update", async () => {
    const { result } = renderHook(() => useSkirmishDebrief());
    await act(() => result.current.resolve(opts()));
    expect(ingest).toHaveBeenCalledTimes(1);
    expect(ingest).toHaveBeenCalledWith({
      roots: ["/data"],
      enginePath: "/engine",
    });
    expect(emit).toHaveBeenCalledTimes(1);
  });

  it("shows the debrief without waiting for the ingest", async () => {
    ingest.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useSkirmishDebrief());
    await act(() => result.current.resolve(opts()));
    expect(result.current.open).toBe(true);
    expect(result.current.debrief?.replayFilename).toBe("a.sdfz");
    expect(result.current.checking).toBe(false);
  });

  it("does not ingest again when the same replay is resolved twice", async () => {
    const { result } = renderHook(() => useSkirmishDebrief());
    await act(() => result.current.resolve(opts()));
    await act(() => result.current.resolve(opts()));
    expect(ingest).toHaveBeenCalledTimes(1);
  });

  it("leaves the debrief intact when the ingest fails", async () => {
    ingest.mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useSkirmishDebrief());
    await act(() => result.current.resolve(opts()));
    expect(result.current.open).toBe(true);
    expect(result.current.debrief?.outcome).toBe("victory");
    expect(emit).not.toHaveBeenCalled();
  });

  it("does not ingest when no replay was found", async () => {
    tagFresh.mockResolvedValue(null);
    const { result } = renderHook(() => useSkirmishDebrief());
    await act(() => result.current.resolve(opts()));
    expect(result.current.open).toBe(true);
    expect(ingest).not.toHaveBeenCalled();
  });
});
