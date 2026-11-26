import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@picoframe/frame";
import { Loader2 } from "lucide-react";
import { SettingList, SettingRow } from "@/components/SettingRow";
import { formatDateTime } from "@/lib/format";
import { QueueProgress } from "../../downloads/pages/components/ProgressBar";
import { isUpdaterEnabled } from "../../profile/profile";
import { useUpdater } from "../UpdaterProvider";

/** Settings section at /settings/updates. */
export default function UpdatesSettingsSection() {
  const { t } = useLingui();
  const {
    version,
    update,
    checking,
    lastChecked,
    checkError,
    installError,
    progress,
    download,
    installed,
    runCheck,
    runInstall,
    restart,
  } = useUpdater();

  // Why the check and install controls are absent, or null when they show.
  // The version stays visible either way, so a player can still say which
  // build they are on. The profile comes first because it is the governing
  // reason when set, and the only way to see this state under `tauri dev`.
  const inert = !isUpdaterEnabled()
    ? t`Updates for this build come from its distributor.`
    : import.meta.env.DEV
      ? t`Updates are off in development builds.`
      : null;

  const newVersion = update?.version;
  const lastCheckedText = lastChecked
    ? formatDateTime(lastChecked, { dateStyle: "medium", timeStyle: "short" })
    : null;
  // A check now would swap the update out from under a running install.
  const installing = installed || progress.status !== "idle";

  // What the last check found. A failed check shows its error instead, and
  // must not still claim the app is up to date from an earlier check.
  const checkStatus = checking
    ? t`Checking…`
    : checkError || !lastCheckedText
      ? undefined
      : update
        ? t`Version ${newVersion} available. Last checked ${lastCheckedText}`
        : t`Up to date. Last checked ${lastCheckedText}`;

  return (
    <div className="flex flex-col gap-10">
      {/* An update available is the action worth taking, so it gets the
          primary-styled card and button. Checking is the secondary one. */}
      {!inert && update && (
        <section className="flex flex-col gap-3 rounded-lg border border-primary/60 bg-primary/5 p-4">
          <h2 className="text-sm font-semibold">
            <Trans>Version {newVersion} available</Trans>
          </h2>
          {update.body && (
            <pre className="max-h-48 select-text overflow-auto whitespace-pre-wrap font-sans text-sm text-muted-foreground">
              {update.body}
            </pre>
          )}

          {installed ? (
            <div className="flex items-center gap-3">
              <span className="text-sm">
                <Trans>Installed. Restart to apply.</Trans>
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
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              <Trans>Installing…</Trans>
            </div>
          ) : (
            <div>
              <Button onClick={() => void runInstall()}>
                <Trans>Download &amp; install</Trans>
              </Button>
            </div>
          )}

          {installError && (
            <p
              role="alert"
              className="select-text break-words text-sm text-destructive"
            >
              {installError}
            </p>
          )}
        </section>
      )}

      <SettingList>
        <SettingRow label={t`Version`} description={inert ?? undefined}>
          <span className="select-text font-mono text-sm">
            {version ?? "…"}
          </span>
        </SettingRow>
        {!inert && (
          <SettingRow
            label={t`Check for updates`}
            description={checkStatus}
            error={checkError}
          >
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void runCheck()}
              disabled={checking || installing}
            >
              {checking && <Loader2 className="size-4 animate-spin" />}
              <Trans>Check now</Trans>
            </Button>
          </SettingRow>
        )}
      </SettingList>
    </div>
  );
}
