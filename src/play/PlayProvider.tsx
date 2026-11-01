import { i18n, type MessageDescriptor } from "@lingui/core";
import { msg, t } from "@lingui/core/macro";
import { Channel } from "@tauri-apps/api/core";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { contentReplayPlaybackLaunch } from "@/content/bindings";
import { refreshContentState } from "@/content/contentState";
import { errorText } from "@/lib/helpers";
import { mpRelayTraffic } from "@/multiplayer/bindings";
import { notify } from "@/notify/notify";
import { setMusicSuspended } from "@/sound/music";
import { playEvent } from "@/sound/play";
import { writeSetForLaunch } from "@/widgets/widgetSync";
import {
  type BattleConfig,
  type LaunchEvent,
  type LaunchOutcome,
  playCancel,
  playFocus,
  playLaunch,
  playLaunchReplay,
  playLaunchSave,
  playStatus,
} from "./bindings";
import { LaunchContentProvider } from "./LaunchContentProvider";
import { CrashDrawer } from "./pages/components/CrashDrawer";
import { ASK_EVERY_MS } from "./relayCarrying";
import { type CrashContext, useCrashTriage } from "./useCrashTriage";

/** Which kind of run is live, for labelling. A campaign mission launches through
 * the same skirmish path — the label only distinguishes it for the UI. */
export type RunKind =
  | "skirmish"
  | "battle"
  | "replay"
  | "save"
  | "campaign"
  | "conquest"
  | "runlite";

/** What each run kind is called when the crash drawer says what died. Warpath
 * keeps its internal name `runlite` everywhere else, so it is spelled out here
 * rather than shown raw. */
const RUN_LABELS: Record<RunKind, MessageDescriptor> = {
  skirmish: msg`Skirmish`,
  battle: msg`Multiplayer battle`,
  replay: msg`Replay`,
  save: msg`Savegame`,
  campaign: msg`Campaign mission`,
  conquest: msg`Conquest battle`,
  runlite: msg`Warpath battle`,
};

interface LaunchOpts {
  config: BattleConfig;
  executable: string;
  dataDir: string;
  /**
   * Called once the engine process exists, with this run's id. Optional, and
   * left out by every launch that has nothing to do once a game is under way,
   * which is all of them but a battle hosted through the relay (#2065).
   *
   * The run id rather than the process id, because only Rust holds the child
   * and the id is what finds it there. Kept out of the arguments sent to the
   * launch command, which are serialized and would not take a function.
   */
  onEngineStarted?: (runId: string) => void;
  /**
   * This game's traffic goes out through the relay sidecar on this machine, so
   * ending it here ends it for everybody else playing in it (#2097).
   *
   * Said by the launch, because the launch is the only thing that knows. A
   * relay is a fact about one battle and one run of the engine, and every
   * signal outside this launch answers something else: the sidecar's own
   * liveness outlives the game it carried by up to four minutes, and the
   * recorded hosting route outlives the battle it describes.
   */
  relayed?: boolean;
  /** Open the engine's autohost interface for this run (issue #3346). */
  autohost?: boolean;
}

interface ReplayOpts {
  demoPath: string;
  executable: string;
  dataDir: string;
}

interface PlaybackOpts {
  replayPath: string;
  executable: string;
  dataDir: string;
  /** Another installed version of the replay's game, when its own is missing. */
  game?: string;
  /** The frame to open on. Whole, and held inside the track by the player. */
  startFrame?: number;
  /** Open on the player's own pause. */
  paused?: boolean;
}

interface SaveOpts {
  savePath: string;
  executable: string;
  dataDir: string;
}

interface PlayContextValue {
  /**
   * True while an engine process is up (app-wide, only one at a time). Getting
   * ready to start one is `starting`, and is not being in a game.
   */
  running: boolean;
  /** True from pressing launch until the engine process exists. */
  starting: boolean;
  /** Run id of the live game, for `focusGame`. Null when idle. */
  activeRunId: string | null;
  kind: RunKind | null;
  /**
   * True while the game that is running is the one going through this
   * machine's relay (#2097).
   *
   * Already compared against the live run rather than handed out as a run id to
   * compare, because forgetting to compare is the bug this exists for.
   */
  relayed: boolean;
  /** Launch a skirmish, battle or campaign mission; resolves when the engine exits. */
  launch: (
    kind: "skirmish" | "battle" | "campaign" | "conquest" | "runlite",
    opts: LaunchOpts,
  ) => Promise<LaunchOutcome>;
  /** Launch a replay; resolves when the engine exits. */
  launchReplay: (opts: ReplayOpts) => Promise<LaunchOutcome>;
  /**
   * Play a replay's recorded track back in the engine (#3793), from a frame if
   * asked; resolves when the engine exits.
   */
  launchReplayPlayback: (opts: PlaybackOpts) => Promise<LaunchOutcome>;
  /** Resume a savegame; resolves when the engine exits. */
  launchSave: (opts: SaveOpts) => Promise<LaunchOutcome>;
  /** Bring the running game's window to the foreground (best-effort). */
  focusGame: () => void;
  /**
   * Force-quit the running game or abandon a launch still getting ready, and
   * immediately clear run state, regardless of whether the engine cooperates or
   * the launch promise ever settles. The escape hatch for a stuck badge (#925).
   */
  cancel: () => void;
}

const PlayContext = createContext<PlayContextValue | null>(null);

/** Access shared game-run state. Must be used within <PlayProvider>. */
export function usePlay(): PlayContextValue {
  const ctx = useContext(PlayContext);
  if (!ctx) throw new Error("usePlay must be used within PlayProvider");
  return ctx;
}

/** The runs Rust says have an engine up, or null when it could not be asked. */
async function liveRuns(): Promise<string[] | null> {
  try {
    return (await playStatus({})).runs;
  } catch {
    return null;
  }
}

/** Refresh the content state from disk and refuse an engine it no longer
 *  lists. Answers the engine's folder, when the state could be read. */
async function assertEngineInstalled(
  executable?: string,
): Promise<string | undefined> {
  // A read that fails says nothing about the engine, so the launch goes ahead.
  const state = await refreshContentState().catch(() => null);
  if (!state || !executable) return undefined;
  const engine = state.roots
    .flatMap((r) => r.engines)
    .find((e) => e.executable === executable);
  if (!engine) {
    throw new Error(t`The engine at ${executable} is no longer installed.`);
  }
  return engine.path;
}

/** Write the player's widget set into the game's config file (#4844). A
 *  failure is said and the launch goes ahead, because the game still runs
 *  with the widgets it had. */
async function writeWidgetSet(
  enginePath: string,
  dataDir: string,
  game: string,
): Promise<void> {
  try {
    await writeSetForLaunch({ enginePath, dataDir, game });
  } catch (e) {
    console.warn(`could not write ${game}'s widget settings`, e);
    void notify({
      level: "warning",
      title: t`Coilbox could not write your widget settings for ${game}`,
      body: errorText(e),
    });
  }
}

export function PlayProvider({ children }: { children: ReactNode }) {
  const [running, setRunning] = useState(false);
  const [starting, setStarting] = useState(false);
  // A run found after a webview reload. Its launch promise went with the old
  // page, so nothing will say when it ends unless Rust is asked.
  const [adoptedRunId, setAdoptedRunId] = useState<string | null>(null);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [kind, setKind] = useState<RunKind | null>(null);
  // The run whose traffic goes through this machine's relay, by id rather than
  // as a flag, so the pill that warns about it is naming a game rather than
  // reading that a relay exists somewhere (#2097).
  const [relayedRunId, setRelayedRunId] = useState<string | null>(null);
  // Synchronous guard: state lags a render behind, so gate on a ref to reject a
  // second launch without disturbing the in-flight run.
  const phaseRef = useRef<"idle" | "starting" | "running">("idle");
  // Tracks which run id is current, so a launch promise that settles late (after
  // `cancel` already cleared state, or after a second run started) doesn't
  // clobber a run it no longer belongs to.
  const activeRunIdRef = useRef<string | null>(null);
  // `start` is built before `adopt`, and reaches it through here.
  const adoptRef = useRef<(runId: string) => void>(() => {});
  // Crash triage (#379). It lives here because every launch in the app goes
  // through `start`, so one drawer covers all of them.
  const {
    triage,
    open: crashOpen,
    setOpen: setCrashOpen,
    inspect,
  } = useCrashTriage();

  const clearRun = useCallback(() => {
    phaseRef.current = "idle";
    activeRunIdRef.current = null;
    setMusicSuspended("game", false);
    setRunning(false);
    setStarting(false);
    setAdoptedRunId(null);
    setActiveRunId(null);
    setKind(null);
    setRelayedRunId(null);
  }, []);

  const start = useCallback(
    async (
      runKind: RunKind,
      ctx: { dataDir: string } & Omit<CrashContext, "outcome" | "runKind">,
      run: (
        runId: string,
        onEvent: Channel<LaunchEvent>,
      ) => Promise<LaunchOutcome>,
      {
        onEngineStarted,
        relayed,
      }: Pick<LaunchOpts, "onEngineStarted" | "relayed"> = {},
    ) => {
      // A badge can outlive its engine if a launch promise never settles. Only a
      // process that is really there may refuse the player.
      if (phaseRef.current === "running") {
        const held = activeRunIdRef.current;
        const live = await liveRuns();
        if (
          held &&
          live &&
          !live.includes(held) &&
          activeRunIdRef.current === held
        ) {
          console.warn(`play: run ${held} has no engine, clearing it`);
          clearRun();
        }
      }
      if (phaseRef.current === "starting") {
        console.warn("play: launch refused, another is getting ready");
        throw new Error(t`A launch is already starting.`);
      }
      if (phaseRef.current === "running") {
        console.warn("play: launch refused, an engine is up");
        throw new Error("a game is already running");
      }
      const runId = crypto.randomUUID();
      phaseRef.current = "starting";
      activeRunIdRef.current = runId;
      setStarting(true);
      setActiveRunId(runId);
      setKind(runKind);
      // Set to null for every ordinary launch as well as recorded for a relayed
      // one, so a run that has nothing to do with a relay says so rather than
      // inheriting whatever the last one left behind.
      setRelayedRunId(relayed ? runId : null);
      try {
        // An engine this page never launched, left from before a reload.
        const found = (await liveRuns())?.[0];
        if (found && activeRunIdRef.current === runId) {
          console.warn(`play: launch refused, run ${found} is already up`);
          adoptRef.current(found);
          throw new Error("a game is already running");
        }
        // The engine folder can be deleted while coilbox runs. Check the disk
        // now rather than start a process that cannot exist.
        const enginePath = await assertEngineInstalled(ctx.engine);
        // Not for a replay, which mostly does not name its game, so writing for
        // the one that does would make replays differ by how they were opened.
        if (
          activeRunIdRef.current === runId &&
          enginePath &&
          ctx.game &&
          runKind !== "replay"
        ) {
          await writeWidgetSet(enginePath, ctx.dataDir, ctx.game);
        }
      } catch (e) {
        if (activeRunIdRef.current === runId) clearRun();
        throw e;
      }
      // The player gave up on this launch while it was getting ready. Both nulls
      // are what a cancelled run answers.
      if (activeRunIdRef.current !== runId) {
        return { exitCode: null, signal: null };
      }
      const onEvent = new Channel<LaunchEvent>();
      // The authoritative unfreeze is the launch promise resolving, so nothing
      // here reads the exit. `started` is the only moment on this channel that
      // says anything the promise cannot: the engine now exists as a process,
      // so this is where the player is in a game. An engine that arrives after
      // the player gave up on its launch has nobody waiting for it.
      onEvent.onmessage = (event) => {
        if (event.kind !== "started") return;
        if (activeRunIdRef.current !== runId) {
          void playCancel({ runId }).catch(() => {});
          return;
        }
        phaseRef.current = "running";
        setStarting(false);
        setRunning(true);
        onEngineStarted?.(runId);
      };
      // Every launch comes through here - skirmish, battle, campaign, conquest,
      // a saved game and a replay - so one sound covers the lot. Deliberately
      // not the same event as the host starting a battle you are in: that one
      // is somebody else acting and has to reach you across the room, this one
      // is you pressing the button and already looking at the screen.
      playEvent("launch");
      // The engine is about to take the screen and make its own noise, so the
      // lobby soundtrack stops until it exits. Cleared in `clearRun`, which
      // every ending goes through including a crash or a cancel.
      setMusicSuspended("game", true);
      // Recorded before the engine starts, so crash triage can tell this run's
      // log from the one an earlier session left behind (#379).
      const startedAtMs = Date.now();
      try {
        const outcome = await run(runId, onEvent);
        // Only triage the run that is still current. A run the user cancelled
        // is not a crash, and its promise settles after `cancel` cleared the id.
        if (activeRunIdRef.current === runId) {
          void inspect({
            ...ctx,
            runKind: i18n._(RUN_LABELS[runKind]),
            outcome,
            startedAtMs,
          });
        }
        return outcome;
      } finally {
        // Only clear if this run is still the active one. `cancel` may already
        // have cleared it (and a new run may since have started) before this
        // promise settles.
        if (activeRunIdRef.current === runId) clearRun();
      }
    },
    [clearRun, inspect],
  );

  // Take on a run whose launch this page does not hold. Only the launch knew
  // whether a relay carries it, so a relay being up is read as carrying it: a
  // needless question on the X costs far less than ending a game for everybody.
  const adopt = useCallback((runId: string) => {
    phaseRef.current = "running";
    activeRunIdRef.current = runId;
    setMusicSuspended("game", true);
    setStarting(false);
    setRunning(true);
    setActiveRunId(runId);
    setKind(null);
    setRelayedRunId(null);
    setAdoptedRunId(runId);
    void mpRelayTraffic({})
      .then(({ relaying }) => {
        if (relaying && activeRunIdRef.current === runId) {
          setRelayedRunId(runId);
        }
      })
      .catch(() => {});
  }, []);
  adoptRef.current = adopt;

  useEffect(() => {
    let mounted = true;
    void liveRuns().then((runs) => {
      const found = runs?.[0];
      if (mounted && found && phaseRef.current === "idle") adopt(found);
    });
    return () => {
      mounted = false;
    };
  }, [adopt]);

  useEffect(() => {
    if (!adoptedRunId) return;
    const timer = setInterval(() => {
      void liveRuns().then((runs) => {
        if (
          runs &&
          !runs.includes(adoptedRunId) &&
          activeRunIdRef.current === adoptedRunId
        ) {
          clearRun();
        }
      });
    }, ASK_EVERY_MS);
    return () => clearInterval(timer);
  }, [adoptedRunId, clearRun]);

  const launch = useCallback(
    (
      runKind: "skirmish" | "battle" | "campaign" | "conquest" | "runlite",
      opts: LaunchOpts,
    ) => {
      const { onEngineStarted, relayed, ...args } = opts;
      return start(
        runKind,
        {
          dataDir: args.dataDir,
          game: args.config.gameType,
          map: args.config.mapName,
          engine: args.executable,
        },
        (runId, onEvent) => playLaunch({ ...args, runId, onEvent }),
        { onEngineStarted, relayed },
      );
    },
    [start],
  );

  const launchReplay = useCallback(
    (opts: ReplayOpts) =>
      start(
        "replay",
        {
          dataDir: opts.dataDir,
          engine: opts.executable,
          // The engine reads the game and map out of the demo, so coilbox knows
          // neither. Naming the file is the useful thing it does know.
          file: opts.demoPath,
        },
        (runId, onEvent) => playLaunchReplay({ ...opts, runId, onEvent }),
      ),
    [start],
  );

  const launchReplayPlayback = useCallback(
    (opts: PlaybackOpts) =>
      start(
        "replay",
        {
          dataDir: opts.dataDir,
          engine: opts.executable,
          game: opts.game,
          file: opts.replayPath,
        },
        (runId, onEvent) =>
          contentReplayPlaybackLaunch({ ...opts, runId, onEvent }),
      ),
    [start],
  );

  const launchSave = useCallback(
    (opts: SaveOpts) =>
      start(
        "save",
        {
          dataDir: opts.dataDir,
          engine: opts.executable,
          file: opts.savePath,
        },
        (runId, onEvent) => playLaunchSave({ ...opts, runId, onEvent }),
      ),
    [start],
  );

  const focusGame = useCallback(() => {
    if (!activeRunId) return;
    void playFocus({ runId: activeRunId }).catch(() => {});
  }, [activeRunId]);

  const cancel = useCallback(() => {
    const runId = activeRunIdRef.current;
    if (!runId) return;
    // Clear synchronously so the badge and the single-run guard free up right
    // away. Don't wait on play_cancel, or on the still-pending launch promise
    // (the start finally-block now no-ops for it via the run id check). A stuck
    // launch is exactly the case this exists for.
    clearRun();
    void playCancel({ runId }).catch(() => {});
  }, [clearRun]);

  return (
    <PlayContext.Provider
      value={{
        running,
        starting,
        activeRunId,
        kind,
        relayed: activeRunId !== null && activeRunId === relayedRunId,
        launch,
        launchReplay,
        launchReplayPlayback,
        launchSave,
        focusGame,
        cancel,
      }}
    >
      {/* The content check every launch path runs before it calls `launch`
          (issue #3364). Mounted here so it is wherever `usePlay` is. */}
      <LaunchContentProvider>{children}</LaunchContentProvider>
      <CrashDrawer
        open={crashOpen}
        onOpenChange={setCrashOpen}
        triage={triage}
      />
    </PlayContext.Provider>
  );
}
