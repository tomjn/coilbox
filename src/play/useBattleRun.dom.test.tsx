// @vitest-environment happy-dom
/**
 * Drives `useBattleRun` itself rather than through either caller (issue #2466).
 *
 * `useBattleRun` became the one launch/poll/detect/apply/persist state machine
 * behind both `useConquestBattleRun` and `useRunEncounter` in #2439. Before
 * that, a mistake in the state machine broke one plugin. Now it breaks
 * launching a battle in both, and nothing exercised the machine directly. The
 * only coverage was indirect, through a HUD colour-contrast test that happens
 * to import both plugin trees.
 *
 * The state machine's dependencies (unitsync scan, the launch channel, the
 * replay list, the demo decoder, branding, the profile) are mocked at the
 * module boundary the way `campaign/run.test.tsx` mocks the older,
 * un-consolidated version of this same flow. `./detect` is the one exception:
 * it is left real, because the poll loop it drives (`RETRY_COUNT`, 3 retries,
 * and `RETRY_DELAY_MS`, 1000ms, see `src/play/detect.ts`) is exactly what "a
 * replay arriving on a later poll" and "a replay that never arrives" are
 * testing. Fake timers stand in for the real delay so this file doesn't add
 * wall-clock time to the suite.
 *
 * The two callers differ at the seams `useBattleRun` parameterises: Warpath's
 * `snapshot` layers a shared tech ceiling and personal perks into the launch
 * draft's `restrictions`, and each caller supplies its own `resolveOutcome`.
 * Conquest never sets `restrictions.advantage`/`incomeMultiplier`, so the
 * "layers restrictions onto the launch config" case is Warpath's own, not
 * inferred from Conquest's plain snapshot.
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DemoInfo, ReplayFile } from "../content/bindings";
import type { BattleRestrictions, SkirmishDraft } from "./drafts";
import type { InstalledGame } from "./installedGames";
import {
  PLAYER_NAME,
  type UseBattleRunOptions,
  useBattleRun,
} from "./useBattleRun";

const {
  applyRestrictions,
  contentDemoInfo,
  contentListReplays,
  gameOptionSchema,
  launch,
  mapOptionSchema,
  setProvenance,
  toBattleConfig,
} = vi.hoisted(() => ({
  applyRestrictions: vi.fn(
    (config: Record<string, unknown>, restrictions?: BattleRestrictions) => ({
      ...config,
      restrictions,
    }),
  ),
  contentDemoInfo: vi.fn(),
  contentListReplays: vi.fn(),
  gameOptionSchema: vi.fn(async () => []),
  launch: vi.fn(),
  mapOptionSchema: vi.fn(async () => []),
  setProvenance: vi.fn(),
  toBattleConfig: vi.fn((opts: Record<string, unknown>) => ({ ...opts })),
}));

vi.mock("../content/bindings", () => ({ contentDemoInfo, contentListReplays }));
vi.mock("../content/branding", () => ({ useBrandingEntry: () => null }));
vi.mock("../content/replayUserState", () => ({
  useReplayUserState: () => ({ setProvenance }),
}));
vi.mock("../content/config", () => ({
  useUnitsyncScan: () => ({
    data: {
      games: [
        {
          name: "Balanced Annihilation",
          primaryArchive: { name: "ba.sdz" },
          dependencyArchives: [],
          info: { shortname: "ba", version: "1.0" },
        },
      ],
      maps: [{ name: "DeltaSiegeDry", archives: [], info: {} }],
      errors: [],
    },
    loading: false,
    run: vi.fn(),
  }),
}));
vi.mock("../profile/profile", () => ({ getProfile: () => ({}) }));
vi.mock("./config", () => ({
  applyRestrictions,
  gameOptionSchema,
  mapOptionSchema,
  toBattleConfig,
  usePreferredTarget: () => ({
    target: {
      enginePath: "/engine",
      executable: "/engine/spring",
      dataDir: "/data",
      engineVersion: "1",
    },
    loading: false,
    error: null,
  }),
  useSkirmishAis: () => ({
    ais: [{ shortName: "NullAI", kind: "native" as const }],
    loading: false,
    loaded: true,
  }),
}));
vi.mock("./PlayProvider", () => ({
  usePlay: () => ({ running: false, launch }),
}));

/** A `ReplayFile`, with only the fields this file reads. */
function replayFile(overrides: Partial<ReplayFile> = {}): ReplayFile {
  return {
    filename: "battle.sdfz",
    path: "/data/demos/battle.sdfz",
    sizeBytes: 1000,
    modifiedMs: 1,
    ...overrides,
  };
}

/** A `DemoInfo`, matching `detect.test.ts`'s own copy. */
function demoInfo(overrides: Partial<DemoInfo> = {}): DemoInfo {
  return {
    engineVersion: "1",
    startTimeMs: 0,
    durationSec: 0,
    wallclockSec: 0,
    mapName: "DeltaSiegeDry",
    gameType: "Balanced Annihilation",
    winningAllyTeams: [0],
    winnersKnown: true,
    numAllyTeams: 2,
    allyTeams: [],
    players: [],
    ais: [],
    modOptions: {},
    ...overrides,
  };
}

/** Conquest's own snapshot shape: a plain draft, no restrictions. */
function conquestSnapshot(installedGame: InstalledGame): SkirmishDraft {
  return {
    participants: [],
    gameName: installedGame.name,
    mapName: "DeltaSiegeDry",
    startPosType: 2,
    modOptionValues: {},
  };
}

/**
 * Warpath's own snapshot shape: the same draft, plus `restrictions` folding in
 * the shared tech ceiling (`disabledUnits`) and personal perks
 * (`advantage`/`incomeMultiplier`). See `useRunEncounter`'s `snapshot`.
 */
function warpathSnapshot(restrictions: BattleRestrictions) {
  return (installedGame: InstalledGame): SkirmishDraft => ({
    participants: [],
    gameName: installedGame.name,
    mapName: "DeltaSiegeDry",
    startPosType: 2,
    modOptionValues: {},
    restrictions,
  });
}

function baseOpts<TResolved>(
  overrides: Partial<UseBattleRunOptions<TResolved>> &
    Pick<UseBattleRunOptions<TResolved>, "resolveOutcome" | "persist">,
): UseBattleRunOptions<TResolved> {
  return {
    launchMode: "conquest",
    gameRef: { shortname: "ba" },
    mapName: "DeltaSiegeDry",
    canStartExtra: true,
    hasDomainState: true,
    snapshot: conquestSnapshot as UseBattleRunOptions<TResolved>["snapshot"],
    provenance: { mode: "conquest" },
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  contentListReplays.mockReset();
  contentDemoInfo.mockReset();
  launch.mockReset();
  applyRestrictions.mockClear();
  toBattleConfig.mockClear();
  gameOptionSchema.mockClear();
  mapOptionSchema.mockClear();
  setProvenance.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("launching and detecting the outcome from the replay", () => {
  it("detects the outcome from a replay that arrives on a later poll, not the first", async () => {
    const replay = replayFile();
    let call = 0;
    contentListReplays.mockImplementation(async () => {
      call += 1;
      // Call 1 is the pre-launch baseline. Call 2 is the first poll attempt,
      // finding nothing yet. The replay only shows up from call 3 onward, the
      // second poll attempt.
      return call >= 3 ? { replays: [replay] } : { replays: [] };
    });
    contentDemoInfo.mockResolvedValue({
      info: demoInfo({
        players: [{ name: PLAYER_NAME, spectator: false, won: true }],
      }),
    });
    launch.mockResolvedValue({ exitCode: 0, signal: null });

    const persist = vi.fn(async () => {});
    const resolveOutcome = vi.fn((outcome: "victory" | "defeat") => outcome);
    const { result } = renderHook(() =>
      useBattleRun(baseOpts<"victory" | "defeat">({ persist, resolveOutcome })),
    );

    await act(async () => {
      const started = result.current.start();
      // One retry's delay (RETRY_DELAY_MS) is enough to reach call 3.
      await vi.advanceTimersByTimeAsync(1000);
      await started;
    });

    expect(contentListReplays).toHaveBeenCalledTimes(3);
    expect(setProvenance).toHaveBeenCalledWith(replay.filename, {
      mode: "conquest",
    });
    expect(resolveOutcome).toHaveBeenCalledTimes(1);
    expect(resolveOutcome).toHaveBeenCalledWith("victory");
    expect(persist).toHaveBeenCalledTimes(1);
    expect(persist).toHaveBeenCalledWith("victory");
    expect(result.current.phase).toBe("victory");
    expect(result.current.autoDetected).toBe(true);
    expect(result.current.resolved).toBe("victory");
  });

  it("falls back to the manual prompt when the replay never arrives", async () => {
    contentListReplays.mockResolvedValue({ replays: [] });
    launch.mockResolvedValue({ exitCode: 0, signal: null });

    const persist = vi.fn(async () => {});
    const resolveOutcome = vi.fn((outcome: "victory" | "defeat") => outcome);
    const { result } = renderHook(() =>
      useBattleRun(baseOpts<"victory" | "defeat">({ persist, resolveOutcome })),
    );

    await act(async () => {
      const started = result.current.start();
      // 3 retries at RETRY_DELAY_MS each exhausts the poll loop.
      await vi.advanceTimersByTimeAsync(3000);
      await started;
    });

    // 1 baseline call, plus the poll loop's 4 attempts (the first try and 3 retries).
    expect(contentListReplays).toHaveBeenCalledTimes(5);
    expect(contentDemoInfo).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();
    expect(result.current.phase).toBe("result");
    expect(result.current.error).toBeNull();
  });

  it("applies and persists the manually chosen outcome exactly once", async () => {
    contentListReplays.mockResolvedValue({ replays: [] });
    launch.mockResolvedValue({ exitCode: 0, signal: null });

    const persist = vi.fn(async () => {});
    const resolveOutcome = vi.fn((outcome: "victory" | "defeat") => outcome);
    const { result } = renderHook(() =>
      useBattleRun(baseOpts<"victory" | "defeat">({ persist, resolveOutcome })),
    );

    await act(async () => {
      const started = result.current.start();
      await vi.advanceTimersByTimeAsync(3000);
      await started;
    });
    expect(result.current.phase).toBe("result");

    await act(async () => {
      await result.current.recordVictory();
    });

    expect(resolveOutcome).toHaveBeenCalledTimes(1);
    expect(persist).toHaveBeenCalledTimes(1);
    expect(persist).toHaveBeenCalledWith("victory");
    expect(result.current.phase).toBe("victory");
    expect(result.current.resolved).toBe("victory");
    expect(result.current.autoDetected).toBe(false);
  });
});

describe("the hasDomainState guard applyResult shares with both callers", () => {
  // Both `useConquestBattleRun.resolveOutcome` and `useRunEncounter.resolveOutcome`
  // throw if their domain object isn't ready, trusting this guard in
  // `applyResult` to never let that happen. `hasDomainState` gates `start()` on
  // the way in, but `recordVictory`/`recordDefeat`/the auto path all call
  // `applyResult` too, so the guard has to hold there as well.
  it("does nothing when the caller's domain state isn't ready", async () => {
    const persist = vi.fn(async () => {});
    const resolveOutcome = vi.fn((outcome: "victory" | "defeat") => outcome);
    const { result } = renderHook(() =>
      useBattleRun(
        baseOpts<"victory" | "defeat">({
          persist,
          resolveOutcome,
          hasDomainState: false,
        }),
      ),
    );

    await act(async () => {
      await result.current.recordVictory();
    });

    expect(resolveOutcome).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();
    expect(result.current.phase).toBe("briefing");
  });
});

describe("Warpath's own seams: the tech-ceiling/perk snapshot and its resolver", () => {
  it("layers the tech ceiling and perks onto the launch config, unlike Conquest's plain snapshot", async () => {
    // A cancelled launch (`exitCode: null`) ends the flow immediately, so this
    // is left looking at exactly what `start()` built to hand to `launch()`.
    // Same technique `campaign/run.test.tsx` uses for the same reason.
    launch.mockResolvedValue({ exitCode: null, signal: null });
    const restrictions: BattleRestrictions = {
      disabledUnits: ["armfark"],
      advantage: 0.2,
      incomeMultiplier: 0.5,
    };

    const { result } = renderHook(() =>
      useBattleRun(
        baseOpts<{ progress: string }>({
          launchMode: "runlite",
          snapshot: warpathSnapshot(restrictions) as UseBattleRunOptions<{
            progress: string;
          }>["snapshot"],
          persist: vi.fn(async () => {}),
          resolveOutcome: vi.fn(() => ({ progress: "cleared" })),
          provenance: { mode: "warpath", runId: "r1", nodeId: "n1" },
        }),
      ),
    );

    await act(async () => {
      await result.current.start();
    });

    expect(toBattleConfig).toHaveBeenCalledTimes(1);
    expect(toBattleConfig.mock.calls[0][0]).toMatchObject({
      disabledUnits: ["armfark"],
    });
    expect(applyRestrictions).toHaveBeenCalledTimes(1);
    expect(applyRestrictions.mock.calls[0][1]).toEqual(restrictions);
    expect(launch).toHaveBeenCalledTimes(1);
    expect(launch.mock.calls[0][0]).toBe("runlite");
    expect(launch.mock.calls[0][1].config).toMatchObject({
      disabledUnits: ["armfark"],
      restrictions,
    });
    expect(result.current.lastSnapshot?.restrictions).toEqual(restrictions);
  });

  it("resolves and persists through Warpath's own resolver, distinct from Conquest's", async () => {
    contentListReplays.mockResolvedValue({ replays: [] });
    launch.mockResolvedValue({ exitCode: 0, signal: null });

    const persist = vi.fn(async () => {});
    // Warpath's `resolveOutcome` folds through `resolveBattle` and returns a
    // `RogueliteRun`-shaped value, not the string/`ConquestState` shape the
    // other tests in this file use. That is the point of the hook being
    // generic over `TResolved`.
    const resolveOutcome = vi.fn((outcome: "victory" | "defeat") => ({
      progress: { status: outcome === "victory" ? "cleared" : "wiped" },
    }));
    const { result } = renderHook(() =>
      useBattleRun(
        baseOpts<{ progress: { status: string } }>({
          launchMode: "runlite",
          snapshot: warpathSnapshot({
            advantage: 0.1,
          }) as UseBattleRunOptions<{
            progress: { status: string };
          }>["snapshot"],
          persist,
          resolveOutcome,
          provenance: { mode: "warpath", runId: "r1", nodeId: "n1" },
        }),
      ),
    );

    await act(async () => {
      const started = result.current.start();
      await vi.advanceTimersByTimeAsync(3000);
      await started;
    });
    expect(result.current.phase).toBe("result");

    await act(async () => {
      await result.current.recordDefeat();
    });

    expect(resolveOutcome).toHaveBeenCalledTimes(1);
    expect(resolveOutcome).toHaveBeenCalledWith("defeat");
    expect(persist).toHaveBeenCalledTimes(1);
    expect(persist).toHaveBeenCalledWith({ progress: { status: "wiped" } });
    expect(result.current.phase).toBe("defeat");
    expect(result.current.resolved).toEqual({ progress: { status: "wiped" } });
  });
});
