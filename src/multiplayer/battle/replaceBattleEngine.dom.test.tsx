// @vitest-environment happy-dom

/**
 * A new match the server sends us to stops the battle engine we already have
 * up, driven through the real `PlayProvider`.
 *
 * The case is a Zero-K spectator still loading a match that ends, after which
 * the room picks a map and starts the next. Chobby launches the new match over
 * the old one. Coilbox refused it as "a game is already running", leaving the
 * player loading a match that no longer existed.
 */

import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { LaunchEvent } from "@/play/bindings";
import type { PlayTarget } from "@/play/config";
import { PlayProvider, usePlay } from "@/play/PlayProvider";
import { useBattleLaunch } from "./useBattleLaunch";

interface Launched {
  runId: string;
  started: () => void;
  finish: (exitCode: number | null) => void;
}

const launched: Launched[] = [];

const { playCancel } = vi.hoisted(() => ({
  playCancel: vi.fn(async (_args: { runId: string }) => ({ cancelled: true })),
}));

vi.mock("@/play/bindings", () => ({
  playCancel,
  playFocus: vi.fn(async () => ({ focused: false })),
  playLaunchReplay: vi.fn(),
  playLaunchSave: vi.fn(),
  playLaunch: vi.fn(
    (args: {
      runId: string;
      onEvent: { onmessage: (e: LaunchEvent) => void };
    }) =>
      new Promise<{ exitCode: number | null; signal: number | null }>(
        (resolve) => {
          launched.push({
            runId: args.runId,
            started: () => args.onEvent.onmessage({ kind: "started" }),
            finish: (exitCode) => resolve({ exitCode, signal: null }),
          });
        },
      ),
  ),
}));

vi.mock("../bindings", () => ({
  mpBuildHostConfig: vi.fn(),
  mpBuildBattleConfig: vi.fn(async () => ({
    config: {
      gameType: "g",
      mapName: "m",
      hostIp: "198.51.100.4",
      hostPort: 8452,
    },
    natType: "0",
  })),
  mpProbeHost: vi.fn(async () => ({ outcome: "silent" })),
  mpWatchEngine: vi.fn(),
}));

vi.mock("@/content/bindings", () => ({
  contentListReplays: vi.fn(async () => ({ replays: [] })),
}));
vi.mock("@/content/replayUserState", () => ({
  useReplayUserState: () => ({ setProvenance: vi.fn() }),
}));
vi.mock("@/play/tagReplayProvenance", () => ({
  tagAndIngestFreshReplay: vi.fn(),
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

const target: PlayTarget = {
  enginePath: "/engines/recoil-2026",
  executable: "/engines/recoil-2026/spring",
  dataDir: "/data",
  engineVersion: "2026.01",
};

function Room() {
  const { launch, error } = useBattleLaunch("zk@zero-k.info:8200", target);
  const { launch: playLaunch } = usePlay();
  return (
    <>
      <button type="button" onClick={() => void launch()}>
        join
      </button>
      <button type="button" onClick={() => void launch({ replace: true })}>
        next match
      </button>
      <button
        type="button"
        onClick={() =>
          void playLaunch("skirmish", {
            config: { gameType: "g", mapName: "m" } as never,
            executable: target.executable,
            dataDir: target.dataDir,
          }).catch(() => {})
        }
      >
        skirmish
      </button>
      <output>{error ?? ""}</output>
    </>
  );
}

function renderRoom() {
  return render(
    <PlayProvider>
      <Room />
    </PlayProvider>,
  );
}

beforeEach(() => {
  launched.length = 0;
  // A killed engine ends its launch with no exit code, as a signal does.
  playCancel.mockImplementation(async ({ runId }) => {
    launched.find((l) => l.runId === runId)?.finish(null);
    return { cancelled: true };
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

it("stops the engine still loading the last match and launches the new one", async () => {
  const { getByText } = renderRoom();
  getByText("join").click();
  await waitFor(() => expect(launched).toHaveLength(1));
  launched[0]?.started();

  getByText("next match").click();

  await waitFor(() => expect(launched).toHaveLength(2));
  expect(playCancel).toHaveBeenCalledWith({ runId: launched[0]?.runId });
  expect(launched[1]?.runId).not.toBe(launched[0]?.runId);
});

it("replaces a launch whose engine has not appeared yet", async () => {
  const { getByText } = renderRoom();
  getByText("join").click();
  await waitFor(() => expect(launched).toHaveLength(1));

  getByText("next match").click();

  await waitFor(() => expect(launched).toHaveLength(2));
  expect(playCancel).toHaveBeenCalledWith({ runId: launched[0]?.runId });
});

it("does not report how the replaced engine ended", async () => {
  // Windows has no signals, so a killed engine answers with an exit code.
  playCancel.mockImplementation(async ({ runId }) => {
    launched.find((l) => l.runId === runId)?.finish(1);
    return { cancelled: true };
  });
  const { getByText, container } = renderRoom();
  getByText("join").click();
  await waitFor(() => expect(launched).toHaveLength(1));
  launched[0]?.started();

  getByText("next match").click();
  await waitFor(() => expect(launched).toHaveLength(2));

  expect(container.querySelector("output")?.textContent).toBe("");
});

it("still refuses a second battle launch nobody asked to replace", async () => {
  const { getByText, container } = renderRoom();
  getByText("join").click();
  await waitFor(() => expect(launched).toHaveLength(1));
  launched[0]?.started();

  getByText("join").click();

  await waitFor(() =>
    expect(container.querySelector("output")?.textContent).toBe(
      "a game is already running",
    ),
  );
  expect(launched).toHaveLength(1);
  expect(playCancel).not.toHaveBeenCalled();
});

it("leaves a game that is not a battle running", async () => {
  const { getByText, container } = renderRoom();
  getByText("skirmish").click();
  await waitFor(() => expect(launched).toHaveLength(1));
  launched[0]?.started();

  getByText("next match").click();

  await waitFor(() =>
    expect(container.querySelector("output")?.textContent).toBe(
      "a game is already running",
    ),
  );
  expect(launched).toHaveLength(1);
  expect(playCancel).not.toHaveBeenCalled();
});
