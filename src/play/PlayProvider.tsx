import { Channel } from "@tauri-apps/api/core";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useRef,
  useState,
} from "react";
import {
  type BattleConfig,
  type LaunchEvent,
  type LaunchOutcome,
  playCancel,
  playFocus,
  playLaunch,
  playLaunchReplay,
  playLaunchSave,
} from "./bindings";
import { CrashDrawer } from "./pages/components/CrashDrawer";
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
const RUN_LABELS: Record<RunKind, string> = {
  skirmish: "Skirmish",
  battle: "Multiplayer battle",
  replay: "Replay",
  save: "Savegame",
  campaign: "Campaign mission",
  conquest: "Conquest battle",
  runlite: "Warpath battle",
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
}

interface ReplayOpts {
  demoPath: string;
  executable: string;
  dataDir: string;
}

interface SaveOpts {
  savePath: string;
  executable: string;
  dataDir: string;
}

interface PlayContextValue {
  /** True while any game/replay is running (app-wide — only one at a time). */
  running: boolean;
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
  /** Resume a savegame; resolves when the engine exits. */
  launchSave: (opts: SaveOpts) => Promise<LaunchOutcome>;
  /** Bring the running game's window to the foreground (best-effort). */
  focusGame: () => void;
  /**
   * Force-quit the running game and immediately clear run state, regardless of
   * whether the engine cooperates or the launch promise ever settles. The
   * escape hatch for a stuck "In game" badge (#925).
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

export function PlayProvider({ children }: { children: ReactNode }) {
  const [running, setRunning] = useState(false);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [kind, setKind] = useState<RunKind | null>(null);
  // The run whose traffic goes through this machine's relay, by id rather than
  // as a flag, so the pill that warns about it is naming a game rather than
  // reading that a relay exists somewhere (#2097).
  const [relayedRunId, setRelayedRunId] = useState<string | null>(null);
  // Synchronous guard: `running` state lags a render behind, so gate on a ref to
  // reject a second launch without disturbing the in-flight run.
  const runningRef = useRef(false);
  // Tracks which run id is current, so a launch promise that settles late (after
  // `cancel` already cleared state, or after a second run started) doesn't
  // clobber a run it no longer belongs to.
  const activeRunIdRef = useRef<string | null>(null);
  // Crash triage (#379). It lives here because every launch in the app goes
  // through `start`, so one drawer covers all of them.
  const {
    triage,
    open: crashOpen,
    setOpen: setCrashOpen,
    inspect,
  } = useCrashTriage();

  const clearRun = useCallback(() => {
    runningRef.current = false;
    activeRunIdRef.current = null;
    setRunning(false);
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
      if (runningRef.current) throw new Error("a game is already running");
      runningRef.current = true;
      const runId = crypto.randomUUID();
      activeRunIdRef.current = runId;
      const onEvent = new Channel<LaunchEvent>();
      // The authoritative unfreeze is the launch promise resolving, so nothing
      // here reads the exit. `started` is the only moment on this channel that
      // says anything the promise cannot: the engine now exists as a process,
      // which is what a caller needs before it can ask anything about it.
      onEvent.onmessage = (event) => {
        if (event.kind === "started") onEngineStarted?.(runId);
      };
      // Recorded before the engine starts, so crash triage can tell this run's
      // log from the one an earlier session left behind (#379).
      const startedAtMs = Date.now();
      setRunning(true);
      setActiveRunId(runId);
      setKind(runKind);
      // Set to null for every ordinary launch as well as recorded for a relayed
      // one, so a run that has nothing to do with a relay says so rather than
      // inheriting whatever the last one left behind.
      setRelayedRunId(relayed ? runId : null);
      try {
        const outcome = await run(runId, onEvent);
        // Only triage the run that is still current. A run the user cancelled
        // is not a crash, and its promise settles after `cancel` cleared the id.
        if (activeRunIdRef.current === runId) {
          void inspect({
            ...ctx,
            runKind: RUN_LABELS[runKind],
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
        activeRunId,
        kind,
        relayed: activeRunId !== null && activeRunId === relayedRunId,
        launch,
        launchReplay,
        launchSave,
        focusGame,
        cancel,
      }}
    >
      {children}
      <CrashDrawer
        open={crashOpen}
        onOpenChange={setCrashOpen}
        triage={triage}
      />
    </PlayContext.Provider>
  );
}
