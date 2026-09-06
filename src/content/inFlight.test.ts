import { describe, expect, it } from "vitest";
import { shareInFlight } from "./inFlight";

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
