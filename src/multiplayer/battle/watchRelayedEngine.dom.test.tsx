// @vitest-environment happy-dom

/**
 * Which launches name their engine to the relay sidecar, driven through the
 * real `PlayProvider` rather than by calling the callback by hand.
 *
 * The sidecar stops relaying when the process it was told to watch exits, so
 * these are two separate failures with two different costs. Not telling it
 * leaves a relay server holding a port and its bandwidth for the four minutes
 * of the sidecar's traffic backstop. Telling it about a game that has nothing
 * to do with the relay puts an unrelated process in charge of when somebody
 * else's match ends. So the tests below ask both questions: that a relayed
 * host says which run it started, and that nothing else says anything at all.
 *
 * The run id is what makes the first of those worth asserting. A test that
 * only checked the call happened would pass on a version that sent the wrong
 * run, and the wrong run is the whole hazard.
 */

import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { recordHostingRoute } from "@/direct/hostingRoute";
import type { LaunchEvent } from "@/play/bindings";
import type { PlayTarget } from "@/play/config";
import { PlayProvider } from "@/play/PlayProvider";
import { useBattleLaunch } from "./useBattleLaunch";

/** The launch arguments the fake `play_launch` was handed, one per launch. */
interface Launched {
  runId: string;
  started: () => void;
  exited: () => void;
  finish: () => void;
}

const launched: Launched[] = [];

vi.mock("@/play/bindings", () => ({
  playCancel: vi.fn(async () => ({ cancelled: false })),
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
            exited: () => args.onEvent.onmessage({ kind: "exited", code: 0 }),
            finish: () => resolve({ exitCode: 0, signal: null }),
          });
        },
      ),
  ),
}));

const { mpWatchEngine } = vi.hoisted(() => ({
  mpWatchEngine: vi.fn(async () => ({ watching: true })),
}));

vi.mock("../bindings", () => ({
  mpBuildHostConfig: vi.fn(async () => ({
    config: { gameType: "g", mapName: "m" },
  })),
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
  mpWatchEngine,
}));

// Everything the launch path touches on its way past that is not the subject
// here: the replay snapshot either side of a run, and the settings-backed store
// it would file provenance in.
vi.mock("@/content/bindings", () => ({
  contentListReplays: vi.fn(async () => ({ replays: [] })),
}));
vi.mock("@/content/replayUserState", () => ({
  useReplayUserState: () => ({ setProvenance: vi.fn() }),
}));
vi.mock("@/play/tagReplayProvenance", () => ({ tagFreshReplay: vi.fn() }));
vi.mock("@/notify/notify", () => ({ notify: vi.fn(async () => {}) }));
// The crash drawer opens on a bad exit and drags the whole settings tree in
// with it. Nothing here exits badly.
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

/** Starts a battle the moment it renders, the way the host's Start button does. */
function Launcher({ host }: { host: boolean }) {
  const { launch } = useBattleLaunch("alice@bar:8200", target, host);
  return (
    <button type="button" onClick={() => void launch()}>
      start
    </button>
  );
}

/** Render, press start, and wait for the engine to have been launched. */
async function launchBattle(host: boolean): Promise<Launched> {
  const { getByText } = render(
    <PlayProvider>
      <Launcher host={host} />
    </PlayProvider>,
  );
  getByText("start").click();
  await waitFor(() => expect(launched).toHaveLength(1));
  const run = launched[0];
  if (!run) throw new Error("no launch was made");
  return run;
}

beforeEach(() => {
  launched.length = 0;
  // `Channel` asks Tauri for a callback id the moment it is built, and there is
  // no Tauri behind a test. The provider only reads messages back out of the
  // channel it made, so handing the callback straight back is enough.
  (
    globalThis as unknown as { window: Record<string, unknown> }
  ).window.__TAURI_INTERNALS__ = {
    transformCallback: (cb: unknown) => cb,
  };
});

afterEach(() => {
  cleanup();
  recordHostingRoute(null);
  vi.clearAllMocks();
});

it("names the run it started to the sidecar when the battle is relayed", async () => {
  recordHostingRoute("relay");

  const run = await launchBattle(true);
  run.started();

  await waitFor(() =>
    expect(mpWatchEngine).toHaveBeenCalledWith({ runId: run.runId }),
  );
  expect(mpWatchEngine).toHaveBeenCalledTimes(1);
});

it("waits for the engine to exist rather than firing on any news of it", async () => {
  recordHostingRoute("relay");

  const run = await launchBattle(true);
  expect(mpWatchEngine).not.toHaveBeenCalled();

  // An engine that has ended is not one to watch, and Rust would have no pid to
  // answer with anyway. Only `started` says a process is there to be named.
  run.exited();
  expect(mpWatchEngine).not.toHaveBeenCalled();

  run.started();
  await waitFor(() => expect(mpWatchEngine).toHaveBeenCalledTimes(1));
});

it("says nothing for a battle hosted without the relay", async () => {
  recordHostingRoute("direct");

  const run = await launchBattle(true);
  run.started();
  run.finish();

  await waitFor(() => expect(launched).toHaveLength(1));
  expect(mpWatchEngine).not.toHaveBeenCalled();
});

it("says nothing for a game this coilbox is only joining", async () => {
  // A joiner in somebody else's relayed battle. The route was recorded by
  // whoever last hosted here, and it is not this game's.
  recordHostingRoute("relay");

  const run = await launchBattle(false);
  run.started();
  run.finish();

  await waitFor(() => expect(launched).toHaveLength(1));
  expect(mpWatchEngine).not.toHaveBeenCalled();
});
