import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReplayFile } from "../content/bindings";

const ingest = vi.fn();
const emit = vi.fn();
vi.mock("../content/bindings", () => ({
  contentStatsIngest: (args: unknown) => ingest(args),
  STATS_UPDATED_EVENT: "coilbox-content://stats-updated",
}));
vi.mock("@tauri-apps/api/event", () => ({
  emit: (...args: unknown[]) => emit(...args),
}));

import {
  forgetIngestedReplays,
  ingestFinishedReplay,
} from "./ingestFinishedReplay";

const target = { dataDir: "/data", enginePath: "/engine" };

function replay(path: string): ReplayFile {
  return { filename: path.split("/").pop() ?? path, path, sizeBytes: 1, modifiedMs: 1 };
}

function summary(over: Partial<Record<string, number>> = {}) {
  return { added: 1, updated: 0, skipped: 4, failed: 0, total: 5, ...over };
}

beforeEach(() => {
  ingest.mockReset();
  emit.mockReset();
  forgetIngestedReplays();
});

describe("ingestFinishedReplay", () => {
  it("ingests the replay's content root once and announces the update", async () => {
    ingest.mockResolvedValue({ summary: summary(), records: [] });
    await ingestFinishedReplay(target, replay("/data/demos/a.sdfz"));
    expect(ingest).toHaveBeenCalledTimes(1);
    expect(ingest).toHaveBeenCalledWith({
      roots: ["/data"],
      enginePath: "/engine",
    });
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith(
      "coilbox-content://stats-updated",
      summary(),
    );
  });

  it("does not ingest the same replay twice", async () => {
    ingest.mockResolvedValue({ summary: summary(), records: [] });
    const r = replay("/data/demos/a.sdfz");
    await ingestFinishedReplay(target, r);
    await ingestFinishedReplay(target, r);
    expect(ingest).toHaveBeenCalledTimes(1);
  });

  it("does not ingest twice when called again while the first is running", async () => {
    let resolve: (v: unknown) => void = () => {};
    ingest.mockReturnValue(new Promise((r) => (resolve = r)));
    const r = replay("/data/demos/a.sdfz");
    const first = ingestFinishedReplay(target, r);
    await ingestFinishedReplay(target, r);
    resolve({ summary: summary(), records: [] });
    await first;
    expect(ingest).toHaveBeenCalledTimes(1);
  });

  it("does not announce an update when nothing was added or changed", async () => {
    ingest.mockResolvedValue({
      summary: summary({ added: 0, updated: 0, skipped: 5 }),
      records: [],
    });
    await ingestFinishedReplay(target, replay("/data/demos/a.sdfz"));
    expect(emit).not.toHaveBeenCalled();
  });

  it("announces an update when a record was updated", async () => {
    ingest.mockResolvedValue({
      summary: summary({ added: 0, updated: 1 }),
      records: [],
    });
    await ingestFinishedReplay(target, replay("/data/demos/a.sdfz"));
    expect(emit).toHaveBeenCalledTimes(1);
  });

  it("swallows an ingest failure and allows a later retry", async () => {
    ingest.mockRejectedValueOnce(new Error("boom"));
    const r = replay("/data/demos/a.sdfz");
    await expect(ingestFinishedReplay(target, r)).resolves.toBeUndefined();
    expect(emit).not.toHaveBeenCalled();
    ingest.mockResolvedValue({ summary: summary(), records: [] });
    await ingestFinishedReplay(target, r);
    expect(ingest).toHaveBeenCalledTimes(2);
  });

  it("swallows a failing event emit", async () => {
    ingest.mockResolvedValue({ summary: summary(), records: [] });
    emit.mockRejectedValue(new Error("no bus"));
    await expect(
      ingestFinishedReplay(target, replay("/data/demos/a.sdfz")),
    ).resolves.toBeUndefined();
  });

  it("does nothing when no replay was found", async () => {
    await ingestFinishedReplay(target, null);
    expect(ingest).not.toHaveBeenCalled();
  });
});
