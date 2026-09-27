import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createSweptAtTracker, skipSummary } from "./sweepFrame";

type Reason = "ordinary" | "notable";

describe("skipSummary", () => {
  it("is null when nothing was skipped", () => {
    expect(
      skipSummary<Reason>([], ["ordinary", "notable"], {
        ordinary: "for the ordinary reason",
        notable: "for the notable one",
      }),
    ).toBeNull();
  });

  it("counts by reason in the order given, not the order skipped", () => {
    const said = skipSummary<Reason>(
      [
        { reason: "notable" },
        { reason: "ordinary" },
        { reason: "notable" },
      ],
      ["ordinary", "notable"],
      { ordinary: "for the ordinary reason", notable: "for the notable one" },
    );
    expect(said).toBe(
      "3 maps were skipped: 1 for the ordinary reason, 2 for the notable one.",
    );
  });

  it("uses singular wording for one skip", () => {
    const said = skipSummary<Reason>(
      [{ reason: "ordinary" }],
      ["ordinary", "notable"],
      { ordinary: "for the ordinary reason", notable: "for the notable one" },
    );
    expect(said).toBe("1 map was skipped: 1 for the ordinary reason.");
  });
});

/** The node test environment has no `localStorage`, so this is one. */
function installStorage(seed: Record<string, string> = {}) {
  const entries = new Map(Object.entries(seed));
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => {
      entries.set(key, value);
    },
    removeItem: (key: string) => {
      entries.delete(key);
    },
  });
  return entries;
}

describe("createSweptAtTracker", () => {
  beforeEach(() => installStorage());
  afterEach(() => vi.unstubAllGlobals());

  it("reads null for a machine that has never run one", () => {
    const tracker = createSweptAtTracker("some.key");
    expect(tracker.lastSweptAt()).toBeNull();
  });

  it("reads back what it wrote", () => {
    const tracker = createSweptAtTracker("some.key");
    tracker.rememberSweptAt(1_700_000_000_000);
    expect(tracker.lastSweptAt()).toBe(1_700_000_000_000);
  });

  it("keeps two keys apart", () => {
    const a = createSweptAtTracker("a.key");
    const b = createSweptAtTracker("b.key");
    a.rememberSweptAt(1);
    expect(a.lastSweptAt()).toBe(1);
    expect(b.lastSweptAt()).toBeNull();
  });

  it("reads garbage as never run", () => {
    installStorage({ "some.key": "not a number" });
    const tracker = createSweptAtTracker("some.key");
    expect(tracker.lastSweptAt()).toBeNull();
  });

  it("reads zero or negative as never run", () => {
    const tracker = createSweptAtTracker("some.key");
    tracker.rememberSweptAt(0);
    expect(tracker.lastSweptAt()).toBeNull();
  });

  it("reads null when storage is unavailable", () => {
    vi.stubGlobal("localStorage", undefined);
    const tracker = createSweptAtTracker("some.key");
    expect(tracker.lastSweptAt()).toBeNull();
  });

  it("swallows a write when storage is unavailable", () => {
    vi.stubGlobal("localStorage", undefined);
    const tracker = createSweptAtTracker("some.key");
    expect(() => tracker.rememberSweptAt(1)).not.toThrow();
  });
});
