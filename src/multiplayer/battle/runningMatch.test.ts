import { describe, expect, it } from "vitest";
import { lateWatchWarning, startedAgo } from "./runningMatch";

const NOW = 1_791_028_800_000;
const MINUTE = 60_000;

describe("startedAgo", () => {
  it("says how long ago a match with a known start began", () => {
    expect(startedAgo(NOW - 12 * MINUTE, NOW)).toBe("Started 12m ago");
  });

  it("says a match that began seconds ago has just started", () => {
    expect(startedAgo(NOW - 10_000, NOW)).toBe("Started just now");
  });

  it("reads a start ahead of this clock as just now", () => {
    expect(startedAgo(NOW + 3 * MINUTE, NOW)).toBe("Started just now");
  });

  it("gives no number when nothing says when the match began", () => {
    expect(startedAgo(null, NOW)).toBe("In progress");
  });
});

describe("lateWatchWarning", () => {
  it("lets a match that has just started be watched without a word", () => {
    expect(lateWatchWarning(NOW - 9 * MINUTE, NOW)).toBeNull();
  });

  it("warns from ten minutes in and says how far in the match is", () => {
    expect(lateWatchWarning(NOW - 10 * MINUTE, NOW)).toContain(
      "started 10m ago",
    );
    expect(lateWatchWarning(NOW - 40 * MINUTE, NOW)).toContain(
      "started 40m ago",
    );
  });

  it("warns when the start is unknown, and says that it is", () => {
    expect(lateWatchWarning(null, NOW)).toContain(
      "already running when you connected",
    );
  });
});
