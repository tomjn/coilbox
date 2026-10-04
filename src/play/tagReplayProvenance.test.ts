import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReplayFile } from "../content/bindings";

const ingest = vi.fn();
const emit = vi.fn();
const findNewReplay = vi.fn();
vi.mock("../content/bindings", () => ({
  contentStatsIngest: (args: unknown) => ingest(args),
  STATS_UPDATED_EVENT: "coilbox-content://stats-updated",
}));
vi.mock("@tauri-apps/api/event", () => ({
  emit: (...args: unknown[]) => emit(...args),
}));
vi.mock("./detect", () => ({
  findNewReplay: (...args: unknown[]) => findNewReplay(...args),
}));

import { forgetIngestedReplays } from "./ingestFinishedReplay";
import { tagAndIngestFreshReplay } from "./tagReplayProvenance";

const target = {
  enginePath: "/engine",
  executable: "/engine/spring",
  dataDir: "/data",
  engineVersion: "1",
};
const replay: ReplayFile = {
  filename: "a.sdfz",
  path: "/data/demos/a.sdfz",
  sizeBytes: 1,
  modifiedMs: 1,
};

beforeEach(() => {
  ingest.mockReset();
  emit.mockReset();
  findNewReplay.mockReset();
  forgetIngestedReplays();
  ingest.mockResolvedValue({
    summary: { added: 1, updated: 0, skipped: 0, failed: 0, total: 1 },
    records: [],
  });
});

describe("tagAndIngestFreshReplay", () => {
  it("tags the found replay and ingests it once", async () => {
    findNewReplay.mockResolvedValue(replay);
    const setProvenance = vi.fn();
    await tagAndIngestFreshReplay(
      target,
      new Set(),
      { mode: "multiplayer" },
      setProvenance,
    );
    expect(setProvenance).toHaveBeenCalledWith("a.sdfz", {
      mode: "multiplayer",
    });
    expect(ingest).toHaveBeenCalledTimes(1);
    expect(ingest).toHaveBeenCalledWith({
      roots: ["/data"],
      enginePath: "/engine",
    });
    expect(emit).toHaveBeenCalledTimes(1);
  });

  it("does not ingest when no replay is found", async () => {
    findNewReplay.mockResolvedValue(null);
    await tagAndIngestFreshReplay(
      target,
      new Set(),
      { mode: "multiplayer" },
      vi.fn(),
    );
    expect(ingest).not.toHaveBeenCalled();
  });

  it("does not throw when the ingest fails", async () => {
    findNewReplay.mockResolvedValue(replay);
    ingest.mockRejectedValue(new Error("boom"));
    await expect(
      tagAndIngestFreshReplay(
        target,
        new Set(),
        { mode: "multiplayer" },
        vi.fn(),
      ),
    ).resolves.toBeUndefined();
  });
});
