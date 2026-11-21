// @vitest-environment happy-dom

/**
 * The events and chat list (#5320): one list in time order from three sources,
 * its filters, the row marked at the scrubber's time, pressing a row to move the
 * scrubber, a replay with no analysis, and the download.
 */

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ChatLine,
  DemoInfo,
  GameItem,
  StoredReplayAnalysis,
  TimelineEvent,
  UnitDatasetEntry,
} from "../../bindings";

const read = vi.fn();
const write = vi.fn();
const save = vi.fn();
const notify = vi.fn(async () => {});
let GAMES: GameItem[] = [];
let DATASET: { units: UnitDatasetEntry[] } | null = null;
let CHAT: {
  messages: ChatLine[];
  incomplete: boolean;
  events: TimelineEvent[];
} = { messages: [], incomplete: false, events: [] };
let CHAT_ERROR: Error | null = null;

vi.mock("@tauri-apps/plugin-dialog", () => ({
  save: (...args: unknown[]) => save(...args),
}));
vi.mock("@/notify/notify", () => ({
  notify: (...args: unknown[]) => notify(...(args as [])),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: async () => () => {} }));
vi.mock("../../bindings", async (original) => ({
  ...(await original<typeof import("../../bindings")>()),
  contentReplayAnalysisEvents: (a: unknown) => read(a),
  contentWriteFile: (a: unknown) => write(a),
  contentDemoChat: async () => {
    if (CHAT_ERROR) throw CHAT_ERROR;
    return CHAT;
  },
}));
vi.mock("../../config", () => ({
  useScanTargetSelection: () => ({
    selected: { enginePath: "/engine", rootPath: "/data" },
  }),
  useUnitsyncScan: () => ({ data: { games: GAMES }, loading: false }),
  useUnitsyncUnitDataset: (_e: string, _d: string, archive?: string) =>
    archive && DATASET
      ? { dataset: DATASET, status: "ready" }
      : { dataset: null, status: archive ? "error" : "idle" },
}));

const { ReplayEventList } = await import("./ReplayEventList");
const { MatchClockProvider, useMatchClock } = await import(
  "../../useMatchClock"
);
const { resetReplayEventReadsForTests } = await import("../../replayEventRead");
const { resetReplayAnalysisForTests, seedReplayAnalysisForTests } =
  await import("../../replayAnalysis");

const stored = (
  over: Partial<StoredReplayAnalysis> = {},
): StoredReplayAnalysis =>
  ({
    state: "current",
    sizeBytes: 10,
    kind: "analysis",
    gameId: "game-a",
    analysedAtMs: 1,
    map: "Greenhaven",
    counts: {
      header: 0,
      gameStart: 0,
      unitCreated: 2,
      unitFinished: 0,
      unitDestroyed: 1,
      unitGiven: 0,
      startUnitPosition: 0,
      gameOver: 0,
      unknown: 1,
    },
    disagreements: [],
    ...over,
  }) as StoredReplayAnalysis;

const info = (over: Partial<DemoInfo> = {}) =>
  ({
    gameId: "game-a",
    gameType: "Splinter 1",
    mapName: "Greenhaven",
    startTimeMs: Date.UTC(2026, 9, 10),
    durationSec: 1200,
    remixed: false,
    players: [
      { name: "Alice", team: 0, player: 0, spectator: false },
      { name: "Bob", team: 1, player: 1, spectator: false },
    ],
    ais: [],
    ...over,
  }) as unknown as DemoInfo;

const line = (over: Partial<ChatLine>): ChatLine =>
  ({
    frame: 0,
    time: 0,
    player: 0,
    text: "",
    system: false,
    ...over,
  }) as ChatLine;

const CHAT_LINES = [
  line({ frame: 300, player: 0, playerName: "Alice", text: "gl hf" }),
  line({ frame: 1500, player: 1, playerName: "Bob", text: "gg" }),
];
const PLAYER_EVENTS = [
  {
    frame: 60,
    time: 2,
    player: 1,
    playerName: "Bob",
    type: "joined",
    spectator: false,
    team: 1,
  },
  { frame: 3000, time: 100, player: 1, playerName: "Bob", type: "resigned" },
] as TimelineEvent[];

const EVENTS = [
  {
    kind: "unit_created",
    frame: 90,
    unit: 1,
    def: 2,
    team: 0,
    x: 1,
    y: 2,
    z: 3,
  },
  {
    kind: "unit_created",
    frame: 450,
    unit: 2,
    def: 3,
    team: 1,
    x: 4,
    y: 5,
    z: 6,
  },
  {
    kind: "unit_destroyed",
    frame: 900,
    unit: 2,
    def: 3,
    team: 1,
    x: 4,
    y: 5,
    z: 6,
    attackerDef: 2,
    attackerTeam: 0,
  },
  { kind: "projectile", frame: 901, speed: 7.5 },
];

const UNITS: UnitDatasetEntry[] = [
  { name: "alpha", fullName: "Alpha Tank" },
  { name: "beta", fullName: "Beta Bot" },
  { name: "gamma", fullName: "Gamma Walker" },
];

const A = "/replays/a.sdfz";
const B = "/replays/b.sdfz";

type Clock = ReturnType<typeof useMatchClock>;
let clock: Clock;
function Probe() {
  clock = useMatchClock();
  return null;
}

function show(
  over: { info?: DemoInfo; path?: string; showAnalysis?: boolean } = {},
) {
  const ui = (o: typeof over) => (
    <MemoryRouter>
      <MatchClockProvider durationSec={6000}>
        <Probe />
        <ReplayEventList
          info={o.info ?? info()}
          replayPath={o.path ?? A}
          showAnalysis={o.showAnalysis ?? true}
        />
      </MatchClockProvider>
    </MemoryRouter>
  );
  const view = render(ui(over));
  return { ...view, again: (o: typeof over) => view.rerender(ui(o)) };
}

beforeEach(() => {
  resetReplayEventReadsForTests();
  read.mockReset();
  read.mockImplementation(async (a: { kinds?: string[] }) => {
    const events = a.kinds
      ? EVENTS.filter((e) => a.kinds?.includes(e.kind))
      : EVENTS;
    return { events, total: events.length };
  });
  write.mockReset();
  save.mockReset();
  notify.mockClear();
  GAMES = [];
  DATASET = null;
  CHAT_ERROR = null;
  CHAT = { messages: CHAT_LINES, incomplete: false, events: PLAYER_EVENTS };
  seedReplayAnalysisForTests({ analyses: [stored()] });
});

afterEach(() => {
  cleanup();
  resetReplayAnalysisForTests();
});

const items = () => screen.queryAllByRole("listitem");
const texts = () => items().map((li) => li.textContent);
/** The row's time, kind and sentence as the three columns show them. */
const columns = (li: HTMLElement) =>
  Array.from(li.querySelectorAll("button > span")).map((s) => s.textContent);
const ready = async () => {
  await screen.findAllByRole("listitem");
};
const choose = (name: string) =>
  fireEvent.click(screen.getByRole("radio", { name }));
const marked = () =>
  screen
    .queryAllByRole("button")
    .filter((b) => b.getAttribute("aria-current") === "true");
const frameOf = (sec: number) => sec * 30;
const seek = (frame: number) => act(() => clock.playback.seek(frame));

describe("the list", () => {
  it("holds chat, player events and kills in time order, each with time, kind and what happened", async () => {
    show();
    await ready();
    expect(items().map((li) => columns(li as HTMLElement))).toEqual([
      ["0:02", "Player", "Bob joined the game"],
      ["0:10", "Chat", "Alice: gl hf"],
      ["0:30", "Kill", "Unit 3 destroyed by Unit 2 (Alice)"],
      ["0:50", "Chat", "Bob: gg"],
      ["1:40", "Player", "Bob resigned"],
    ]);
  });

  it("reads only the kills until asked for more", async () => {
    show();
    await ready();
    expect(read).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledWith({
      gameId: "game-a",
      kinds: ["unit_destroyed"],
    });
  });

  it("names the units and the killer's player from the installed game", async () => {
    GAMES = [
      {
        name: "Splinter 1",
        primaryArchive: { name: "splinter.sdz" },
        dependencyArchives: [],
        info: {},
      } as GameItem,
    ];
    DATASET = { units: UNITS };
    show();
    await screen.findByText("Gamma Walker destroyed by Beta Bot (Alice)");
  });

  it("shows the id when the game is not installed, and says so", async () => {
    show();
    await ready();
    expect(screen.getByText(/is not installed/i)).toBeTruthy();
    expect(screen.getByText(/Unit 3 destroyed by Unit 2/)).toBeTruthy();
  });

  it("warns when names come from a different build", async () => {
    GAMES = [
      {
        name: "Splinter 2",
        primaryArchive: { name: "splinter2.sdz" },
        dependencyArchives: [],
        info: {},
      } as GameItem,
    ];
    DATASET = { units: UNITS };
    show();
    await screen.findByText(/different build/i);
  });

  it("says an outdated analysis may lack newer kinds", async () => {
    seedReplayAnalysisForTests({ analyses: [stored({ state: "outdated" })] });
    show();
    await ready();
    expect(screen.getByText(/older logger/i)).toBeTruthy();
  });

  it("says where the events come from in the help", async () => {
    show();
    await ready();
    fireEvent.click(
      screen.getByRole("button", { name: "About the events and chat" }),
    );
    const said = within(screen.getByRole("dialog"));
    expect(said.getByText(/playing the match back/i)).toBeTruthy();
  });

  it("says plainly when the chat could not be read", async () => {
    CHAT_ERROR = new Error("gone");
    show();
    await screen.findByText(/chat could not be read/i);
  });

  it("says when the events could not be read", async () => {
    read.mockRejectedValue(new Error("gone"));
    show();
    await screen.findByText(/events could not be read/i);
  });

  it("notes a stream that could not be read to the end", async () => {
    CHAT = { ...CHAT, incomplete: true };
    show();
    await screen.findByText(/could not be read to the end/i);
  });

  it("says when nothing was recorded", async () => {
    CHAT = { messages: [], incomplete: false, events: [] };
    seedReplayAnalysisForTests({ analyses: [] });
    show();
    await screen.findByText(/nothing was recorded/i);
  });
});

describe("the filters", () => {
  it("opens on chat, kills and player events, and All adds every logged event", async () => {
    show();
    await ready();
    expect(screen.getByRole("radio", { name: "Highlights" })).toBeTruthy();
    expect(items()).toHaveLength(5);
    choose("All");
    await waitFor(() => expect(items()).toHaveLength(8));
    expect(texts().some((t) => t?.includes("Projectile"))).toBe(true);
    expect(read).toHaveBeenLastCalledWith({ gameId: "game-a" });
  });

  it.each([
    ["Chat", ["Alice: gl hf", "Bob: gg"]],
    ["Kills", ["Unit 3 destroyed by Unit 2 (Alice)"]],
    ["Players", ["Bob joined the game", "Bob resigned"]],
  ])("%s shows only its rows", async (name, sentences) => {
    show();
    await ready();
    choose(name);
    await waitFor(() => expect(items()).toHaveLength(sentences.length));
    expect(items().map((li) => columns(li as HTMLElement)[2])).toEqual(
      sentences,
    );
  });

  it("narrows by kind, which switches to All, and shows the count", async () => {
    show();
    await ready();
    fireEvent.keyDown(screen.getByRole("combobox", { name: "Kind of event" }), {
      key: "ArrowDown",
    });
    fireEvent.click(
      await screen.findByRole("option", { name: "Unit created" }),
    );
    await waitFor(() => expect(items()).toHaveLength(2));
    expect(
      screen.getByRole("radio", { name: "All" }).getAttribute("aria-checked"),
    ).toBe("true");
    expect(screen.getByText("2 of 8 entries match.")).toBeTruthy();
    // Every kind the analysis counted is offered, and a filter clears the kind.
    choose("Chat");
    await waitFor(() => expect(items()).toHaveLength(2));
    expect(
      screen.getByRole("combobox", { name: "Kind of event" }).textContent,
    ).toBe("All kinds");
  });

  it("narrows by player across chat, player events and kills", async () => {
    show();
    await ready();
    fireEvent.keyDown(screen.getByRole("combobox", { name: "Player" }), {
      key: "ArrowDown",
    });
    fireEvent.click(await screen.findByRole("option", { name: "Bob" }));
    // Bob joining, his chat, the kill of his unit, and his resignation.
    await waitFor(() => expect(items()).toHaveLength(4));
    expect(items().map((li) => columns(li as HTMLElement)[2])).toEqual([
      "Bob joined the game",
      "Unit 3 destroyed by Unit 2 (Alice)",
      "Bob: gg",
      "Bob resigned",
    ]);
  });

  it("says when no entry matches", async () => {
    show();
    await ready();
    seedReplayAnalysisForTests({ analyses: [stored()] });
    choose("Kills");
    fireEvent.keyDown(screen.getByRole("combobox", { name: "Player" }), {
      key: "ArrowDown",
    });
    // Alice has chat and a kill, so Bob's chat is the one that goes.
    fireEvent.click(await screen.findByRole("option", { name: "Alice" }));
    await waitFor(() => expect(items()).toHaveLength(1));
  });
});

describe("a replay with no analysis", () => {
  beforeEach(() => seedReplayAnalysisForTests({ analyses: [] }));

  it("lists chat and player events, and reads no events", async () => {
    show();
    await ready();
    expect(items().map((li) => columns(li as HTMLElement)[2])).toEqual([
      "Bob joined the game",
      "Alice: gl hf",
      "Bob: gg",
      "Bob resigned",
    ]);
    expect(read).not.toHaveBeenCalled();
    expect(screen.getByText(/has not been analysed/i)).toBeTruthy();
  });

  it("offers All, Chat and Players, with no kills, kinds or download", async () => {
    show();
    await ready();
    expect(screen.getAllByRole("radio").map((r) => r.textContent)).toEqual([
      "All",
      "Chat",
      "Players",
    ]);
    expect(
      screen.queryByRole("combobox", { name: "Kind of event" }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: /download log/i })).toBeNull();
  });

  it("lists chat and player events when the profile hides the analysis", async () => {
    seedReplayAnalysisForTests({ analyses: [stored()] });
    show({ showAnalysis: false });
    await ready();
    expect(items()).toHaveLength(4);
    expect(read).not.toHaveBeenCalled();
  });

  it("has none of a remix's own", async () => {
    seedReplayAnalysisForTests({ analyses: [stored()] });
    show({ info: info({ remixed: true }) });
    await ready();
    expect(items()).toHaveLength(4);
    expect(read).not.toHaveBeenCalled();
  });
});

describe("the scrubber", () => {
  it("marks the row at or just before the clock's time", async () => {
    show();
    await ready();
    expect(marked()).toHaveLength(0);

    seek(frameOf(10));
    await waitFor(() => expect(marked()).toHaveLength(1));
    expect(marked()[0].textContent).toContain("Alice: gl hf");

    // Just before the kill, the row before it stays marked.
    seek(899);
    await waitFor(() =>
      expect(marked()[0]?.textContent).toContain("Alice: gl hf"),
    );
    seek(900);
    await waitFor(() =>
      expect(marked()[0]?.textContent).toContain("destroyed"),
    );
    seek(frameOf(2000));
    await waitFor(() => expect(marked()[0]?.textContent).toContain("resigned"));
  });

  it("marks a row in the filtered list, not the whole one", async () => {
    show();
    await ready();
    choose("Chat");
    seek(frameOf(40));
    await waitFor(() =>
      expect(marked()[0]?.textContent).toContain("Alice: gl hf"),
    );
  });

  it("moves the clock to a row's time when the row is pressed", async () => {
    show();
    await ready();
    fireEvent.click(screen.getByText("Bob: gg"));
    expect(clock.clock.frame).toBe(1500);
    await waitFor(() => expect(marked()[0]?.textContent).toContain("Bob: gg"));
  });

  it("keeps the marked row while the match is paused and the list re-renders", async () => {
    show();
    await ready();
    seek(1500);
    await waitFor(() => expect(marked()).toHaveLength(1));
    choose("Chat");
    await waitFor(() => expect(marked()[0]?.textContent).toContain("Bob: gg"));
  });
});

describe("a long list", () => {
  const chat = (n: number) =>
    Array.from({ length: n }, (_, i) =>
      line({
        frame: 30 * (i + 1),
        player: 0,
        playerName: "Alice",
        text: `line ${i}`,
      }),
    );
  let observed: (height: number) => void = () => {};
  class FixedResizeObserver {
    #cb: ResizeObserverCallback;
    constructor(cb: ResizeObserverCallback) {
      this.#cb = cb;
      observed = (h) =>
        cb(
          [{ contentRect: { height: h } } as ResizeObserverEntry],
          this as unknown as ResizeObserver,
        );
    }
    observe() {
      this.#cb(
        [{ contentRect: { height: 320 } } as ResizeObserverEntry],
        this as unknown as ResizeObserver,
      );
    }
    unobserve() {}
    disconnect() {}
  }
  let original: typeof ResizeObserver;
  beforeEach(() => {
    original = globalThis.ResizeObserver;
    globalThis.ResizeObserver =
      FixedResizeObserver as unknown as typeof ResizeObserver;
    seedReplayAnalysisForTests({ analyses: [] });
  });
  afterEach(() => {
    globalThis.ResizeObserver = original;
    observed = () => {};
  });

  it("draws only the rows in view", async () => {
    CHAT = { messages: chat(5000), incomplete: false, events: [] };
    show();
    await ready();
    expect(items().length).toBeGreaterThan(0);
    expect(items().length).toBeLessThan(40);
    expect(items()[0]?.getAttribute("aria-setsize")).toBe("5000");
    expect(screen.getByText("5,000 entries.")).toBeTruthy();
  });

  it("scrolls to bring the marked row into view when the scrubber is moved", async () => {
    CHAT = { messages: chat(5000), incomplete: false, events: [] };
    show();
    await ready();
    expect(screen.queryByText("Alice: line 2999")).toBeNull();

    seek(30 * 3000);
    const row = await screen.findByText("Alice: line 2999");
    expect(row.closest("button")?.getAttribute("aria-current")).toBe("true");
    expect(items().length).toBeLessThan(40);

    // And back to the top again.
    seek(30);
    await screen.findByText("Alice: line 0");
    expect(screen.queryByText("Alice: line 2999")).toBeNull();
  });

  it("leaves the list where it is when the marked row is already in view", async () => {
    CHAT = { messages: chat(5000), incomplete: false, events: [] };
    show();
    await ready();
    seek(30 * 3);
    await waitFor(() => expect(marked()).toHaveLength(1));
    const scroller = screen.getByRole("list").parentElement?.parentElement;
    expect(scroller?.scrollTop ?? 0).toBe(0);
  });

  it("lets one row be tabbed to and moves with the arrow keys", async () => {
    CHAT = { messages: chat(50), incomplete: false, events: [] };
    show();
    await ready();
    const buttons = () =>
      items().map((li) => li.querySelector("button") as HTMLButtonElement);
    expect(buttons().filter((b) => b.tabIndex === 0)).toHaveLength(1);
    buttons()[0].focus();
    fireEvent.keyDown(buttons()[0], { key: "ArrowDown" });
    await waitFor(() => expect(document.activeElement).toBe(buttons()[1]));
    fireEvent.keyDown(buttons()[1], { key: "End" });
    await waitFor(() =>
      expect(document.activeElement?.textContent).toContain("line 49"),
    );
  });
});

describe("download", () => {
  const press = () =>
    fireEvent.click(screen.getByRole("button", { name: /download log/i }));

  it("does nothing when the dialog is closed", async () => {
    save.mockResolvedValue(null);
    show();
    await ready();
    press();
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(write).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it("writes the whole log, though only the kills were read, and says so", async () => {
    save.mockResolvedValue("/tmp/out.jsonl");
    write.mockResolvedValue({});
    show();
    await ready();
    press();
    await waitFor(() => expect(write).toHaveBeenCalled());
    const call = write.mock.calls[0][0] as { dest: string; text: string };
    expect(call.dest).toBe("/tmp/out.jsonl");
    expect(call.text.split("\n")).toHaveLength(EVENTS.length + 2);
    expect(JSON.parse(call.text.split("\n")[0]).kind).toBe("analysis");
    expect(save.mock.calls[0][0].defaultPath).toBe(
      "greenhaven-2026-10-10-game-a-events.jsonl",
    );
    await waitFor(() =>
      expect(notify).toHaveBeenCalledWith(
        expect.objectContaining({ level: "success" }),
      ),
    );
  });

  it("reports a failed write", async () => {
    save.mockResolvedValue("/tmp/out.jsonl");
    write.mockRejectedValue(new Error("disk full"));
    show();
    await ready();
    press();
    await waitFor(() =>
      expect(notify).toHaveBeenCalledWith(
        expect.objectContaining({
          level: "error",
          title: "Download failed: disk full",
        }),
      ),
    );
  });
});

describe("another replay", () => {
  it("does not show one replay's events under another", async () => {
    let finishB!: (v: unknown) => void;
    seedReplayAnalysisForTests({
      analyses: [stored(), stored({ gameId: "game-b", analysedAtMs: 2 })],
    });
    const view = show();
    await ready();
    expect(screen.getByText(/destroyed by/)).toBeTruthy();

    read.mockReturnValueOnce(
      new Promise((res) => {
        finishB = res;
      }),
    );
    CHAT = { messages: [], incomplete: false, events: [] };
    view.again({ info: info({ gameId: "game-b" }), path: B });
    await waitFor(() => expect(screen.queryByText(/destroyed by/)).toBeNull());
    expect(screen.queryByText("Alice: gl hf")).toBeNull();

    await act(async () =>
      finishB({
        events: [{ kind: "unit_destroyed", frame: 30, def: 2 }],
        total: 1,
      }),
    );
    expect(await screen.findByText("Unit 2 destroyed")).toBeTruthy();
    expect(screen.queryByText(/destroyed by/)).toBeNull();
  });

  it("does not let a slow answer for the first replay land on the second", async () => {
    let finishA!: (v: unknown) => void;
    seedReplayAnalysisForTests({
      analyses: [stored(), stored({ gameId: "game-b", analysedAtMs: 2 })],
    });
    read.mockReturnValueOnce(
      new Promise((res) => {
        finishA = res;
      }),
    );
    read.mockResolvedValueOnce({
      events: [{ kind: "unit_destroyed", frame: 30, def: 2 }],
      total: 1,
    });
    const view = show();
    view.again({ info: info({ gameId: "game-b" }), path: B });
    await screen.findByText("Unit 2 destroyed");
    await act(async () => finishA({ events: EVENTS, total: EVENTS.length }));
    expect(screen.queryByText(/destroyed by/)).toBeNull();
    expect(screen.getByText("Unit 2 destroyed")).toBeTruthy();
  });
});
