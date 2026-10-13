import { describe, expect, it } from "vitest";
import {
  groupMarks,
  type PlacedMark,
  stepToMark,
  toFrameParam,
  urlFrame,
} from "./timelineMarks";

const mark = (lane: PlacedMark["lane"], frame: number): PlacedMark => ({
  lane,
  frame,
});
const RANGE = { first: 0, last: 1000 };

describe("grouping marks", () => {
  it("puts marks that fall in one column of one lane into one mark with a count", () => {
    // 100 columns over 1000 frames: ten frames to a column.
    const groups = groupMarks(
      [mark("kills", 11), mark("kills", 19), mark("kills", 12)],
      RANGE,
      100,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ lane: "kills", count: 3, frame: 11 });
  });

  it("keeps lanes apart and keeps marks in different columns apart", () => {
    const groups = groupMarks(
      [mark("kills", 11), mark("chat", 12), mark("kills", 25)],
      RANGE,
      100,
    );
    expect(groups.map((g) => [g.lane, g.column, g.count])).toEqual([
      ["kills", 1, 1],
      ["chat", 1, 1],
      ["kills", 2, 1],
    ]);
  });

  it("makes at most one mark for each column of a lane, however many events there are", () => {
    const many = Array.from({ length: 20_000 }, (_, i) =>
      mark("kills", (i * 7) % 1001),
    );
    const groups = groupMarks(many, RANGE, 100);
    expect(groups.length).toBeLessThanOrEqual(100);
    expect(groups.reduce((n, g) => n + g.count, 0)).toBe(20_000);
  });

  it("puts the last frame in the last column", () => {
    const [group] = groupMarks([mark("chat", 1000)], RANGE, 100);
    expect(group.column).toBe(99);
  });

  it("leaves out an event outside the track", () => {
    expect(
      groupMarks([mark("chat", -1), mark("kills", 1001)], RANGE, 100),
    ).toEqual([]);
  });

  it("makes no marks when there are no events", () => {
    expect(groupMarks([], RANGE, 100)).toEqual([]);
  });

  it("makes no marks for a bar with no width", () => {
    expect(groupMarks([mark("chat", 5)], RANGE, 0)).toEqual([]);
  });

  it("puts every event in the one column of a one frame match", () => {
    const groups = groupMarks(
      [mark("chat", 4), mark("chat", 4)],
      { first: 4, last: 4 },
      50,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].count).toBe(2);
  });
});

describe("stepping to a mark", () => {
  const groups = groupMarks(
    [mark("kills", 100), mark("chat", 300), mark("kills", 300)],
    RANGE,
    100,
  );

  it("finds the next mark after a frame", () => {
    expect(stepToMark(groups, 100, 1)).toBe(300);
    expect(stepToMark(groups, 0, 1)).toBe(100);
  });

  it("finds the previous mark before a frame", () => {
    expect(stepToMark(groups, 300, -1)).toBe(100);
  });

  it("finds nothing past either end", () => {
    expect(stepToMark(groups, 300, 1)).toBeNull();
    expect(stepToMark(groups, 100, -1)).toBeNull();
  });
});

describe("the time in the address", () => {
  const track = { first: 100, last: 400 };

  it("reads a whole frame", () => {
    expect(urlFrame("250", track)).toBe(250);
  });

  it("holds a frame beyond the end to the last frame and one before the start to the first", () => {
    expect(urlFrame("9999", track)).toBe(400);
    expect(urlFrame("5", track)).toBe(100);
    expect(urlFrame("-30", track)).toBe(100);
  });

  it("ignores a time that is not a number", () => {
    expect(urlFrame(null, track)).toBeNull();
    expect(urlFrame("", track)).toBeNull();
    expect(urlFrame("soon", track)).toBeNull();
    expect(urlFrame("12abc", track)).toBeNull();
    expect(urlFrame("Infinity", track)).toBeNull();
  });

  it("writes a whole frame", () => {
    expect(toFrameParam(250.6)).toBe("251");
  });
});
