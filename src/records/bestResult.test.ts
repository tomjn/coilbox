import { describe, expect, it } from "vitest";
import { type GameResult, mergeResult, type ResultRecord } from "./bestResult";

const win = (
  replayFilename: string,
  durationSec: number | null,
): GameResult => ({
  replayFilename,
  outcome: "victory",
  durationSec,
});
const loss = (replayFilename: string, durationSec = 300): GameResult => ({
  replayFilename,
  outcome: "defeat",
  durationSec,
});

/** Merge a run of results into nothing, returning the last record and change. */
function play(...results: GameResult[]) {
  let record: ResultRecord | undefined;
  let change: ReturnType<typeof mergeResult>["change"] | undefined;
  for (const r of results) {
    const merged = mergeResult(record, r);
    record = merged.record;
    change = merged.change;
  }
  // biome-ignore lint/style/noNonNullAssertion: every caller passes a result
  return { record: record!, change: change! };
}

describe("mergeResult", () => {
  it("makes the first win the best", () => {
    const { record, change } = play(win("a.sdfz", 600));
    expect(record).toEqual({
      attempts: 1,
      wins: 1,
      best: { durationSec: 600, replayFilename: "a.sdfz" },
      seen: ["a.sdfz"],
    });
    expect(change).toEqual({ kind: "first-win", durationSec: 600 });
  });

  it("replaces the best with a faster win and says by how much", () => {
    const { record, change } = play(win("a.sdfz", 600), win("b.sdfz", 540));
    expect(record.best).toEqual({ durationSec: 540, replayFilename: "b.sdfz" });
    expect(record.wins).toBe(2);
    expect(record.attempts).toBe(2);
    expect(change).toEqual({ kind: "faster", durationSec: 540, bySec: 60 });
  });

  it("keeps the best on a slower win and says how far behind", () => {
    const { record, change } = play(win("a.sdfz", 600), win("b.sdfz", 700));
    expect(record.best).toEqual({ durationSec: 600, replayFilename: "a.sdfz" });
    expect(record.wins).toBe(2);
    expect(change).toEqual({ kind: "slower", bestSec: 600, bySec: 100 });
  });

  it("keeps the earlier replay when a win ties the best", () => {
    const { record, change } = play(win("a.sdfz", 600), win("b.sdfz", 600));
    expect(record.best?.replayFilename).toBe("a.sdfz");
    expect(change).toEqual({ kind: "equal", bestSec: 600 });
  });

  it("counts a loss after a win as an attempt and leaves the best", () => {
    const { record, change } = play(win("a.sdfz", 600), loss("b.sdfz"));
    expect(record.attempts).toBe(2);
    expect(record.wins).toBe(1);
    expect(record.best).toEqual({ durationSec: 600, replayFilename: "a.sdfz" });
    expect(change).toEqual({ kind: "loss" });
  });

  it("has no best when there are only losses", () => {
    const { record, change } = play(loss("a.sdfz"), loss("b.sdfz", 100));
    expect(record.attempts).toBe(2);
    expect(record.wins).toBe(0);
    expect(record.best).toBeNull();
    expect(change).toEqual({ kind: "loss" });
  });

  it("counts a game with no winner as an attempt and nothing else", () => {
    const { record, change } = play({
      replayFilename: "a.sdfz",
      outcome: "unknown",
      durationSec: 200,
    });
    expect(record).toEqual({
      attempts: 1,
      wins: 0,
      best: null,
      seen: ["a.sdfz"],
    });
    expect(change).toEqual({ kind: "no-winner" });
  });

  it("counts a win with no readable duration but cannot make it the best", () => {
    const { record, change } = play(win("a.sdfz", null));
    expect(record.wins).toBe(1);
    expect(record.best).toBeNull();
    expect(change).toEqual({ kind: "win-no-time" });
  });

  it("records the same replay once", () => {
    const first = play(win("a.sdfz", 600));
    const again = mergeResult(first.record, win("a.sdfz", 600));
    expect(again.change).toEqual({ kind: "duplicate" });
    expect(again.record).toBe(first.record);
    expect(again.record.attempts).toBe(1);
  });

  it("does not let a replay seen as a loss count again as a win", () => {
    const first = play(loss("a.sdfz"));
    const again = mergeResult(first.record, win("a.sdfz", 100));
    expect(again.change).toEqual({ kind: "duplicate" });
    expect(again.record.wins).toBe(0);
  });
});
