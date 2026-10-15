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

const scanOverride = vi.hoisted(() => ({
  current: null as Record<string, unknown> | null,
}));

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
  useUnitsyncScan: () =>
    scanOverride.current ?? {
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
    },
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
    mapOptions: {},
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
    onGameChoice: async () => {},
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
  scanOverride.current = null;
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

describe("a scan whose Init failed (issue #3423)", () => {
  // The scan hook answers `data: null` with the engine's reason in `error`.
  // That is an answer, so the gate must name the failure and claim nothing is
  // missing, and must not read as still preparing.
  it("reports the failure, names nothing missing and cannot start", () => {
    scanOverride.current = {
      data: null,
      error: "no space left on device",
      loading: false,
      cancelled: false,
      unvouched: null,
      run: vi.fn(),
      cancel: vi.fn(),
    };
    const { result } = renderHook(() =>
      useBattleRun(
        baseOpts<"victory" | "defeat">({
          persist: vi.fn(async () => {}),
          resolveOutcome: vi.fn((o: "victory" | "defeat") => o),
        }),
      ),
    );
    expect(result.current.scanFailure).toBe("no space left on device");
    expect(result.current.missing).toBeNull();
    expect(result.current.canStart).toBe(false);
    expect(result.current.scanLoading).toBe(false);
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

/** An installed game as the scan lists it. */
function scanGame(
  name: string,
  shortname: string,
  version: string,
  missingDependencies?: string[],
) {
  return {
    name,
    primaryArchive: { name: `${name}.sdz` },
    dependencyArchives: [],
    ...(missingDependencies ? { missingDependencies } : {}),
    info: { shortname, version },
  };
}

function scanWith(games: ReturnType<typeof scanGame>[]) {
  scanOverride.current = {
    data: {
      games,
      maps: [{ name: "DeltaSiegeDry", archives: [], info: {} }],
      errors: [],
    },
    loading: false,
    run: vi.fn(),
  };
}

describe("which game a battle launches (issue #3465)", () => {
  const zk = scanGame("Zero-K v1.14.10.1", "ZK", "v1.14.10.1");
  const benchmark = scanGame("Zero-K Benchmark v3", "ZK", "v3");
  const persist = vi.fn(async () => {});
  const resolveOutcome = vi.fn((outcome: "victory" | "defeat") => outcome);

  it("launches the game a run pinned, not the benchmark that shares its shortname", async () => {
    scanWith([benchmark, zk]);
    launch.mockResolvedValue({ exitCode: null, signal: null });
    contentListReplays.mockResolvedValue({ replays: [] });
    const { result } = renderHook(() =>
      useBattleRun(
        baseOpts<"victory" | "defeat">({
          gameRef: { shortname: "ZK", pinnedName: "Zero-K v1.14.10.1" },
          persist,
          resolveOutcome,
        }),
      ),
    );
    expect(result.current.canStart).toBe(true);
    expect(result.current.gameOffer).toBeNull();
    await act(async () => {
      await result.current.start();
    });
    expect(toBattleConfig).toHaveBeenCalledWith(
      expect.objectContaining({ gameType: "Zero-K v1.14.10.1" }),
    );
  });

  it("does not launch a run that names no game while several could be meant", () => {
    scanWith([benchmark, zk]);
    const { result } = renderHook(() =>
      useBattleRun(
        baseOpts<"victory" | "defeat">({
          gameRef: { shortname: "ZK" },
          persist,
          resolveOutcome,
        }),
      ),
    );
    expect(result.current.canStart).toBe(false);
    expect(result.current.missing).toBeNull();
    expect(result.current.gameOffer).toMatchObject({ kind: "choose" });
  });

  it("stores the answer without launching, and the run then launches that game", async () => {
    scanWith([benchmark, zk]);
    const onGameChoice = vi.fn(async () => {});
    const { result } = renderHook(() =>
      useBattleRun(
        baseOpts<"victory" | "defeat">({
          gameRef: { shortname: "ZK" },
          onGameChoice,
          persist,
          resolveOutcome,
        }),
      ),
    );
    await act(async () => {
      await result.current.answerGameOffer({ pinnedName: zk.name });
    });
    expect(onGameChoice).toHaveBeenCalledTimes(1);
    expect(onGameChoice).toHaveBeenCalledWith({ pinnedName: zk.name });
    expect(launch).not.toHaveBeenCalled();
  });

  it("pins a run that names no game when exactly one game is installed", () => {
    scanWith([zk]);
    const onGameChoice = vi.fn(async () => {});
    const { result } = renderHook(() =>
      useBattleRun(
        baseOpts<"victory" | "defeat">({
          gameRef: { shortname: "ZK" },
          onGameChoice,
          persist,
          resolveOutcome,
        }),
      ),
    );
    expect(result.current.canStart).toBe(true);
    expect(onGameChoice).toHaveBeenCalledWith({ pinnedName: zk.name });
  });

  it("names a missing pinned game, not a benchmark standing in for it", () => {
    scanWith([benchmark]);
    const { result } = renderHook(() =>
      useBattleRun(
        baseOpts<"victory" | "defeat">({
          gameRef: { shortname: "ZK", pinnedName: "Zero-K v1.14.10.1" },
          persist,
          resolveOutcome,
        }),
      ),
    );
    expect(result.current.canStart).toBe(false);
    expect(result.current.missing).toEqual({
      kind: "game",
      name: "Zero-K v1.14.10.1",
    });
  });

  it("names the archive a game depends on that is not installed, and cannot start", () => {
    const broken = scanGame("Zero-K Benchmark v3", "ZK", "v3", [
      "zero-k v1.7.6.4",
    ]);
    scanWith([broken]);
    const { result } = renderHook(() =>
      useBattleRun(
        baseOpts<"victory" | "defeat">({
          gameRef: { shortname: "ZK", pinnedName: broken.name },
          persist,
          resolveOutcome,
        }),
      ),
    );
    expect(result.current.canStart).toBe(false);
    expect(result.current.missing).toEqual({
      kind: "dependency",
      name: "zero-k v1.7.6.4",
      gameName: "Zero-K Benchmark v3",
    });
  });

  it("starts a game whose dependencies all resolve", () => {
    scanWith([scanGame(zk.name, "ZK", "v1.14.10.1", [])]);
    const { result } = renderHook(() =>
      useBattleRun(
        baseOpts<"victory" | "defeat">({
          gameRef: { shortname: "ZK", pinnedName: zk.name },
          persist,
          resolveOutcome,
        }),
      ),
    );
    expect(result.current.canStart).toBe(true);
    expect(result.current.missing).toBeNull();
  });

  it("reads a scan from an older worker, with no missingDependencies, as none known", () => {
    scanWith([zk]);
    expect("missingDependencies" in zk).toBe(false);
    const { result } = renderHook(() =>
      useBattleRun(
        baseOpts<"victory" | "defeat">({
          gameRef: { shortname: "ZK", pinnedName: zk.name },
          persist,
          resolveOutcome,
        }),
      ),
    );
    expect(result.current.canStart).toBe(true);
    expect(result.current.missing).toBeNull();
  });

  it("holds the launch while a newer version is on offer, until it is answered", () => {
    const newer = scanGame("Zero-K v1.15.0.0", "ZK", "v1.15.0.0");
    scanWith([zk, newer]);
    const pinned = {
      shortname: "ZK",
      pinnedName: "Zero-K v1.14.10.1",
    };
    const open = renderHook(() =>
      useBattleRun(
        baseOpts<"victory" | "defeat">({
          gameRef: pinned,
          persist,
          resolveOutcome,
        }),
      ),
    );
    expect(open.result.current.canStart).toBe(false);
    expect(open.result.current.gameOffer).toMatchObject({ kind: "upgrade" });
    const declined = renderHook(() =>
      useBattleRun(
        baseOpts<"victory" | "defeat">({
          gameRef: pinned,
          declinedGameUpdate: newer.name,
          persist,
          resolveOutcome,
        }),
      ),
    );
    expect(declined.result.current.canStart).toBe(true);
    expect(declined.result.current.gameOffer).toBeNull();
  });
});
