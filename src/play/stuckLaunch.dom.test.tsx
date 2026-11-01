// @vitest-environment happy-dom

/**
 * Being told a game is running when nothing is. Only an engine process that is
 * really there may count as a game, and whatever coilbox shows has to come with a
 * way out. These drive the real provider and the pill together, with Rust's answers
 * stood in for, because the bug is in how those answers and the launch line up.
 */

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { BattleConfig, LaunchEvent } from "@/play/bindings";
import InGameBadge from "./InGameBadge";
import { PlayProvider, usePlay } from "./PlayProvider";

vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PopoverTrigger: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  PopoverContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}));

interface Launched {
  runId: string;
  started: () => void;
  finish: () => void;
}
const launched: Launched[] = [];

const { playCancel, playStatus, mpRelayTraffic, contentState } = vi.hoisted(
  () => ({
    playCancel: vi.fn(async () => ({ cancelled: true })),
    playStatus: vi.fn(async () => ({ runs: [] as string[] })),
    mpRelayTraffic: vi.fn(async () => ({
      relaying: false,
      bytesPerSecond: null as number | null,
    })),
    contentState: vi.fn(async () => {
      throw new Error("not read in these tests");
    }),
  }),
);

vi.mock("@/play/bindings", () => ({
  playCancel,
  playStatus,
  playFocus: vi.fn(async () => ({ focused: false })),
  playLaunchReplay: vi.fn(),
  playLaunchSave: vi.fn(),
  playLaunch: vi.fn(
    (args: {
      runId: string;
      onEvent: { onmessage: (e: LaunchEvent) => void };
    }) =>
      new Promise((resolve) => {
        launched.push({
          runId: args.runId,
          started: () => args.onEvent.onmessage({ kind: "started" }),
          finish: () => resolve({ exitCode: 0, signal: null }),
        });
      }),
  ),
}));
vi.mock("@/multiplayer/bindings", () => ({ mpRelayTraffic }));
vi.mock("@/content/contentState", () => ({
  refreshContentState: contentState,
}));
vi.mock("@/content/bindings", () => ({
  contentReplayPlaybackLaunch: vi.fn(),
}));
vi.mock("@/notify/notify", () => ({ notify: vi.fn(async () => {}) }));
vi.mock("@/play/pages/components/CrashDrawer", () => ({
  CrashDrawer: () => null,
}));
vi.mock("@/play/useCrashTriage", () => ({
  useCrashTriage: () => ({
    triage: null,
    open: false,
    setOpen: vi.fn(),
    inspect: vi.fn(async () => {}),
  }),
}));

const config = { gameType: "g", mapName: "m" } as BattleConfig;

/** The launch answers, newest last, and whether the provider says it is running. */
const outcomes: string[] = [];

function Screen() {
  const { launch, running } = usePlay();
  return (
    <>
      <button
        type="button"
        onClick={() => {
          launch("skirmish", {
            config,
            executable: "/engines/spring",
            dataDir: "/data",
          }).then(
            (o) => outcomes.push(`done ${o.exitCode}`),
            (e: Error) => outcomes.push(e.message),
          );
        }}
      >
        launch
      </button>
      <output>{running ? "running" : "not running"}</output>
      <InGameBadge />
    </>
  );
}

async function draw() {
  await act(async () => {
    render(
      <PlayProvider>
        <Screen />
      </PlayProvider>,
    );
  });
}

function press() {
  fireEvent.click(screen.getByText("launch"));
}

async function engineSpawned(index = 0): Promise<Launched> {
  await waitFor(() => expect(launched.length).toBe(index + 1));
  const run = launched[index];
  if (!run) throw new Error("no launch was made");
  return run;
}

beforeEach(() => {
  launched.length = 0;
  outcomes.length = 0;
  playStatus.mockResolvedValue({ runs: [] });
  mpRelayTraffic.mockResolvedValue({ relaying: false, bytesPerSecond: null });
  contentState.mockImplementation(async () => {
    throw new Error("not read in these tests");
  });
  (
    globalThis as unknown as { window: Record<string, unknown> }
  ).window.__TAURI_INTERNALS__ = {
    transformCallback: (cb: unknown) => cb,
  };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("does not count getting ready as being in game", async () => {
  await draw();
  const never = new Promise<never>(() => {});
  contentState.mockReturnValue(never);

  press();

  await screen.findByText("Starting game");
  expect(screen.getByText("not running")).toBeTruthy();
  expect(screen.queryByText("In game")).toBeNull();
});

it("says a launch is starting, not that a game runs, to a second press", async () => {
  await draw();
  contentState.mockReturnValue(new Promise<never>(() => {}));
  press();
  await screen.findByText("Starting game");

  press();

  await waitFor(() =>
    expect(outcomes).toEqual(["A launch is already starting."]),
  );
});

it("lets the player give up on a launch that stalls, then launch again", async () => {
  await draw();
  contentState.mockReturnValueOnce(new Promise<never>(() => {}));
  press();
  await screen.findByText("Starting game");

  fireEvent.click(screen.getByRole("button", { name: "Cancel launch" }));
  expect(screen.queryByText("Starting game")).toBeNull();

  press();
  const run = await engineSpawned();
  act(() => run.started());
  await screen.findByText("In game");
});

it("starts no engine for a launch the player gave up on", async () => {
  await draw();
  let ready: () => void = () => {};
  contentState.mockReturnValueOnce(
    new Promise<never>((_, reject) => {
      ready = () => reject(new Error("read failed"));
    }),
  );
  press();
  await screen.findByText("Starting game");
  fireEvent.click(screen.getByRole("button", { name: "Cancel launch" }));

  await act(async () => ready());

  await waitFor(() => expect(outcomes).toEqual(["done null"]));
  expect(launched).toEqual([]);
});

it("ends an engine that appears after the player gave up on it", async () => {
  await draw();
  press();
  const run = await engineSpawned();
  fireEvent.click(screen.getByRole("button", { name: "Cancel launch" }));

  act(() => run.started());

  expect(playCancel).toHaveBeenCalledWith({ runId: run.runId });
  expect(screen.queryByText("In game")).toBeNull();
});

it("only says in game once the engine exists", async () => {
  await draw();
  press();
  const run = await engineSpawned();
  expect(screen.getByText("not running")).toBeTruthy();

  act(() => run.started());

  await screen.findByText("In game");
  expect(screen.getByText("running")).toBeTruthy();
});

it("clears a badge whose engine has gone instead of refusing the launch", async () => {
  await draw();
  press();
  const stuck = await engineSpawned();
  act(() => stuck.started());
  await screen.findByText("In game");
  // The launch promise never settles, and Rust says nothing is up.

  press();

  const next = await engineSpawned(1);
  expect(next.runId).not.toBe(stuck.runId);
  expect(outcomes).toEqual([]);
});

it("still refuses while the engine is really there", async () => {
  await draw();
  press();
  const run = await engineSpawned();
  act(() => run.started());
  await screen.findByText("In game");
  playStatus.mockResolvedValue({ runs: [run.runId] });

  press();

  await waitFor(() => expect(outcomes).toEqual(["a game is already running"]));
  expect(launched.length).toBe(1);
});

it("finds a game still running after a reload, with an X to end it", async () => {
  playStatus.mockResolvedValue({ runs: ["from-before"] });

  await draw();

  await screen.findByText("In game");
  fireEvent.click(screen.getByRole("button", { name: "End game" }));
  expect(playCancel).toHaveBeenCalledWith({ runId: "from-before" });
  expect(screen.queryByText("In game")).toBeNull();
});

it("clears a game found after a reload once its engine exits", async () => {
  playStatus.mockResolvedValue({ runs: ["from-before"] });
  await draw();
  await screen.findByText("In game");

  playStatus.mockResolvedValue({ runs: [] });

  await waitFor(() => expect(screen.queryByText("In game")).toBeNull(), {
    timeout: 3000,
  });
});

it("asks before ending a game found after a reload if a relay is up", async () => {
  playStatus.mockResolvedValue({ runs: ["from-before"] });
  mpRelayTraffic.mockResolvedValue({ relaying: true, bytesPerSecond: 1024 });

  await draw();

  await screen.findByText(/ends it for everybody playing in it/);
});

it("shows an engine it did not know about when one refuses a launch", async () => {
  await draw();
  playStatus.mockResolvedValue({ runs: ["from-before"] });

  press();

  await waitFor(() => expect(outcomes).toEqual(["a game is already running"]));
  await screen.findByText("In game");
  expect(launched).toEqual([]);
});
