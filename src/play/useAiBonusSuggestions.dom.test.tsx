// @vitest-environment happy-dom

/**
 * The suggestion is optional, so it loads in the background. Nothing shows
 * while the records load or if loading fails, and the page is never made to
 * wait for it.
 */

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StatRecord } from "@/content/bindings";
import type { Participant } from "./participants";

// A plain function rather than a spy: the spy's own bookkeeping on a rejected
// promise is reported as an unhandled rejection under happy-dom.
let answers: Array<() => Promise<{ records: StatRecord[] }>> = [];
let calls = 0;
const query = () => {
  calls += 1;
  const next = answers.length > 1 ? answers.shift() : answers[0];
  return (next as () => Promise<{ records: StatRecord[] }>)();
};

vi.mock("@/content/bindings", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  contentStatsQuery: () => query(),
}));
// Stands in for the frame's settings store, which needs the app frame.
vi.mock("@/content/replayUserState", () => ({
  useReplayUserState: () => ({ state: {} }),
  refightFilenames: () => new Set<string>(),
  scriptedModeFilenames: () => new Set<string>(),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: () => Promise.resolve(() => {}),
}));

const GAME = "Some Game 1";

const record: StatRecord = {
  filename: "last.sdfz",
  path: "/demos/last.sdfz",
  mapName: "Comet",
  gameType: GAME,
  engineVersion: "105",
  durationSec: 600,
  startTimeMs: 1,
  sizeBytes: 1,
  modifiedMs: 1,
  winnersKnown: true,
  winningAllyTeams: [0],
  remixed: false,
  players: [{ name: "me", allyTeam: 0, won: true, spectator: false }],
  ais: [{ name: "AI 1", shortName: "SimpleAI", allyTeam: 1, advantage: 0.1 }],
  statsKnown: false,
  teamTotals: [],
  ingestedAt: 0,
};

const participants: Participant[] = [
  {
    id: "you",
    kind: "you",
    name: "me",
    side: "",
    color: [1, 0, 0],
    allyTeam: 0,
    spectator: false,
  },
  {
    id: "a",
    kind: "ai",
    name: "a",
    ai: { kind: "native", shortName: "SimpleAI" },
    side: "",
    color: [0, 0, 1],
    allyTeam: 1,
    spectator: false,
  },
];

async function freshHook() {
  vi.resetModules();
  const { useAiBonusSuggestions } = await import("./useAiBonusSuggestions");
  return function Probe() {
    const s = useAiBonusSuggestions(participants, GAME);
    return (
      <div data-testid="out">
        {s.rows.a ? `try ${s.rows.a.percent}` : "none"}
      </div>
    );
  };
}

beforeEach(() => {
  answers = [];
  calls = 0;
});
afterEach(cleanup);

describe("useAiBonusSuggestions", () => {
  it("shows nothing while the records load, then the suggestion", async () => {
    let resolve: (v: { records: StatRecord[] }) => void = () => {};
    answers = [() => new Promise((r) => (resolve = r))];
    const Probe = await freshHook();
    render(<Probe />);
    expect(screen.getByTestId("out").textContent).toBe("none");

    await act(async () => resolve({ records: [record] }));
    expect(screen.getByTestId("out").textContent).toBe("try 20");
  });

  it("shows nothing and does not throw when loading fails", async () => {
    answers = [() => Promise.reject(new Error("store unreadable"))];
    const Probe = await freshHook();
    render(<Probe />);
    await act(async () => {});
    expect(screen.getByTestId("out").textContent).toBe("none");
  });

  it("reads the store once for a second mount in the same session", async () => {
    answers = [() => Promise.resolve({ records: [record] })];
    const Probe = await freshHook();
    const first = render(<Probe />);
    await act(async () => {});
    first.unmount();
    render(<Probe />);
    await act(async () => {});
    expect(calls).toBe(1);
  });

  it("tries again on the next mount after a failed read", async () => {
    answers = [
      () => Promise.reject(new Error("busy")),
      () => Promise.resolve({ records: [record] }),
    ];
    const Probe = await freshHook();
    const first = render(<Probe />);
    await act(async () => {});
    first.unmount();
    render(<Probe />);
    await act(async () => {});
    expect(calls).toBe(2);
    expect(screen.getByTestId("out").textContent).toBe("try 20");
  });
});
