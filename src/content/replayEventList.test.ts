import { describe, expect, it } from "vitest";
import type { ChatLine, TimelineEvent } from "./bindings";
import { ALL_KINDS, ALL_PLAYERS, type LogEvent } from "./replayAnalysisEvents";
import {
  describeChat,
  describeLogEvent,
  type EventRow,
  markedIndex,
  mergeRows,
  playerChoices,
  rowGroup,
  rowTime,
  selectRows,
} from "./replayEventList";

const labels = new Map([
  [0, "Alice"],
  [1, "Bob"],
]);
const teamOf = new Map([
  [0, 0],
  [1, 1],
]);

const chat = (over: Partial<ChatLine>): ChatLine =>
  ({
    frame: 0,
    player: 0,
    playerName: "Alice",
    text: "hello",
    system: false,
    ...over,
  }) as ChatLine;

const joined = (over: Partial<TimelineEvent>): TimelineEvent =>
  ({
    frame: 0,
    time: 0,
    player: 1,
    playerName: "Bob",
    type: "joined",
    spectator: false,
    team: 1,
    ...over,
  }) as TimelineEvent;

const CHAT = [
  chat({ frame: 300, text: "gl hf" }),
  chat({ frame: 30, player: 1, playerName: "Bob", text: "hi" }),
];
const PLAYERS = [
  joined({ frame: 60 }),
  joined({ frame: 900, type: "resigned" } as Partial<TimelineEvent>),
  joined({ frame: 100, type: "other" } as Partial<TimelineEvent>),
];
const LOG: LogEvent[] = [
  { kind: "unit_created", frame: 150, def: 2, team: 0 },
  {
    kind: "unit_destroyed",
    frame: 600,
    def: 3,
    team: 1,
    attackerDef: 2,
    attackerTeam: 0,
  },
];

const rows = () => mergeRows(CHAT, PLAYERS, LOG, teamOf);
const frames = (list: EventRow[]) => list.map((r) => r.frame);
const all = { filter: "all", kind: ALL_KINDS, player: ALL_PLAYERS } as const;

describe("mergeRows", () => {
  it("puts chat, player events and logged events in time order", () => {
    expect(frames(rows())).toEqual([30, 60, 150, 300, 600, 900]);
    expect(rows().map((r) => r.source)).toEqual([
      "chat",
      "player",
      "log",
      "chat",
      "log",
      "player",
    ]);
  });

  it("leaves out a player action the app does not name", () => {
    expect(rows().some((r) => r.frame === 100)).toBe(false);
  });

  it("orders rows in one frame as chat, then players, then the log", () => {
    const merged = mergeRows(
      [chat({ frame: 10 })],
      [joined({ frame: 10 })],
      [{ kind: "unit_created", frame: 10 }],
      teamOf,
    );
    expect(merged.map((r) => r.source)).toEqual(["chat", "player", "log"]);
  });

  it("gives chat a team from the seated player and a system line none", () => {
    const merged = mergeRows(
      [chat({ player: 1 }), chat({ system: true, player: 0 })],
      [],
      [],
      teamOf,
    );
    expect(merged.map((r) => (r.source === "chat" ? r.team : null))).toEqual([
      1,
      undefined,
    ]);
  });
});

describe("selectRows", () => {
  it("opens on chat, kills and player events, without the other logged events", () => {
    const shown = selectRows(
      rows(),
      { filter: "highlights", kind: ALL_KINDS, player: ALL_PLAYERS },
      labels,
    );
    expect(shown.map(rowGroup)).toEqual([
      "chat",
      "players",
      "chat",
      "kills",
      "players",
    ]);
  });

  it("shows every logged event under All", () => {
    expect(selectRows(rows(), all, labels)).toHaveLength(6);
  });

  it.each([
    ["chat", ["chat", "chat"]],
    ["kills", ["kills"]],
    ["players", ["players", "players"]],
  ] as const)("shows only %s under its filter", (filter, groups) => {
    const shown = selectRows(
      rows(),
      { filter, kind: ALL_KINDS, player: ALL_PLAYERS },
      labels,
    );
    expect(shown.map(rowGroup)).toEqual(groups);
  });

  it("narrows to one logged kind", () => {
    const shown = selectRows(rows(), { ...all, kind: "unit_created" }, labels);
    expect(frames(shown)).toEqual([150]);
  });

  it("narrows to one player across all three sources", () => {
    const shown = selectRows(rows(), { ...all, player: "team:1" }, labels);
    // Bob's chat, Bob joining and resigning, and the kill of Bob's unit.
    expect(frames(shown)).toEqual([30, 60, 600, 900]);
  });

  it("counts a kill as the killer's player too", () => {
    const shown = selectRows(rows(), { ...all, player: "team:0" }, labels);
    expect(frames(shown)).toEqual([150, 300, 600]);
  });
});

describe("playerChoices", () => {
  it("lists everyone who controls a team, with neutral only when an event needs it", () => {
    expect(playerChoices(labels, LOG).map((o) => o.label)).toEqual([
      "Alice",
      "Bob",
    ]);
    const neutral: LogEvent[] = [{ kind: "unit_created", team: 9 }];
    expect(playerChoices(labels, neutral).map((o) => o.label)).toEqual([
      "Alice",
      "Bob",
      "Neutral",
    ]);
  });
});

describe("markedIndex", () => {
  it("is the row at the time", () => {
    expect(markedIndex(rows(), 150)).toBe(2);
  });

  it("is the row just before a time between two rows", () => {
    expect(markedIndex(rows(), 599)).toBe(3);
  });

  it("is -1 before the first row", () => {
    expect(markedIndex(rows(), 29)).toBe(-1);
  });

  it("is the last row after the last", () => {
    expect(markedIndex(rows(), 99999)).toBe(5);
  });

  it("is the last of rows that share a frame", () => {
    const same = mergeRows(
      [chat({ frame: 10 })],
      [joined({ frame: 10 })],
      [],
      teamOf,
    );
    expect(markedIndex(same, 10)).toBe(1);
  });

  it("is -1 for no rows", () => {
    expect(markedIndex([], 10)).toBe(-1);
  });
});

describe("describeLogEvent", () => {
  const names = new Map([
    [2, "Lifter"],
    [3, "Thud"],
  ]);
  const unitName = (def: number) => names.get(def) ?? `Unit ${def}`;

  it("names the unit that died, the killer and the killer's player", () => {
    expect(describeLogEvent(LOG[1] as LogEvent, unitName, labels)).toBe(
      "Thud destroyed by Lifter (Alice)",
    );
  });

  it("names the player alone when the killer's unit is not logged", () => {
    const event = { kind: "unit_destroyed", def: 3, attackerTeam: 1 };
    expect(describeLogEvent(event, unitName, labels)).toBe(
      "Thud destroyed by Bob",
    );
  });

  it("names the unit alone when nothing killed it", () => {
    const event = { kind: "unit_destroyed", def: 3, team: 1 };
    expect(describeLogEvent(event, unitName, labels)).toBe("Thud destroyed");
  });

  it("names a made unit, its owner and the rest of its fields", () => {
    expect(describeLogEvent(LOG[0] as LogEvent, unitName, labels)).toBe(
      "Lifter (Alice)",
    );
    const event = { kind: "unit_created", def: 2, team: 0, x: 1, y: 2, z: 3 };
    expect(describeLogEvent(event, unitName, labels)).toBe(
      "Lifter (Alice), at 1, 2, 3",
    );
  });
});

describe("rowTime", () => {
  const range = { firstFrame: 0, framesPerSecond: 30 };

  it("is the minutes and seconds into the match", () => {
    expect(rowTime(30 * 75, range)).toBe("1:15");
  });

  it("counts from the range's first frame", () => {
    expect(rowTime(1000 + 30 * 75, { ...range, firstFrame: 1000 })).toBe(
      "1:15",
    );
  });

  it("labels a line from before the match and leaves a frameless event blank", () => {
    expect(rowTime(-1, range)).toBe("Pre-game");
    expect(rowTime(Number.NEGATIVE_INFINITY, range)).toBe("");
  });
});

describe("describeChat", () => {
  it("says who, to whom when not everyone, and what", () => {
    const names = new Map([[1, "Bob"]]);
    expect(describeChat(chat({}), names)).toBe("Alice: hello");
    expect(
      describeChat(
        chat({ dest: { kind: "allies" } as ChatLine["dest"] }),
        names,
      ),
    ).toBe("Alice to allies: hello");
    expect(
      describeChat(
        chat({ dest: { kind: "player", player: 1 } as ChatLine["dest"] }),
        names,
      ),
    ).toBe("Alice to Bob: hello");
  });

  it("marks a system line with a star", () => {
    expect(
      describeChat(chat({ system: true, playerName: undefined }), new Map()),
    ).toBe("* hello");
  });
});
