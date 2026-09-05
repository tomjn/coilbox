import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createSweptAtTracker } from "./sweepFrame";

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
