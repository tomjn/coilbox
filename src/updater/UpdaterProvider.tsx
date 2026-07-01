import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import {
  checkForUpdate,
  currentVersion,
  type DownloadPhase,
  installUpdate,
  relaunch,
  type Update,
} from "./updater";

interface UpdaterContextValue {
  /** Running app version, or null before it loads. */
  version: string | null;
  /** Non-null when a newer release is available. */
  update: Update | null;
  checking: boolean;
  /** Epoch ms of the last completed check, or null. */
  lastChecked: number | null;
  error: string | null;
  progress: DownloadPhase;
  /** True once install finished; caller should offer a restart. */
  installed: boolean;
  runCheck: () => Promise<void>;
  runInstall: () => Promise<void>;
  restart: () => Promise<void>;
}

const UpdaterContext = createContext<UpdaterContextValue | null>(null);

/** Access updater state. Must be used within <UpdaterProvider>. */
export function useUpdater(): UpdaterContextValue {
  const ctx = useContext(UpdaterContext);
  if (!ctx) throw new Error("useUpdater must be used within UpdaterProvider");
  return ctx;
}

export function UpdaterProvider({ children }: { children: ReactNode }) {
  const [version, setVersion] = useState<string | null>(null);
  const [update, setUpdate] = useState<Update | null>(null);
  const [checking, setChecking] = useState(false);
  const [lastChecked, setLastChecked] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<DownloadPhase>({ status: "idle" });
  const [installed, setInstalled] = useState(false);

  const runCheck = useCallback(async () => {
    setChecking(true);
    setError(null);
    try {
      const found = await checkForUpdate();
      setUpdate(found);
      setLastChecked(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setChecking(false);
    }
  }, []);

  const runInstall = useCallback(async () => {
    if (!update) return;
    setError(null);
    try {
      await installUpdate(update, setProgress);
      setInstalled(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setProgress({ status: "idle" });
    }
  }, [update]);

  const restart = useCallback(() => relaunch(), []);

  // Load the current version once.
  useEffect(() => {
    currentVersion()
      .then(setVersion)
      .catch(() => setVersion(null));
  }, []);

  // Fire one background check on launch — release builds only. Dev builds ship
  // the 0.0.0 placeholder version and would treat every release as newer.
  useEffect(() => {
    if (!import.meta.env.DEV) void runCheck();
  }, [runCheck]);

  return (
    <UpdaterContext.Provider
      value={{
        version,
        update,
        checking,
        lastChecked,
        error,
        progress,
        installed,
        runCheck,
        runInstall,
        restart,
      }}
    >
      {children}
    </UpdaterContext.Provider>
  );
}
