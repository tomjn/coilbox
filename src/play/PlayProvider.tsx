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
  playFocus,
  playLaunch,
  playLaunchReplay,
} from "./bindings";

/** Which kind of run is live, for labelling. A campaign mission launches through
 * the same skirmish path — the label only distinguishes it for the UI. */
export type RunKind = "skirmish" | "battle" | "replay" | "campaign";

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

interface PlayContextValue {
  /** True while any game/replay is running (app-wide — only one at a time). */
  running: boolean;
  /** Run id of the live game, for `focusGame`. Null when idle. */
  activeRunId: string | null;
  kind: RunKind | null;
  /** Launch a skirmish, battle or campaign mission; resolves when the engine exits. */
  launch: (
    kind: "skirmish" | "battle" | "campaign",
    opts: LaunchOpts,
  ) => Promise<{ exitCode: number | null }>;
  /** Launch a replay; resolves when the engine exits. */
  launchReplay: (opts: ReplayOpts) => Promise<{ exitCode: number | null }>;
  /** Bring the running game's window to the foreground (best-effort). */
  focusGame: () => void;
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
      const onEvent = new Channel<LaunchEvent>();
      // The authoritative unfreeze is the launch promise resolving; the channel is
      // required by the command signature but unused here.
      onEvent.onmessage = () => {};
      setRunning(true);
      setActiveRunId(runId);
      setKind(runKind);
      try {
        return await run(runId, onEvent);
      } finally {
        runningRef.current = false;
        setRunning(false);
        setActiveRunId(null);
        setKind(null);
      }
    },
    [],
  );

  const launch = useCallback(
    (runKind: "skirmish" | "battle" | "campaign", opts: LaunchOpts) =>
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

  const focusGame = useCallback(() => {
    if (!activeRunId) return;
    void playFocus({ runId: activeRunId }).catch(() => {});
  }, [activeRunId]);

  return (
    <PlayContext.Provider
      value={{ running, activeRunId, kind, launch, launchReplay, focusGame }}
    >
      {children}
    </PlayContext.Provider>
  );
}
