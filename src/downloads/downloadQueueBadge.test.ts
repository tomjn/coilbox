import { describe, expect, it } from "vitest";
import type { DownloadProgress } from "./bindings";
import { badgeSummary } from "./DownloadQueueBadge";
import type { QueueItem } from "./DownloadQueueProvider";
import { type DownloadRate, IDLE_RATE } from "./downloadRate";

function item(opts: {
  progress?: Partial<DownloadProgress> | null;
  rate?: Partial<DownloadRate>;
}): QueueItem {
  return {
    kind: "map",
    label: "Map: Comet Catcher",
    args: { springName: "Comet Catcher Remake 1.8" },
    id: "one",
    identity: "map:Comet Catcher Remake 1.8",
    status: "active",
    progress:
      opts.progress === null || opts.progress === undefined
        ? null
        : {
            phase: "downloading",
            downloadedBytes: 0,
            totalBytes: null,
            percent: null,
            bytesPerSec: null,
            ...opts.progress,
          },
    rate: { ...IDLE_RATE, ...opts.rate },
    startedAt: 1_000_000,
    error: null,
  };
}

describe("badgeSummary", () => {
  it("says nothing when the queue is idle", () => {
    expect(badgeSummary(null)).toBeNull();
  });

  it("says nothing before the download reports any progress", () => {
    expect(badgeSummary(item({ progress: null }))).toBeNull();
  });

  it("prefers time left, which is what the topbar is asked", () => {
    const summary = badgeSummary(
      item({ progress: { percent: 40 }, rate: { secondsLeft: 92 } }),
    );
    expect(summary).toBe("1m 30s left");
  });

  it("falls back to the percentage while the rate has not settled", () => {
    expect(badgeSummary(item({ progress: { percent: 40.4 } }))).toBe("40%");
  });

  it("falls back to the percentage when the download stalls", () => {
    const summary = badgeSummary(
      item({ progress: { percent: 40 }, rate: { stalled: true } }),
    );
    expect(summary).toBe("40%");
  });

  it("gives no number at all when the source reports neither", () => {
    expect(
      badgeSummary(item({ progress: { downloadedBytes: 1024 } })),
    ).toBeNull();
  });
});
