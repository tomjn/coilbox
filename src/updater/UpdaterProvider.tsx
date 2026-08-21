import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import type { DownloadProgress } from "../downloads/bindings";
import { useDownloadQueue } from "../downloads/DownloadQueueProvider";
import type { ProgressSource } from "../downloads/pages/components/ProgressBar";
import { notify } from "../notify/notify";
import { isUpdaterEnabled } from "../profile/profile";
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
  /**
   * The download indicator's view of the transfer, for a progress bar with the
   * same size, speed and time left as every other download. Null unless one is
   * running.
   */
  download: ProgressSource | null;
  /** True once install finished; caller should offer a restart. */
  installed: boolean;
  runCheck: () => Promise<void>;
  runInstall: () => Promise<void>;
  restart: () => Promise<void>;
}

const UpdaterContext = createContext<UpdaterContextValue | null>(null);

/** Id the app's own update is reported to the download indicator under. */
const APP_UPDATE_ID = "coilbox-update";

/**
 * The updater's byte counts in the shape the download indicator draws. The
 * plugin reports no rate and no percentage, and no total either when the server
 * sent no Content-Length, which is what the shared estimator already copes with
 * on the content downloads.
 */
function asDownloadProgress(phase: {
  downloaded: number;
  total?: number;
}): DownloadProgress {
  return {
    phase: "downloading",
    downloadedBytes: phase.downloaded,
    totalBytes: phase.total ?? null,
    percent: phase.total ? (phase.downloaded / phase.total) * 100 : null,
    bytesPerSec: null,
  };
}

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
  const { report, reported } = useDownloadQueue();
  const download = reported.find((r) => r.id === APP_UPDATE_ID) ?? null;

  const runCheck = useCallback(async () => {
    setChecking(true);
    setError(null);
    try {
      const found = await checkForUpdate();
      setUpdate(found);
      if (found) {
        void notify({
          title: "Update available",
          body: `Coilbox ${found.version} is ready to install.`,
          level: "info",
          to: "/settings/updates",
        });
      }
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
      await installUpdate(update, (phase) => {
        setProgress(phase);
        // The topbar download indicator is meant to be the one place on screen
        // that says something is downloading, so the app's own update reports
        // there too rather than growing a second widget. It is not enqueued:
        // the queue is serial to stop two content downloads writing the same
        // folder, and an app update waiting behind a map helps nobody.
        report(
          APP_UPDATE_ID,
          phase.status === "downloading"
            ? {
                label: `Coilbox ${update.version}`,
                progress: asDownloadProgress(phase),
              }
            : null,
        );
      });
      setInstalled(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setProgress({ status: "idle" });
    } finally {
      // However it ended, nothing is transferring now. A failed or abandoned
      // update must not leave a row in the indicator counting up forever.
      report(APP_UPDATE_ID, null);
    }
  }, [update, report]);

  const restart = useCallback(() => relaunch(), []);

  // Load the current version once.
  useEffect(() => {
    currentVersion()
      .then(setVersion)
      .catch(() => setVersion(null));
  }, []);

  // Fire one background check on launch, in release builds only. Dev builds ship
  // the 0.0.0 placeholder version and would treat every release as newer. A
  // distribution profile with `updater: false` also opts out, so a bundled build
  // never offers its players an upstream Coilbox the distributor didn't ship.
  useEffect(() => {
    if (!import.meta.env.DEV && isUpdaterEnabled()) void runCheck();
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
        download,
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
