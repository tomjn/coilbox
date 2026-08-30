// @vitest-environment happy-dom

/**
 * Which game the in-game pill's relay warning belongs to (issue #2097).
 *
 * The pill used to decide from two facts, neither of which named a game: the
 * route this client last hosted at, which nothing cleared when a battle ended,
 * and whether a relay sidecar was running on the machine at all. A sidecar can
 * outlive the game it carried by up to the four minutes of the agent's traffic
 * backstop, so a skirmish started inside that window got the relay label and an
 * X that asked whether to end the game for everybody. It ends it for nobody.
 *
 * So this drives the real launch path rather than handing the pill a prop: a
 * relayed battle, then a second run started while the backend still says a
 * relay is up, with the same `mp_relay_traffic` answer standing for both. The
 * only thing that changes between them is which run is on screen, which is the
 * whole of the fix.
 *
 * Both halves are asserted. A test that only showed the skirmish drawing
 * nothing would stay green if the pill stopped warning about relayed games too,
 * which is issue #2094 all over again and the worse of the two failures.
 */

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useBattleLaunch } from "@/multiplayer/battle/useBattleLaunch";
import type { BattleConfig, LaunchEvent } from "@/play/bindings";
import type { PlayTarget } from "@/play/config";
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

/** One launch the fake `play_launch` was handed, and its side of the channel. */
interface Launched {
  runId: string;
  started: () => void;
  finish: () => void;
}

const launched: Launched[] = [];
const { playCancel } = vi.hoisted(() => ({
  playCancel: vi.fn(async () => ({ cancelled: true })),
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
            finish: () => resolve({ exitCode: 0, signal: null }),
          });
        },
      ),
  ),
}));

const { mpRelayTraffic, mpWatchEngine } = vi.hoisted(() => ({
  mpRelayTraffic: vi.fn(async () => ({
    relaying: true,
    bytesPerSecond: 41984,
  })),
  mpWatchEngine: vi.fn(async () => ({ watching: true })),
}));

vi.mock("@/multiplayer/bindings", () => ({
  // The battle this client hosts is the relayed one, which is what Rust
  // answers from the relay handle held against that connection.
  mpBuildHostConfig: vi.fn(async () => ({
    config: { gameType: "g", mapName: "m" },
    relayed: true,
  })),
  mpBuildBattleConfig: vi.fn(async () => ({
    config: { gameType: "g", mapName: "m" },
    natType: "0",
  })),
  mpProbeHost: vi.fn(async () => ({ outcome: "silent" })),
  mpRelayTraffic,
  mpWatchEngine,
}));

vi.mock("@/content/bindings", () => ({
  contentListReplays: vi.fn(async () => ({ replays: [] })),
}));
vi.mock("@/content/replayUserState", () => ({
  useReplayUserState: () => ({ setProvenance: vi.fn() }),
}));
vi.mock("@/play/tagReplayProvenance", () => ({ tagFreshReplay: vi.fn() }));
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

/** The least a skirmish needs to be launched. Nothing here reads it. */
const skirmish: BattleConfig = {
  mapName: "Comet Catcher Remake 1.8",
  gameType: "Beyond All Reason test-1234",
  myPlayerName: "me",
  startPosType: 2,
  players: [{ name: "me", spectator: false, team: 0 }],
  ais: [],
  teams: [{ teamLeader: 0, allyTeam: 0, rgbColor: [1, 0, 0] }],
  allyTeams: [{ numAllies: 0 }],
};

/** Both ways into a run, next to the pill that describes whichever is live. */
function Screen() {
  const { launch } = usePlay();
  const battle = useBattleLaunch("alice@bar:8200", target, true);
  return (
    <>
      <button type="button" onClick={() => void battle.launch()}>
        host
      </button>
      <button
        type="button"
        onClick={() =>
          void launch("skirmish", {
            config: skirmish,
            executable: target.executable,
            dataDir: target.dataDir,
          })
        }
      >
        skirmish
      </button>
      <InGameBadge />
    </>
  );
}

/** Press a start button and wait for the engine behind it to exist. */
async function startRun(which: "host" | "skirmish"): Promise<Launched> {
  const before = launched.length;
  screen.getByText(which).click();
  await waitFor(() => expect(launched.length).toBe(before + 1));
  const run = launched[before];
  if (!run) throw new Error("no launch was made");
  run.started();
  return run;
}

/** Everything the pill has on it, as one string. */
async function pillSays(): Promise<string> {
  const pill = await screen.findByTitle("Return to the game");
  return pill.closest("div")?.textContent ?? "";
}

beforeEach(() => {
  launched.length = 0;
  (
    globalThis as unknown as { window: Record<string, unknown> }
  ).window.__TAURI_INTERNALS__ = {
    transformCallback: (cb: unknown) => cb,
  };
  render(
    <PlayProvider>
      <Screen />
    </PlayProvider>,
  );
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("warns about the relay on the game that is going through it", async () => {
  await startRun("host");

  await waitFor(async () =>
    expect(await pillSays()).toContain("Relaying 41.0 KB/s"),
  );
  screen.getByRole("button", { name: "End game" }).click();
  expect(playCancel).not.toHaveBeenCalled();
  expect(screen.getByText(/ends it for everybody playing in it/)).toBeTruthy();
});

it("says nothing about a relay left running behind a later skirmish", async () => {
  const relayed = await startRun("host");
  await waitFor(async () =>
    expect(await pillSays()).toContain("Relaying 41.0 KB/s"),
  );
  relayed.finish();
  await waitFor(() =>
    expect(screen.queryByTitle("Return to the game")).toBeNull(),
  );

  // The sidecar is still up, which is what `mpRelayTraffic` has said all along
  // and goes on saying. It is carrying nothing anybody is playing.
  await startRun("skirmish");

  expect(await pillSays()).toBe("In game");
  screen.getByRole("button", { name: "End game" }).click();
  expect(playCancel).toHaveBeenCalledTimes(1);
});
