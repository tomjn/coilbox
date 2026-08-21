import { Button } from "@picoframe/frame";
import { QueueProgress } from "../../downloads/pages/components/ProgressBar";
import { isUpdaterEnabled } from "../../profile/profile";
import { useUpdater } from "../UpdaterProvider";

/**
 * Why the check/install controls are absent, or null when they should show. The
 * version above them stays visible either way, so a player can still report which
 * build they're on. The profile is checked before the dev-build case because it's
 * the governing reason when set, and because it's the only way to see this state
 * under `tauri dev`.
 */
function inertReason(): string | null {
  if (!isUpdaterEnabled())
    return "Updates for this build are managed by its distributor.";
  if (import.meta.env.DEV) return "Updates are disabled in development builds.";
  return null;
}

/** Settings section at /settings/updates. */
export default function UpdatesSettingsSection() {
  const {
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
  } = useUpdater();
  const inert = inertReason();

  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="text-sm text-muted-foreground">Current version</div>
        <div className="text-lg font-medium">{version ?? "…"}</div>
      </div>

      {inert ? (
        <p className="text-sm text-muted-foreground">{inert}</p>
      ) : (
        <>
          <div className="flex items-center gap-3">
            <Button onClick={() => void runCheck()} disabled={checking}>
              {checking ? "Checking…" : "Check for updates"}
            </Button>
            {lastChecked && (
              <span className="text-xs text-muted-foreground">
                Last checked {new Date(lastChecked).toLocaleTimeString()}
              </span>
            )}
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          {!update && lastChecked && !checking && (
            <p className="text-sm text-muted-foreground">You're up to date.</p>
          )}

          {update && (
            <div className="flex flex-col gap-3 rounded-lg border p-4">
              <div className="font-medium">
                Version {update.version} available
              </div>
              {update.body && (
                <pre className="max-h-48 overflow-auto whitespace-pre-wrap text-sm text-muted-foreground">
                  {update.body}
                </pre>
              )}

              {installed ? (
                <div className="flex items-center gap-3">
                  <span className="text-sm">Installed — restart to apply.</span>
                  <Button onClick={() => void restart()}>Restart now</Button>
                </div>
              ) : progress.status === "downloading" ? (
                // The same bar, size, speed and time left as every other
                // download in the app, read off the download indicator this
                // transfer now reports to.
                <QueueProgress item={download} />
              ) : progress.status === "installing" ? (
                <div className="text-sm text-muted-foreground">Installing…</div>
              ) : (
                <Button onClick={() => void runInstall()}>
                  Download &amp; install
                </Button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
