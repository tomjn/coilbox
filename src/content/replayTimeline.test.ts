import { describe, expect, it } from "vitest";
import type { ChatLine } from "./bindings";
import {
  axisTicks,
  binMarks,
  markKind,
  timelineDomain,
  toMarks,
} from "./replayTimeline";

const line = (over: Partial<ChatLine>): ChatLine => ({
  frame: 0,
  time: 0,
  player: 0,
  text: "",
  system: false,
  ...over,
});

describe("markKind", () => {
  it("tells a system line from a person and reads the destination", () => {
    expect(markKind(line({ system: true, player: 255 }))).toBe("system");
    expect(markKind(line({ dest: { kind: "allies" } }))).toBe("allies");
    expect(markKind(line({ dest: { kind: "spectators" } }))).toBe("spectators");
    expect(markKind(line({ dest: { kind: "player", player: 2 } }))).toBe(
      "whisper",
    );
    expect(markKind(line({ dest: { kind: "everyone" } }))).toBe("everyone");
    expect(markKind(line({}))).toBe("everyone");
  });
});

describe("toMarks", () => {
  it("takes match time from the frame at 30 a second", () => {
    const [m] = toMarks([line({ frame: 30 * 65 + 29 })]);
    expect(m.second).toBe(65);
  });

  it("gives a pregame line no match time", () => {
    const [m] = toMarks([line({ frame: -1 })]);
    expect(m.second).toBeNull();
  });

  it("keeps the log position of each line", () => {
    expect(toMarks([line({}), line({})]).map((m) => m.index)).toEqual([0, 1]);
  });

  it("returns nothing for an empty log", () => {
    expect(toMarks([])).toEqual([]);
  });
});

describe("timelineDomain", () => {
  it("is the match length", () => {
    expect(
      timelineDomain(toMarks([line({ frame: 30 * 10 })]), 600, false),
    ).toBe(600);
  });

  it("stretches to a line that falls after the stated length", () => {
    expect(
      timelineDomain(toMarks([line({ frame: 30 * 700 })]), 600, false),
    ).toBe(700);
  });

  it("stops at the last line when the stream broke", () => {
    expect(
      timelineDomain(toMarks([line({ frame: 30 * 120 })]), 600, true),
    ).toBe(120);
  });

  it("falls back to the match length for an empty log", () => {
    expect(timelineDomain([], 600, true)).toBe(600);
    expect(timelineDomain([], 0, false)).toBe(0);
  });
});

describe("binMarks", () => {
  it("stacks lines of one kind that share a column", () => {
    const marks = toMarks([
      line({ frame: 30 * 10 }),
      line({ frame: 30 * 11 }),
      line({ frame: 30 * 500 }),
    ]);
    const bins = binMarks(marks, 600, 60);
    expect(bins.map((b) => [b.slot, b.marks.length])).toEqual([
      [1, 2],
      [50, 1],
    ]);
  });

  it("keeps kinds in separate bins and puts pregame lines in their own slot", () => {
    const marks = toMarks([
      line({ frame: 30 * 10 }),
      line({ frame: 30 * 10, system: true }),
      line({ frame: -1 }),
    ]);
    const bins = binMarks(marks, 600, 60);
    expect(bins).toHaveLength(3);
    expect(bins.find((b) => b.slot === "pregame")?.marks).toHaveLength(1);
  });

  it("puts a line at the very end in the last column", () => {
    const bins = binMarks(toMarks([line({ frame: 30 * 600 })]), 600, 60);
    expect(bins[0].slot).toBe(59);
  });
});

describe("axisTicks", () => {
  it("starts at zero and uses a round step", () => {
    expect(axisTicks(40 * 60)).toEqual([0, 600, 1200, 1800, 2400]);
  });

  it("is just zero for no length", () => {
    expect(axisTicks(0)).toEqual([0]);
  });
});
