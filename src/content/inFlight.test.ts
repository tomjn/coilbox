import { afterEach, describe, expect, it, vi } from "vitest";
import { settleWithin, shareInFlight } from "./inFlight";

/** A promise settled by hand, so a test can hold a read open. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (why: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("shareInFlight", () => {
  it("starts one read for two callers asking while it is open", async () => {
    const pending = new Map<string, Promise<number>>();
    const read = deferred<number>();
    let started = 0;
    const start = () => {
      started++;
      return read.promise;
    };
    const first = shareInFlight(pending, "k", start);
    const second = shareInFlight(pending, "k", start);
    expect(started).toBe(1);
    read.resolve(7);
    expect(await first).toBe(7);
    expect(await second).toBe(7);
  });

  it("starts again once the read has settled", async () => {
    const pending = new Map<string, Promise<number>>();
    let started = 0;
    const start = () => Promise.resolve(++started);
    expect(await shareInFlight(pending, "k", start)).toBe(1);
    expect(await shareInFlight(pending, "k", start)).toBe(2);
    expect(pending.size).toBe(0);
  });

  it("forgets a read that failed, so a retry runs it again", async () => {
    const pending = new Map<string, Promise<number>>();
    let started = 0;
    const start = () =>
      ++started === 1 ? Promise.reject(new Error("no")) : Promise.resolve(2);
    await expect(shareInFlight(pending, "k", start)).rejects.toThrow("no");
    expect(pending.size).toBe(0);
    expect(await shareInFlight(pending, "k", start)).toBe(2);
  });

  it("keeps different keys apart", () => {
    const pending = new Map<string, Promise<number>>();
    let started = 0;
    const start = () => {
      started++;
      return new Promise<number>(() => {});
    };
    shareInFlight(pending, "a", start);
    shareInFlight(pending, "b", start);
    expect(started).toBe(2);
  });
});

describe("settleWithin", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("passes a read through that settles in time", async () => {
    vi.useFakeTimers();
    const read = settleWithin(Promise.resolve(3), 1000, "too slow");
    expect(await read).toBe(3);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects with the message once the time is up", async () => {
    vi.useFakeTimers();
    const read = settleWithin(new Promise<number>(() => {}), 1000, "too slow");
    vi.advanceTimersByTime(999);
    let settled = false;
    read
      .catch(() => {})
      .finally(() => {
        settled = true;
      });
    await Promise.resolve();
    expect(settled).toBe(false);
    vi.advanceTimersByTime(1);
    await expect(read).rejects.toThrow("too slow");
  });

  // The lost read of issue #1916: without a bound, the retry was handed the
  // same promise that never settles, so it could never succeed.
  it("lets a shared read that never settles end, so a retry starts afresh", async () => {
    vi.useFakeTimers();
    const pending = new Map<string, Promise<number>>();
    let started = 0;
    const start = () =>
      settleWithin(
        ++started === 1 ? new Promise<number>(() => {}) : Promise.resolve(5),
        1000,
        "too slow",
      );
    const first = shareInFlight(pending, "k", start);
    expect(shareInFlight(pending, "k", start)).toBe(first);
    vi.advanceTimersByTime(1000);
    await expect(first).rejects.toThrow("too slow");
    expect(pending.size).toBe(0);
    expect(await shareInFlight(pending, "k", start)).toBe(5);
    expect(started).toBe(2);
  });
});
