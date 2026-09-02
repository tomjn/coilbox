import { describe, expect, it } from "vitest";
import { findMatches, stepMatch } from "./missionLuaSearch";

describe("findMatches", () => {
  it("finds every case-insensitive occurrence, in reading order", () => {
    const lines = ["local Trigger = 1", "-- trigger fires here", "done"];
    expect(findMatches(lines, "trigger")).toEqual([
      { line: 0, start: 6, end: 13 },
      { line: 1, start: 3, end: 10 },
    ]);
  });

  it("does not match an empty or blank query", () => {
    const lines = ["something"];
    expect(findMatches(lines, "")).toEqual([]);
    expect(findMatches(lines, "   ")).toEqual([]);
  });

  it("finds adjacent, non-overlapping matches on one line", () => {
    expect(findMatches(["aaaa"], "aa")).toEqual([
      { line: 0, start: 0, end: 2 },
      { line: 0, start: 2, end: 4 },
    ]);
  });

  it("finds nothing when the query is not present", () => {
    expect(findMatches(["local x = 1"], "unitDef")).toEqual([]);
  });
});

describe("stepMatch", () => {
  it("is null with no matches, whatever the current index", () => {
    expect(stepMatch(0, null, 1)).toBeNull();
    expect(stepMatch(0, 2, -1)).toBeNull();
  });

  it("starts at the first match going forward from null", () => {
    expect(stepMatch(5, null, 1)).toBe(0);
  });

  it("starts at the last match going backward from null", () => {
    expect(stepMatch(5, null, -1)).toBe(4);
  });

  it("wraps forward past the last match to the first", () => {
    expect(stepMatch(3, 2, 1)).toBe(0);
  });

  it("wraps backward past the first match to the last", () => {
    expect(stepMatch(3, 0, -1)).toBe(2);
  });

  it("steps by one in the middle of the list", () => {
    expect(stepMatch(5, 2, 1)).toBe(3);
    expect(stepMatch(5, 2, -1)).toBe(1);
  });
});
