import { describe, expect, it } from "vitest";
import type { ChatLine, TimelineEvent } from "./bindings";
import {
  axisTicks,
  binMarks,
  describeEvent,
  markKind,
  timelineDomain,
  toEventMarks,
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

const event = (over: Partial<TimelineEvent>): TimelineEvent =>
  ({
    frame: 30 * 60,
    time: 0,
    player: 3,
    playerName: "Ann",
    type: "resigned",
    ...over,
  }) as TimelineEvent;

describe("toEventMarks", () => {
  it("puts each kind of event in its own row and takes match time from the frame", () => {
    const marks = toEventMarks([
      event({ type: "resigned" }),
      event({ type: "playerLeft", reason: { kind: "kicked" } }),
      event({ type: "paused", paused: true }),
      event({ type: "teamDied", team: 1, players: [] }),
      event({ type: "joined", spectator: true, team: 0 }),
      event({ type: "giveAway", toTeam: 1, fromTeam: 2 }),
      event({ type: "other", action: 9, param1: 0, param2: 0 }),
    ]);
    expect(marks.map((m) => m.kind)).toEqual([
      "resigned",
      "left",
      "paused",
      "teamDied",
      "joined",
      "giveAway",
      "other",
    ]);
    expect(marks[0].second).toBe(60);
  });

  it("gives an event before the game no match time", () => {
    expect(toEventMarks([event({ frame: -1 })])[0].second).toBeNull();
  });

  it("stacks events of one kind that share a column", () => {
    const marks = toEventMarks([
      event({ frame: 30 * 10 }),
      event({ frame: 30 * 11 }),
      event({ frame: 30 * 11, type: "paused", paused: true }),
    ]);
    const bins = binMarks(marks, 600, 60);
    expect(bins.map((b) => [b.kind, b.marks.length])).toEqual([
      ["resigned", 2],
      ["paused", 1],
    ]);
  });

  it("stretches the axis to an event after the stated length", () => {
    const marks = toEventMarks([event({ frame: 30 * 700 })]);
    expect(timelineDomain(marks, 600, false)).toBe(700);
  });
});

describe("describeEvent", () => {
  it("says what happened in words built from the typed event", () => {
    expect(describeEvent(event({ type: "resigned" }))).toBe("Ann resigned");
    expect(
      describeEvent(
        event({ type: "playerLeft", reason: { kind: "lostConnection" } }),
      ),
    ).toBe("Ann lost connection");
    expect(
      describeEvent(event({ type: "playerLeft", reason: { kind: "left" } })),
    ).toBe("Ann left the game");
    expect(
      describeEvent(event({ type: "playerLeft", reason: { kind: "kicked" } })),
    ).toBe("Ann was kicked");
    expect(
      describeEvent(
        event({ type: "playerLeft", reason: { kind: "other", code: 7 } }),
      ),
    ).toBe("Ann left the game (reason code 7)");
    expect(describeEvent(event({ type: "paused", paused: true }))).toBe(
      "Ann paused the game",
    );
    expect(describeEvent(event({ type: "paused", paused: false }))).toBe(
      "Ann unpaused the game",
    );
    expect(
      describeEvent(event({ type: "joined", spectator: true, team: 0 })),
    ).toBe("Ann joined as a spectator");
    expect(
      describeEvent(event({ type: "joined", spectator: false, team: 1 })),
    ).toBe("Ann joined the game");
  });

  it("names whoever lost an army, not the player who reported it", () => {
    const base = {
      type: "teamDied",
      team: 2,
      player: 7,
      playerName: "Rep",
    } as const;
    expect(describeEvent(event({ ...base, players: ["Ann"] }))).toBe(
      "Ann's army was eliminated",
    );
    expect(describeEvent(event({ ...base, players: ["Ann", "Ben"] }))).toBe(
      "Ann and Ben's army was eliminated",
    );
    expect(describeEvent(event({ ...base, players: [] }))).toBe(
      "An army was eliminated",
    );
  });

  it("falls back to the player number, and keeps an unknown action visible", () => {
    expect(describeEvent(event({ playerName: undefined, player: 4 }))).toBe(
      "Player 4 resigned",
    );
    expect(describeEvent(event({ playerName: undefined, player: 255 }))).toBe(
      "The server resigned",
    );
    expect(
      describeEvent(event({ type: "other", action: 9, param1: 1, param2: 2 })),
    ).toContain("code 9");
  });
});
