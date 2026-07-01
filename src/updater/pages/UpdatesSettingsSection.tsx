import { Button } from "@picoframe/frame";
import { useUpdater } from "../UpdaterProvider";

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
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
    installed,
    runCheck,
    runInstall,
    restart,
  } = useUpdater();

  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="text-sm text-muted-foreground">Current version</div>
        <div className="text-lg font-medium">{version ?? "…"}</div>
      </div>

      {import.meta.env.DEV ? (
        <p className="text-sm text-muted-foreground">
          Updates are disabled in development builds.
        </p>
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
                <div className="text-sm text-muted-foreground">
                  Downloading… {formatBytes(progress.downloaded)}
                  {progress.total ? ` / ${formatBytes(progress.total)}` : ""}
                </div>
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
