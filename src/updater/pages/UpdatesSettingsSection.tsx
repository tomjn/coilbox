import { Trans } from "@lingui/react/macro";
import { Button } from "@picoframe/frame";
import type { ReactNode } from "react";
import { formatTime } from "@/lib/format";
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
function inertReason(): ReactNode {
  if (!isUpdaterEnabled())
    return (
      <Trans>Updates for this build are managed by its distributor.</Trans>
    );
  if (import.meta.env.DEV)
    return <Trans>Updates are disabled in development builds.</Trans>;
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
  const newVersion = update?.version;
  const lastCheckedTime = lastChecked
    ? formatTime(new Date(lastChecked))
    : null;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="text-sm text-muted-foreground">
          <Trans>Current version</Trans>
        </div>
        <div className="text-lg font-medium">{version ?? "…"}</div>
      </div>

      {inert ? (
        <p className="text-sm text-muted-foreground">{inert}</p>
      ) : (
        <>
          {/* An update available is the action worth taking, so it gets the
            primary-styled card and button. Checking is the secondary one. */}
          {update && (
            <div className="flex flex-col gap-3 rounded-lg border border-primary/60 bg-primary/5 p-4">
              <div className="font-medium">
                <Trans>Version {newVersion} available</Trans>
              </div>
              {update.body && (
                <pre className="max-h-48 overflow-auto whitespace-pre-wrap text-sm text-muted-foreground">
                  {update.body}
                </pre>
              )}

              {installed ? (
                <div className="flex items-center gap-3">
                  <span className="text-sm">
                    <Trans>Installed — restart to apply.</Trans>
                  </span>
                  <Button onClick={() => void restart()}>
                    <Trans>Restart now</Trans>
                  </Button>
                </div>
              ) : progress.status === "downloading" ? (
                // The same bar, size, speed and time left as every other
                // download in the app, read off the download indicator this
                // transfer now reports to.
                <QueueProgress item={download} />
              ) : progress.status === "installing" ? (
                <div className="text-sm text-muted-foreground">
                  <Trans>Installing…</Trans>
                </div>
              ) : (
                <Button onClick={() => void runInstall()}>
                  <Trans>Download &amp; install</Trans>
                </Button>
              )}
            </div>
          )}

          <div className="flex items-center gap-3">
            <Button
              variant="secondary"
              onClick={() => void runCheck()}
              disabled={checking}
            >
              {checking ? (
                <Trans>Checking…</Trans>
              ) : (
                <Trans>Check for updates</Trans>
              )}
            </Button>
            {lastCheckedTime && (
              <span className="text-xs text-muted-foreground">
                <Trans>Last checked {lastCheckedTime}</Trans>
              </span>
            )}
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          {!update && lastChecked && !checking && (
            <p className="text-sm text-muted-foreground">
              <Trans>You're up to date.</Trans>
            </p>
          )}
        </>
      )}
    </div>
  );
}
