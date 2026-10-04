import { describe, expect, it, vi } from "vitest";

// The hook reads the frame's settings, whose published dist Vitest's node
// resolver will not load. Nothing here calls the hook.
vi.mock("@picoframe/frame", () => ({ useSetting: () => [{}, () => {}] }));

import { withWin } from "./wins";

describe("withWin", () => {
  it("records the scenario against when it was won", () => {
    expect(withWin({}, "s1", "2026-08-07T12:00:00.000Z")).toEqual({
      s1: "2026-08-07T12:00:00.000Z",
    });
  });

  it("keeps the other scenarios", () => {
    expect(withWin({ a: "then" }, "s1", "now")).toEqual({
      a: "then",
      s1: "now",
    });
  });

  it("hands back the same record for a second win, so nothing is written", () => {
    const wins = { s1: "then" };
    expect(withWin(wins, "s1", "now")).toBe(wins);
  });
});
