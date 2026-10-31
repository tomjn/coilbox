// @vitest-environment happy-dom

/**
 * What coilbox keeps of a finished Open Annihilation match (issue #4948): the
 * `game_over` results and the hello line's version, written where `oaRun` sees
 * them and read back whatever page is showing.
 *
 * No real OA match has run for these. The `game_over` line's shape is the one
 * OA's documentation gives.
 */

import { memoryStorage, PersistentStoreProvider } from "@picoframe/frame";
import { act, cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OaEvent } from "../play/bindings";

const { FakeChannel } = vi.hoisted(() => ({
  FakeChannel: class {
    onmessage: (event: unknown) => void = () => {};
  },
}));
type FakeChannel<T> = { onmessage: (event: T) => void };
vi.mock("@tauri-apps/api/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tauri-apps/api/core")>()),
  Channel: FakeChannel,
}));

const bindings = vi.hoisted(() => ({
  playOaLaunch: vi.fn(),
  playOaCancel: vi.fn(),
}));
vi.mock("../play/bindings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../play/bindings")>()),
  ...bindings,
}));

import { OaMatchKeeper } from "./OaMatchKeeper";
import {
  OA_MATCHES_KEY,
  type OaMatchRecord,
  resetOaMatches,
  useOaMatches,
} from "./oaMatches";
import { cancelOaRun, startOaRun } from "./oaRun";

type Launch = {
  onEvent: FakeChannel<OaEvent>;
  finish: (outcome: { exitCode: number | null; signal: number | null }) => void;
};
let launched: Launch[] = [];
let storage = memoryStorage();

const battle = { serverKey: "me@server:8200", battleId: 4021 };

const hello = {
  kind: "hello",
  version: "Open Annihilation 0.8.10 (abc)",
  pid: 4242,
  status: 1,
} as OaEvent;

const gameOver = {
  kind: "gameOver",
  seq: 9,
  frame: 5400,
  tick: 5400,
  outcome: "victory",
  winner: 1,
  results: [
    {
      slot: 0,
      name: "Tom",
      team: 1,
      side: "arm",
      outcome: "won",
      units: 12,
      kills: 30,
      losses: 4,
    },
    {
      slot: 1,
      name: "Ann",
      team: 2,
      side: "core",
      outcome: "lost",
      units: 0,
      kills: 4,
      losses: 30,
      rank: "gold",
    },
  ],
} as OaEvent;

function wrapper({ children }: { children: ReactNode }) {
  return (
    <PersistentStoreProvider storage={storage}>
      {children}
    </PersistentStoreProvider>
  );
}

/** What the page's `useOaMatches` shows right now. */
let shown: OaMatchRecord[] = [];
function Page() {
  shown = useOaMatches();
  return null;
}

/** The keeper and, while `page` is true, a page reading the matches, on one store. */
function tree(page: boolean) {
  return (
    <PersistentStoreProvider storage={storage}>
      <OaMatchKeeper />
      {page && <Page />}
    </PersistentStoreProvider>
  );
}

/** Start a run and let it hold until the test says OA exited. */
async function run() {
  const ended = vi.fn();
  void startOaRun({
    executable: "/oa/open-annihilation",
    args: ["--join", "203.0.113.9"],
    battle,
    onEnd: ended,
  });
  await vi.waitFor(() => expect(launched).toHaveLength(1));
  return { launch: launched[0], ended };
}

const stored = (): OaMatchRecord[] =>
  JSON.parse(storage.get(OA_MATCHES_KEY) ?? "[]");

beforeEach(() => {
  launched = [];
  storage = memoryStorage();
  resetOaMatches();
  bindings.playOaCancel.mockReset().mockImplementation(async () => {
    // A cancel kills OA with no exit event: the launch resolves with no code.
    for (const l of launched) l.finish({ exitCode: null, signal: null });
    return { cancelled: true };
  });
  bindings.playOaLaunch.mockReset().mockImplementation(
    (a: { onEvent: FakeChannel<OaEvent> }) =>
      new Promise((resolve) => {
        launched.push({ onEvent: a.onEvent, finish: resolve });
      }),
  );
});
afterEach(async () => {
  cleanup();
  shown = [];
  await act(async () => {
    for (const l of launched) l.finish({ exitCode: 0, signal: null });
  });
});

describe("keeping a finished Open Annihilation match", () => {
  it("stores both players' results with the hello version, and reads them back", async () => {
    render(tree(true));
    const { launch } = await run();

    act(() => launch.onEvent.onmessage(hello));
    act(() => launch.onEvent.onmessage({ kind: "match", change: "started" }));
    expect(shown).toEqual([]);
    act(() => launch.onEvent.onmessage(gameOver));

    expect(shown).toHaveLength(1);
    const [match] = shown;
    expect(match).toMatchObject({
      serverKey: battle.serverKey,
      battleId: battle.battleId,
      version: "Open Annihilation 0.8.10 (abc)",
      outcome: "victory",
      winner: 1,
      frame: 5400,
    });
    expect(match.finishedAt).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect(match.results).toEqual([
      {
        slot: 0,
        name: "Tom",
        team: 1,
        side: "arm",
        outcome: "won",
        units: 12,
        kills: 30,
        losses: 4,
        extra: {},
      },
      {
        slot: 1,
        name: "Ann",
        team: 2,
        side: "core",
        outcome: "lost",
        units: 0,
        kills: 4,
        losses: 30,
        extra: { rank: "gold" },
      },
    ]);
    // The setting is what a later feature reads.
    expect(stored()).toEqual(shown);
  });

  it("keeps the match after the page that started the run is gone", async () => {
    const view = render(tree(true));
    const { launch } = await run();
    view.rerender(tree(false));

    act(() => launch.onEvent.onmessage(gameOver));
    expect(stored()).toHaveLength(1);

    view.rerender(tree(true));
    expect(shown).toHaveLength(1);
  });

  it("keeps the match when a cancel follows the game over", async () => {
    render(<OaMatchKeeper />, { wrapper });
    const { launch, ended } = await run();
    act(() => launch.onEvent.onmessage(gameOver));

    await act(async () => cancelOaRun());
    await vi.waitFor(() => expect(ended).toHaveBeenCalledTimes(1));
    expect(stored()).toHaveLength(1);
    expect(stored()[0].results.map((r) => r.outcome)).toEqual(["won", "lost"]);
  });

  it("holds a match that finishes before anything can write it", async () => {
    const { launch } = await run();
    act(() => launch.onEvent.onmessage(gameOver));
    expect(storage.get(OA_MATCHES_KEY)).toBeNull();

    render(<OaMatchKeeper />, { wrapper });
    expect(stored()).toHaveLength(1);
  });

  it("appends a second match and keeps the first", async () => {
    render(<OaMatchKeeper />, { wrapper });
    const { launch } = await run();
    act(() => launch.onEvent.onmessage(gameOver));
    act(() =>
      launch.onEvent.onmessage({
        ...gameOver,
        outcome: "defeat",
      } as unknown as OaEvent),
    );
    const matches = stored();
    expect(matches.map((m) => m.outcome)).toEqual(["victory", "defeat"]);
    expect(new Set(matches.map((m) => m.id)).size).toBe(2);
  });

  it("keeps what it can of a game over that is not shaped as documented", async () => {
    render(<OaMatchKeeper />, { wrapper });
    const { launch } = await run();
    act(() =>
      launch.onEvent.onmessage({
        kind: "gameOver",
        outcome: 7,
        winner: null,
        mode: "ffa",
        results: ["junk", { name: "Ann", kills: "many", rank: 3 }],
      } as unknown as OaEvent),
    );
    // The backend sends a game over with no results list as `unknown`.
    act(() =>
      launch.onEvent.onmessage({
        kind: "unknown",
        event: "game_over",
        outcome: "defeat",
        results: "gone",
      } as unknown as OaEvent),
    );

    const [odd, noList] = stored();
    expect(odd).toMatchObject({
      version: null,
      outcome: null,
      winner: null,
      frame: null,
      extra: { mode: "ffa" },
    });
    expect(odd.results).toEqual([
      {
        slot: null,
        name: "Ann",
        team: null,
        side: null,
        outcome: null,
        units: null,
        kills: null,
        losses: null,
        extra: { rank: 3 },
      },
    ]);
    expect(noList).toMatchObject({ outcome: "defeat", results: [] });
  });

  it("records nothing for lines that are not a game over", async () => {
    render(<OaMatchKeeper />, { wrapper });
    const { launch } = await run();
    for (const event of [
      hello,
      { kind: "screen", name: "mp_battleroom" },
      { kind: "match", change: "ended" },
      { kind: "exit", reason: "game-ended" },
      { kind: "unknown", event: "something_new" },
    ] as OaEvent[]) {
      act(() => launch.onEvent.onmessage(event));
    }
    expect(storage.get(OA_MATCHES_KEY)).toBeNull();
  });

  it("still hands the game over to the caller's own handler", async () => {
    render(<OaMatchKeeper />, { wrapper });
    const seen: OaEvent[] = [];
    void startOaRun({
      executable: "/oa/open-annihilation",
      args: [],
      battle,
      onEvent: (e) => seen.push(e),
    });
    await vi.waitFor(() => expect(launched).toHaveLength(1));
    act(() => launched[0].onEvent.onmessage(gameOver));
    expect(seen).toEqual([gameOver]);
  });
});
