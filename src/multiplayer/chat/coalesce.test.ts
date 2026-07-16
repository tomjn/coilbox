import { describe, expect, it } from "vitest";
import type { ChatKind, ChatMsg } from "../bindings";
import {
  COALESCE_WINDOW_MS,
  coalesceMessages,
  MAX_MERGE_PARTS,
} from "./coalesce";

const T = 1_700_000_000_000;

function msg(
  from: string,
  text: string,
  at: number,
  kind: ChatKind = "said",
): ChatMsg {
  return { channel: "main", from, text, kind, at, id: null };
}

describe("coalesceMessages", () => {
  it("passes an empty list and a single message through unchanged", () => {
    expect(coalesceMessages([])).toEqual([]);
    const one = [msg("alice", "hi", T)];
    expect(coalesceMessages(one)).toEqual(one);
  });

  it("merges two lines from one sender inside the window", () => {
    expect(
      coalesceMessages([msg("alice", "one", T), msg("alice", "two", T + 200)]),
    ).toEqual([msg("alice", "one\ntwo", T)]);
  });

  it("keeps the first part's timestamp on a merged block", () => {
    const [merged] = coalesceMessages([
      msg("alice", "one", T),
      msg("alice", "two", T + 900),
    ]);
    expect(merged.at).toBe(T);
  });

  it("does not merge across a gap just over the window", () => {
    const msgs = [
      msg("alice", "one", T),
      msg("alice", "two", T + COALESCE_WINDOW_MS + 1),
    ];
    expect(coalesceMessages(msgs)).toEqual(msgs);
  });

  it("merges across a gap exactly at the window", () => {
    expect(
      coalesceMessages([
        msg("alice", "one", T),
        msg("alice", "two", T + COALESCE_WINDOW_MS),
      ]),
    ).toEqual([msg("alice", "one\ntwo", T)]);
  });

  it("measures the window per gap, not across a run's total span", () => {
    // Five lines paced a second apart span 4s, well past the window end to end.
    const msgs = [0, 1, 2, 3, 4].map((i) =>
      msg("alice", `l${i}`, T + i * 1000),
    );
    expect(coalesceMessages(msgs)).toEqual([
      msg("alice", "l0\nl1\nl2\nl3\nl4", T),
    ]);
  });

  it("never merges when either timestamp is 0", () => {
    // `at` is 0 when the reducer ran without a clock; the gap is then 0, which
    // would otherwise pass the window check and blob a whole history together.
    const both = [msg("alice", "one", 0), msg("alice", "two", 0)];
    expect(coalesceMessages(both)).toEqual(both);

    const first = [msg("alice", "one", 0), msg("alice", "two", T)];
    expect(coalesceMessages(first)).toEqual(first);

    const second = [msg("alice", "one", T), msg("alice", "two", 0)];
    expect(coalesceMessages(second)).toEqual(second);
  });

  it("never merges emotes", () => {
    const msgs = [
      msg("alice", "waves", T, "saidEx"),
      msg("alice", "grins", T + 100, "saidEx"),
    ];
    expect(coalesceMessages(msgs)).toEqual(msgs);
  });

  it("never merges notices", () => {
    for (const kind of ["system", "join", "leave"] as const) {
      const msgs = [
        msg("alice", "a", T, kind),
        msg("alice", "b", T + 100, kind),
      ];
      expect(coalesceMessages(msgs)).toEqual(msgs);
    }
  });

  it("does not merge adjacent messages of different kinds", () => {
    const msgs = [
      msg("alice", "one", T, "said"),
      msg("alice", "two", T + 100, "private"),
    ];
    expect(coalesceMessages(msgs)).toEqual(msgs);
  });

  it("does not merge adjacent messages from different senders", () => {
    const msgs = [msg("alice", "one", T), msg("bob", "two", T + 100)];
    expect(coalesceMessages(msgs)).toEqual(msgs);
  });

  it("merges battle chat and DMs too", () => {
    expect(
      coalesceMessages([
        msg("alice", "one", T, "saidBattle"),
        msg("alice", "two", T + 100, "saidBattle"),
      ]),
    ).toEqual([msg("alice", "one\ntwo", T, "saidBattle")]);
    expect(
      coalesceMessages([
        msg("alice", "one", T, "private"),
        msg("alice", "two", T + 100, "private"),
      ]),
    ).toEqual([msg("alice", "one\ntwo", T, "private")]);
  });

  it("resumes merging after an unmergeable message splits a run", () => {
    expect(
      coalesceMessages([
        msg("alice", "one", T),
        msg("bob", "hi", T + 100),
        msg("alice", "two", T + 200),
        msg("alice", "three", T + 300),
      ]),
    ).toEqual([
      msg("alice", "one", T),
      msg("bob", "hi", T + 100),
      msg("alice", "two\nthree", T + 200),
    ]);
  });

  it("caps a run at MAX_MERGE_PARTS and starts a new block", () => {
    const n = MAX_MERGE_PARTS + 3;
    const msgs = Array.from({ length: n }, (_, i) =>
      msg("alice", `l${i}`, T + i * 10),
    );
    const out = coalesceMessages(msgs);
    expect(out).toHaveLength(2);
    expect(out[0].text.split("\n")).toHaveLength(MAX_MERGE_PARTS);
    expect(out[0].at).toBe(T);
    expect(out[1].text.split("\n")).toHaveLength(3);
    expect(out[1].at).toBe(T + MAX_MERGE_PARTS * 10);
  });

  it("does not mutate its input", () => {
    const msgs = [msg("alice", "one", T), msg("alice", "two", T + 100)];
    coalesceMessages(msgs);
    expect(msgs.map((m) => m.text)).toEqual(["one", "two"]);
  });
});
