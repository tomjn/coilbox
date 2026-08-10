import { describe, expect, it } from "vitest";
import { nextDrawerKey } from "./drawerKey";

describe("nextDrawerKey", () => {
  it("gives a second opening a different key from the first", () => {
    expect(nextDrawerKey()).not.toBe(nextDrawerKey());
  });

  it("never repeats, however many openings a session has", () => {
    const keys = Array.from({ length: 100 }, () => nextDrawerKey());
    expect(new Set(keys).size).toBe(keys.length);
  });
});
