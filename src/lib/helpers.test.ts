import { describe, expect, it, vi } from "vitest";
import { basename, clamp, sleep } from "./helpers";

describe("clamp", () => {
  it("passes a value already inside the range through unchanged", () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });

  it("raises a value below lo up to lo", () => {
    expect(clamp(-5, 0, 10)).toBe(0);
  });

  it("lowers a value above hi down to hi", () => {
    expect(clamp(15, 0, 10)).toBe(10);
  });

  it("passes a value on either boundary through unchanged", () => {
    expect(clamp(0, 0, 10)).toBe(0);
    expect(clamp(10, 0, 10)).toBe(10);
  });

  it("resolves a reversed lo/hi to hi, matching every copy it replaces", () => {
    expect(clamp(5, 10, 0)).toBe(0);
  });

  it("propagates NaN rather than clamping it to a boundary", () => {
    expect(clamp(Number.NaN, 0, 10)).toBeNaN();
  });
});

describe("sleep", () => {
  it("resolves once the given delay has elapsed", async () => {
    vi.useFakeTimers();
    try {
      let resolved = false;
      sleep(1000).then(() => {
        resolved = true;
      });

      await vi.advanceTimersByTimeAsync(999);
      expect(resolved).toBe(false);

      await vi.advanceTimersByTimeAsync(1);
      expect(resolved).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("basename", () => {
  it("returns the last segment of a forward-slash path", () => {
    expect(basename("/a/b/c.txt")).toBe("c.txt");
  });

  it("returns the last segment of a backslash path", () => {
    expect(basename("C:\\a\\b\\c.txt")).toBe("c.txt");
  });

  it("returns the last segment when separators are mixed", () => {
    expect(basename("C:\\a/b\\c.txt")).toBe("c.txt");
  });

  it("returns the whole string when there is no separator", () => {
    expect(basename("c.txt")).toBe("c.txt");
  });

  it("returns an empty string for a trailing separator", () => {
    expect(basename("/a/b/")).toBe("");
  });

  it("returns an empty string for an empty input", () => {
    expect(basename("")).toBe("");
  });
});
