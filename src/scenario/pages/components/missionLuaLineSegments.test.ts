import { describe, expect, it } from "vitest";
import { splitLineSegments } from "./missionLuaLineSegments";

/** The join of every segment's text, to check nothing was lost or invented. */
function rejoin(segments: ReturnType<typeof splitLineSegments>): string {
  return segments.map((s) => s.text).join("");
}

describe("splitLineSegments", () => {
  it("returns the whole line as one plain segment with nothing to layer on", () => {
    expect(
      splitLineSegments("local x = 1", undefined, undefined, null),
    ).toEqual([{ text: "local x = 1", match: false, active: false }]);
  });

  it("renders a blank line as one empty segment, not zero segments", () => {
    expect(splitLineSegments("", undefined, undefined, null)).toEqual([
      { text: "", match: false, active: false },
    ]);
  });

  it("carries shiki's colour on each token, unchanged, with no matches", () => {
    const tokens = [
      { content: "local ", color: "#ff0000", offset: 0 },
      { content: "x", color: "#00ff00", offset: 6 },
    ];
    const segments = splitLineSegments("local x", tokens, undefined, null);
    expect(segments).toEqual([
      { text: "local ", color: "#ff0000", match: false, active: false },
      { text: "x", color: "#00ff00", match: false, active: false },
    ]);
    expect(rejoin(segments)).toBe("local x");
  });

  it("falls back to plain text when the tokens do not reconstruct the line", () => {
    const tokens = [{ content: "not the line", color: "#ff0000", offset: 0 }];
    const segments = splitLineSegments("local x", tokens, undefined, null);
    expect(segments).toEqual([
      { text: "local x", match: false, active: false },
    ]);
  });

  it("marks a match that falls inside a single token without losing its colour", () => {
    const tokens = [{ content: "local Trigger = 1", color: "#abc", offset: 0 }];
    const match = { line: 0, start: 6, end: 13 };
    const segments = splitLineSegments(
      "local Trigger = 1",
      tokens,
      [match],
      null,
    );
    expect(rejoin(segments)).toBe("local Trigger = 1");
    const matched = segments.filter((s) => s.match);
    expect(matched).toEqual([
      { text: "Trigger", color: "#abc", match: true, active: false },
    ]);
  });

  it("marks the active match apart from other matches of the same query", () => {
    const matches = [
      { line: 0, start: 0, end: 2 },
      { line: 0, start: 3, end: 5 },
    ];
    const segments = splitLineSegments("aa bb", undefined, matches, matches[1]);
    expect(segments).toEqual([
      { text: "aa", match: true, active: false },
      { text: " ", match: false, active: false },
      { text: "bb", match: true, active: true },
    ]);
  });

  it("does not let two adjacent matches merge into one segment", () => {
    const matches = [
      { line: 0, start: 0, end: 2 },
      { line: 0, start: 2, end: 4 },
    ];
    const segments = splitLineSegments("aaaa", undefined, matches, matches[0]);
    expect(segments).toEqual([
      { text: "aa", match: true, active: true },
      { text: "aa", match: true, active: false },
    ]);
  });
});
