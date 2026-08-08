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
  playCancel,
  playFocus,
  playLaunch,
  playLaunchReplay,
  playLaunchSave,
} from "./bindings";

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

interface LaunchOpts {
  config: BattleConfig;
  executable: string;
  dataDir: string;
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
  /** Launch a skirmish, battle or campaign mission; resolves when the engine exits. */
  launch: (
    kind: "skirmish" | "battle" | "campaign" | "conquest" | "runlite",
    opts: LaunchOpts,
  ) => Promise<{ exitCode: number | null }>;
  /** Launch a replay; resolves when the engine exits. */
  launchReplay: (opts: ReplayOpts) => Promise<{ exitCode: number | null }>;
  /** Resume a savegame; resolves when the engine exits. */
  launchSave: (opts: SaveOpts) => Promise<{ exitCode: number | null }>;
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
  // Synchronous guard: `running` state lags a render behind, so gate on a ref to
  // reject a second launch without disturbing the in-flight run.
  const runningRef = useRef(false);
  // Tracks which run id is current, so a launch promise that settles late (after
  // `cancel` already cleared state, or after a second run started) doesn't
  // clobber a run it no longer belongs to.
  const activeRunIdRef = useRef<string | null>(null);

  const clearRun = useCallback(() => {
    runningRef.current = false;
    activeRunIdRef.current = null;
    setRunning(false);
    setActiveRunId(null);
    setKind(null);
  }, []);

  const start = useCallback(
    async (
      runKind: RunKind,
      run: (
        runId: string,
        onEvent: Channel<LaunchEvent>,
      ) => Promise<{ exitCode: number | null }>,
    ) => {
      if (runningRef.current) throw new Error("a game is already running");
      runningRef.current = true;
      const runId = crypto.randomUUID();
      activeRunIdRef.current = runId;
      const onEvent = new Channel<LaunchEvent>();
      // The authoritative unfreeze is the launch promise resolving. The channel
      // is required by the command signature but unused here.
      onEvent.onmessage = () => {};
      setRunning(true);
      setActiveRunId(runId);
      setKind(runKind);
      try {
        return await run(runId, onEvent);
      } finally {
        // Only clear if this run is still the active one. `cancel` may already
        // have cleared it (and a new run may since have started) before this
        // promise settles.
        if (activeRunIdRef.current === runId) clearRun();
      }
    },
    [clearRun],
  );

  const launch = useCallback(
    (
      runKind: "skirmish" | "battle" | "campaign" | "conquest" | "runlite",
      opts: LaunchOpts,
    ) =>
      start(runKind, (runId, onEvent) =>
        playLaunch({ ...opts, runId, onEvent }),
      ),
    [start],
  );

  const launchReplay = useCallback(
    (opts: ReplayOpts) =>
      start("replay", (runId, onEvent) =>
        playLaunchReplay({ ...opts, runId, onEvent }),
      ),
    [start],
  );

  const launchSave = useCallback(
    (opts: SaveOpts) =>
      start("save", (runId, onEvent) =>
        playLaunchSave({ ...opts, runId, onEvent }),
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
        launch,
        launchReplay,
        launchSave,
        focusGame,
        cancel,
      }}
    >
      {children}
    </PlayContext.Provider>
  );
}
