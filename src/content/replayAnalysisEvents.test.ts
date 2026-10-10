import { describe, expect, it } from "vitest";
import type {
  DemoInfo,
  ReplayEventCounts,
  StoredReplayAnalysis,
} from "./bindings";
import {
  ALL_KINDS,
  ALL_PLAYERS,
  eventDetails,
  eventKinds,
  eventsDownloadText,
  eventsFileName,
  filterEvents,
  kindLabel,
  kindsFromCounts,
  type LogEvent,
  NEUTRAL_LABEL,
  NEUTRAL_PLAYER,
  pageOf,
  playerLabels,
  playerOptions,
  teamLabel,
} from "./replayAnalysisEvents";

const counts = (over: Partial<ReplayEventCounts> = {}): ReplayEventCounts => ({
  header: 0,
  gameStart: 1,
  unitCreated: 3,
  unitFinished: 0,
  unitDestroyed: 2,
  gameOver: 1,
  unknown: 0,
  ...over,
});

const info = {
  players: [
    { name: "Alice", team: 0, spectator: false },
    { name: "Bob", team: 1, spectator: false },
    { name: "Carol", team: 1, spectator: false },
    { name: "Watcher", team: 5, spectator: true },
  ],
  ais: [{ name: "Bot", shortName: "BARb", team: 2 }],
} as unknown as DemoInfo;

const labels = playerLabels(info);

const created = (team: number, over: Partial<LogEvent> = {}): LogEvent => ({
  kind: "unit_created",
  frame: 30,
  unit: 1,
  def: 4,
  team,
  x: 1,
  y: 2,
  z: 3,
  ...over,
});

describe("kinds", () => {
  it("names the kinds that have lines, in snake case", () => {
    expect(kindsFromCounts(counts())).toEqual([
      "game_start",
      "unit_created",
      "unit_destroyed",
      "game_over",
    ]);
  });

  it("does not try to name the unknown bucket", () => {
    expect(kindsFromCounts(counts({ unknown: 4 }))).not.toContain("unknown");
  });

  it("adds kinds only the events name, once each", () => {
    const events = [
      { kind: "damage" },
      { kind: "unit_created" },
      { kind: "damage" },
    ] as LogEvent[];
    expect(eventKinds(counts(), events)).toEqual([
      "game_start",
      "unit_created",
      "unit_destroyed",
      "game_over",
      "damage",
    ]);
  });

  it("words a kind", () => {
    expect(kindLabel("unit_created")).toBe("Unit created");
    expect(kindLabel("army_value")).toBe("Army value");
  });
});

describe("players", () => {
  it("labels one player, a shared team, an AI and an unknown team", () => {
    expect(teamLabel(0, labels)).toBe("Alice");
    expect(teamLabel(1, labels)).toBe("Bob and Carol");
    expect(teamLabel(2, labels)).toBe("Bot");
    expect(teamLabel(9, labels)).toBe(NEUTRAL_LABEL);
    expect(teamLabel(undefined, labels)).toBe("");
  });

  it("gives a spectator no team", () => {
    expect(labels.has(5)).toBe(false);
  });

  it("offers players with events in team order, and neutral for the rest", () => {
    const events = [created(2), created(0), created(9)];
    expect(playerOptions(events, labels)).toEqual([
      { value: "team:0", label: "Alice" },
      { value: "team:2", label: "Bot" },
      { value: NEUTRAL_PLAYER, label: NEUTRAL_LABEL },
    ]);
  });

  it("offers no neutral option when every team is a player's", () => {
    expect(playerOptions([created(0)], labels).map((o) => o.value)).toEqual([
      "team:0",
    ]);
  });

  it("offers a player who only appears as an attacker", () => {
    const kill = {
      kind: "unit_destroyed",
      team: 9,
      attackerTeam: 1,
    } as LogEvent;
    expect(playerOptions([kill], labels).map((o) => o.value)).toEqual([
      "team:1",
      NEUTRAL_PLAYER,
    ]);
  });
});

describe("filterEvents", () => {
  const kill = {
    kind: "unit_destroyed",
    frame: 90,
    team: 0,
    attackerTeam: 1,
    def: 4,
  } as LogEvent;
  const wreck = {
    kind: "unit_created",
    frame: 1,
    team: 9,
  } as LogEvent;
  const start = { kind: "game_start", frame: 0 } as LogEvent;
  const events = [start, created(0), created(1), kill, wreck];
  const all = { kind: ALL_KINDS, player: ALL_PLAYERS };

  it("keeps everything with no filter", () => {
    expect(filterEvents(events, all, labels)).toHaveLength(5);
  });

  it("filters by kind", () => {
    expect(
      filterEvents(events, { ...all, kind: "unit_created" }, labels),
    ).toHaveLength(3);
  });

  it("keeps an event of a kind nobody has heard of", () => {
    const odd = { kind: "from_the_future", extra: 1 } as LogEvent;
    expect(
      filterEvents([odd, start], { ...all, kind: "from_the_future" }, labels),
    ).toEqual([odd]);
  });

  it("filters by player, including the units they destroyed", () => {
    const got = filterEvents(events, { ...all, player: "team:1" }, labels);
    expect(got).toEqual([events[2], kill]);
  });

  it("includes the victim's side too", () => {
    const got = filterEvents(events, { ...all, player: "team:0" }, labels);
    expect(got).toEqual([events[1], kill]);
  });

  it("lists events of a team no player controls as neutral, not dropped", () => {
    expect(
      filterEvents(events, { ...all, player: NEUTRAL_PLAYER }, labels),
    ).toEqual([wreck]);
  });

  it("combines a kind and a player", () => {
    expect(
      filterEvents(
        events,
        { kind: "unit_destroyed", player: "team:1" },
        labels,
      ),
    ).toEqual([kill]);
  });
});

describe("pageOf", () => {
  it("takes the first rows and counts what is left", () => {
    expect(pageOf([1, 2, 3, 4, 5], 2)).toEqual({ rows: [1, 2], left: 3 });
  });

  it("has nothing left once everything is shown", () => {
    expect(pageOf([1, 2], 100)).toEqual({ rows: [1, 2], left: 0 });
  });
});

describe("eventDetails", () => {
  it("reads a position as one value and an attacker as a player", () => {
    const d = eventDetails(
      {
        kind: "unit_destroyed",
        frame: 1,
        team: 0,
        def: 4,
        unit: 7,
        x: 10.5,
        y: 0,
        z: 20,
        attackerTeam: 1,
      },
      labels,
    );
    expect(d).toEqual([
      { name: "at", text: "10.5, 0, 20" },
      { name: "unit", text: "7" },
      { name: "attacker", text: "Bob and Carol" },
    ]);
  });

  it("shows a field it has never heard of under its own name", () => {
    const d = eventDetails(
      { kind: "damage", frame: 1, amount: 12.5, tags: ["a"], note: "hit" },
      labels,
    );
    expect(d).toEqual([
      { name: "amount", text: "12.5" },
      { name: "tags", text: '["a"]' },
      { name: "note", text: "hit" },
    ]);
  });

  it("cuts a very long value", () => {
    const [d] = eventDetails({ kind: "k", blob: "x".repeat(500) }, labels);
    expect(d.text.length).toBeLessThan(250);
    expect(d.text.endsWith("…")).toBe(true);
  });
});

describe("download", () => {
  const analysis = {
    state: "current",
    sizeBytes: 99,
    kind: "analysis",
    gameId: "abc123",
    map: "Greenhaven",
    counts: counts(),
  } as unknown as StoredReplayAnalysis;

  it("writes the provenance first and then every event, one per line", () => {
    const events = [created(0), { kind: "damage", n: 1 } as LogEvent];
    const lines = eventsDownloadText(analysis, events).split("\n");
    expect(lines).toHaveLength(4);
    expect(lines[3]).toBe("");
    const first = JSON.parse(lines[0]);
    expect(first.kind).toBe("analysis");
    expect(first.gameId).toBe("abc123");
    expect(first).not.toHaveProperty("state");
    expect(first).not.toHaveProperty("sizeBytes");
    expect(lines.slice(1, 3).map((l) => JSON.parse(l))).toEqual(events);
  });

  it("names the file from the map, the date and the game id", () => {
    const named = {
      mapName: "Green Haven v2",
      startTimeMs: Date.UTC(2026, 9, 10, 12),
    } as DemoInfo;
    expect(eventsFileName(named, "ABC123")).toBe(
      "green-haven-v2-2026-10-10-abc123-events.jsonl",
    );
  });
});
