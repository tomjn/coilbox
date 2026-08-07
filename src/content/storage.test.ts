import { describe, expect, it } from "vitest";
import type { ReplayFile } from "./bindings";
import {
  hasCleanupFilter,
  NO_CLEANUP_FILTERS,
  selectReplaysForCleanup,
} from "./storage";

const NOW = 1_760_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

const replay = (over: Partial<ReplayFile> = {}): ReplayFile => ({
  filename: "a.sdfz",
  path: "/root/demos/a.sdfz",
  sizeBytes: 1000,
  modifiedMs: NOW,
  remixed: false,
  ...over,
});

const watched =
  (...names: string[]) =>
  (f: string) =>
    names.includes(f);
const none = () => false;

describe("hasCleanupFilter", () => {
  it("is off until a filter is set", () => {
    expect(hasCleanupFilter(NO_CLEANUP_FILTERS)).toBe(false);
    expect(hasCleanupFilter({ ...NO_CLEANUP_FILTERS, short: true })).toBe(true);
    expect(hasCleanupFilter({ ...NO_CLEANUP_FILTERS, olderThanDays: 7 })).toBe(
      true,
    );
  });
});

describe("selectReplaysForCleanup", () => {
  it("selects nothing when no filter is on", () => {
    const sel = selectReplaysForCleanup(
      [replay(), replay({ filename: "b.sdfz" })],
      NO_CLEANUP_FILTERS,
      none,
      NOW,
    );
    expect(sel).toEqual({ paths: [], count: 0, bytes: 0 });
  });

  it("takes only replays older than the day count", () => {
    const old = replay({ filename: "old.sdfz", modifiedMs: NOW - 40 * DAY });
    const fresh = replay({ filename: "new.sdfz", modifiedMs: NOW - 2 * DAY });
    const sel = selectReplaysForCleanup(
      [old, fresh],
      { ...NO_CLEANUP_FILTERS, olderThanDays: 30 },
      none,
      NOW,
    );
    expect(sel.count).toBe(1);
    expect(sel.paths).toEqual([old.path]);
  });

  it("takes only short replays, and never one of unknown length", () => {
    const short = replay({ filename: "short.sdfz", durationSec: 30 });
    const long = replay({ filename: "long.sdfz", durationSec: 1800 });
    const unknown = replay({ filename: "unknown.sdfz" });
    const sel = selectReplaysForCleanup(
      [short, long, unknown],
      { ...NO_CLEANUP_FILTERS, short: true },
      none,
      NOW,
    );
    expect(sel.paths).toEqual([short.path]);
  });

  it("combines the filters with AND and sums the bytes", () => {
    const target = replay({
      filename: "target.sdfz",
      durationSec: 20,
      modifiedMs: NOW - 90 * DAY,
      sizeBytes: 2048,
    });
    const shortButUnwatched = replay({
      filename: "other.sdfz",
      durationSec: 20,
      modifiedMs: NOW - 90 * DAY,
    });
    const watchedButLong = replay({
      filename: "epic.sdfz",
      durationSec: 3600,
      modifiedMs: NOW - 90 * DAY,
    });
    const sel = selectReplaysForCleanup(
      [target, shortButUnwatched, watchedButLong],
      { olderThanDays: 30, watched: true, short: true },
      watched("target.sdfz", "epic.sdfz"),
      NOW,
    );
    expect(sel.count).toBe(1);
    expect(sel.bytes).toBe(2048);
    expect(sel.paths).toEqual([target.path]);
  });
});
