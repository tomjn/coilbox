import { Trans, useLingui } from "@lingui/react/macro";
import { Button, cn } from "@picoframe/frame";
import { Loader2 } from "lucide-react";
import Markdown, { type Components } from "react-markdown";
import { Link } from "react-router";
import { SettingList, SettingRow } from "@/components/SettingRow";
import { useWriteRoot } from "../../downloads/config";
import { QueueProgress } from "../../downloads/pages/components/ProgressBar";
import { externalOnlyLink } from "../../lib/MarkdownLink";
import { GFM_PLUGINS, GFM_PROSE_CLASSES } from "../../lib/markdownGfm";
import { useGameUpdates } from "../GameUpdatesProvider";

/**
 * A release body is written by whoever cut the release, and points at github.com
 * when it points anywhere. Clicking one of its links opens it in the browser
 * instead of drawing the release page over Coilbox, which has no way back (issue
 * #1789).
 *
 * That is what lets the render carry {@link GFM_PLUGINS}, which turns the bare
 * URL GitHub appends as the "Full Changelog" line into a link the reader can
 * follow (issue #1791).
 */
const CHANGELOG_COMPONENTS: Components = {
  a: externalOnlyLink("game updates"),
};

/** Settings section at /settings/game-updates. */
export default function GameUpdatesSection() {
  const { t } = useLingui();
  const {
    repo,
    release,
    checking,
    checkError,
    installError,
    updateAvailable,
    upToDate,
    installing,
    installed,
    profileUpdated,
    currentFile,
    download,
    runCheck,
    install,
    restart,
  } = useGameUpdates();
  const { path: writePath, loading: writeRootLoading } = useWriteRoot("games");
  // Only once the read has landed and said there is none. Before that `writePath`
  // is undefined whatever the user has configured (issue #1104).
  const noWriteRoot = !writeRootLoading && !writePath;

  const releaseName = release ? release.name || release.tag : "";
  const fileName = currentFile ?? "…";

  if (!repo) {
    return (
      <p className="text-sm text-muted-foreground">
        <Trans>This build has no game-update source configured.</Trans>
      </p>
    );
  }

  // An install ends by re-reading the games folder, which then has the
  // release, so `updateAvailable` goes false. The card stays for the result
  // and the restart a new profile needs.
  const showUpdate = updateAvailable || installing || installed;

  // What the last check found. A failed check shows its error instead, and
  // must not still claim the game is up to date from an earlier check. An
  // available update is the card above, so this only names the release.
  const checkStatus = checking
    ? t`Checking…`
    : checkError || !release
      ? undefined
      : upToDate
        ? t`Up to date with ${releaseName}`
        : t`Latest release ${releaseName}`;

  return (
    <div className="flex flex-col gap-10">
      {/* An update available is the action worth taking, so it gets the
          primary-styled card and button, as on the Coilbox updates page. */}
      {release && showUpdate && (
        <section className="flex flex-col gap-3 rounded-lg border border-primary/60 bg-primary/5 p-4">
          <h2 className="text-sm font-semibold">
            <Trans>{releaseName} available</Trans>
          </h2>
          {release.body && (
            <div
              className={cn(
                "max-h-64 overflow-auto rounded-md bg-muted/40 p-3 text-sm [&_a]:text-primary [&_a]:underline [&_code]:font-mono [&_h1]:mt-2 [&_h1]:font-semibold [&_h2]:mt-2 [&_h2]:font-semibold [&_li]:ml-4 [&_li]:list-disc [&_p]:my-1",
                GFM_PROSE_CLASSES,
              )}
            >
              <Markdown
                components={CHANGELOG_COMPONENTS}
                remarkPlugins={GFM_PLUGINS}
              >
                {release.body}
              </Markdown>
            </div>
          )}

          {installed ? (
            profileUpdated ? (
              <div className="flex items-center gap-3">
                <span className="text-sm">
                  <Trans>Installed. Restart to apply the new profile.</Trans>
                </span>
                <Button onClick={() => void restart()}>
                  <Trans>Restart now</Trans>
                </Button>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                <Trans>Installed.</Trans>
              </p>
            )
          ) : installing ? (
            <div className="flex flex-col gap-2">
              <div className="text-sm text-muted-foreground">
                <Trans>Downloading {fileName}</Trans>
              </div>
              <QueueProgress item={download} />
            </div>
          ) : (
            <>
              {noWriteRoot && (
                <p className="text-sm text-muted-foreground">
                  <Trans>
                    Set a download folder in{" "}
                    <Link
                      className="underline underline-offset-4"
                      to="/settings/content-folders"
                    >
                      Content folders
                    </Link>{" "}
                    to install updates.
                  </Trans>
                </p>
              )}
              <div>
                <Button onClick={() => void install()} disabled={!writePath}>
                  <Trans>Download &amp; install</Trans>
                </Button>
              </div>
            </>
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
        <SettingRow label={t`Update source`}>
          <span className="select-text font-mono text-sm">{repo}</span>
        </SettingRow>
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
      </SettingList>
    </div>
  );
}
