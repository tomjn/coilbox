import { describe, expect, it } from "vitest";
import list from "../../crates/tauri-plugin-coilbox-uberstress/error-counters.json";
import type { Report } from "./bindings";
import { isErrorCounter, summarize } from "./reportMetrics";

describe("isErrorCounter", () => {
  // The Rust badge test reads the same file, so the two cannot drift apart.
  it.each(list.errors)("%s is an error counter", (name) => {
    expect(isErrorCounter(name)).toBe(true);
  });

  it.each(list.notErrors)("%s is not an error counter", (name) => {
    expect(isErrorCounter(name)).toBe(false);
  });
});

describe("summarize", () => {
  it("counts kick and fail counters as errors", () => {
    const report = {
      scenario: "flood",
      addr: "127.0.0.1:8300",
      duration_sec: 10,
      commands: [{ command: "PING", count: 90, per_second: 9 }],
      counters: { login_ok: 30, flood_kick: 4, login_fail: 2, timeout: 1 },
    } as unknown as Report;
    const s = summarize(report);
    expect(s.totalErrors).toBe(7);
    expect(s.successRate).toBeCloseTo(90 / 97);
  });
});
