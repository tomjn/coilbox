import { describe, expect, it } from "vitest";
import type { ChatMsg } from "../bindings";
import { foldNotices, summariseNotices } from "./noticeRuns";

const NOON = new Date(2026, 9, 7, 12, 0).getTime();

function msg(from: string, kind: ChatMsg["kind"], at = NOON): ChatMsg {
  return { channel: "main", from, text: "", kind, at, id: null };
}

describe("foldNotices", () => {
  it("folds adjacent joins and leaves into one row", () => {
    const rows = foldNotices([
      msg("alice", "said"),
      msg("bob", "join"),
      msg("carol", "leave"),
      msg("bob", "leave"),
      msg("alice", "said"),
    ]);
    expect(rows.map((r) => r.run?.length ?? null)).toEqual([null, 3, null]);
    expect(rows[1].m.from).toBe("bob");
  });

  it("leaves a notice with nothing beside it as a plain message", () => {
    const rows = foldNotices([
      msg("alice", "said"),
      msg("bob", "join"),
      msg("alice", "said"),
    ]);
    expect(rows.every((r) => r.run === null)).toBe(true);
  });

  it("does not fold a system line into a run", () => {
    const rows = foldNotices([
      msg("bob", "join"),
      msg("", "system"),
      msg("carol", "join"),
    ]);
    expect(rows).toHaveLength(3);
  });

  it("stops a run at midnight", () => {
    const nextDay = NOON + 24 * 60 * 60_000;
    const rows = foldNotices([
      msg("bob", "join"),
      msg("carol", "join"),
      msg("dave", "join", nextDay),
      msg("erin", "join", nextDay),
    ]);
    expect(rows.map((r) => r.run?.length)).toEqual([2, 2]);
  });
});

describe("summariseNotices", () => {
  it("sorts people by where they started and where they ended up", () => {
    const summary = summariseNotices([
      msg("walleye", "join"),
      msg("walleye", "leave"),
      msg("walleye", "join"),
      msg("amir", "leave"),
      msg("eden", "join"),
      msg("kawaii", "leave"),
      msg("amir", "join"),
      msg("tourist", "join"),
      msg("tourist", "leave"),
    ]);
    expect(summary).toEqual({
      joined: ["walleye", "eden"],
      rejoined: ["amir"],
      left: ["kawaii"],
      passedThrough: ["tourist"],
    });
  });
});
