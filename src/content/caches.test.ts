import { describe, expect, it } from "vitest";
import type { CacheReclaimSummary } from "./bindings";
import { isEmpty, nonEmptyCaches, summarizeCaches } from "./caches";

const summary = (over: Partial<CacheReclaimSummary>): CacheReclaimSummary => ({
  applied: false,
  caches: [],
  totalBytes: 0,
  totalFiles: 0,
  ...over,
});

describe("cache reclaim helpers", () => {
  it("treats a zero summary as empty", () => {
    expect(isEmpty(summary({}))).toBe(true);
    expect(isEmpty(summary({ totalBytes: 10, totalFiles: 1 }))).toBe(false);
  });

  it("summarizes empty vs populated, dry-run vs applied", () => {
    expect(summarizeCaches(summary({}))).toMatch(/already empty/);
    expect(summarizeCaches(summary({ totalBytes: 2048, totalFiles: 3 }))).toBe(
      "Can reclaim 3 files (2.0 KB).",
    );
    expect(
      summarizeCaches(
        summary({ applied: true, totalBytes: 1024, totalFiles: 1 }),
      ),
    ).toBe("Cleared 1 file (1.0 KB).");
  });

  it("lists only non-empty caches, largest first", () => {
    const s = summary({
      caches: [
        { name: "a", label: "A", bytes: 100, files: 1 },
        { name: "b", label: "B", bytes: 0, files: 0 },
        { name: "c", label: "C", bytes: 500, files: 2 },
      ],
    });
    expect(nonEmptyCaches(s).map((c) => c.name)).toEqual(["c", "a"]);
  });
});
