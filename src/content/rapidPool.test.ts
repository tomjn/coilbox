import { describe, expect, it } from "vitest";
import type { PruneSummary } from "./bindings";
import {
  canPrune,
  formatBytes,
  isClean,
  reclaimedBytes,
  summarize,
} from "./rapidPool";

const summary = (over: Partial<PruneSummary> = {}): PruneSummary => ({
  applied: false,
  blobs: 0,
  blobBytes: 0,
  incompletes: 0,
  incompleteBytes: 0,
  unreadableSdp: 0,
  ...over,
});

describe("canPrune", () => {
  it("allows pruning only when nothing is active or queued", () => {
    expect(canPrune(null, 0)).toBe(true);
  });
  it("blocks while a download is active", () => {
    expect(canPrune({ id: "x" }, 0)).toBe(false);
  });
  it("blocks while items are queued", () => {
    expect(canPrune(null, 2)).toBe(false);
  });
});

describe("formatBytes", () => {
  it("formats across units", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(1024 * 1024 * 5)).toBe("5.0 MB");
    expect(formatBytes(1024 * 1024 * 1024 * 20)).toBe("20 GB");
  });
});

describe("summary helpers", () => {
  it("detects a clean pool", () => {
    expect(isClean(summary())).toBe(true);
    expect(summarize(summary())).toMatch(/nothing to reclaim/i);
  });
  it("sums reclaimable bytes and describes a dry run", () => {
    const s = summary({
      blobs: 3,
      blobBytes: 2048,
      incompletes: 1,
      incompleteBytes: 1024,
    });
    expect(reclaimedBytes(s)).toBe(3072);
    expect(isClean(s)).toBe(false);
    expect(summarize(s)).toMatch(
      /can reclaim 3 orphaned blobs \+ 1 partial file/i,
    );
  });
  it("switches verb + singular/plural once applied", () => {
    const s = summary({ applied: true, blobs: 1, blobBytes: 1024 });
    expect(summarize(s)).toMatch(/removed 1 orphaned blob \(1\.0 KB\)/i);
  });
});
