import { Button } from "@picoframe/frame";
import Markdown from "react-markdown";
import { Link } from "react-router";
import { useWriteRoot } from "../../downloads/config";
import { ProgressBar } from "../../downloads/pages/components/ProgressBar";
import { useGameUpdates } from "../GameUpdatesProvider";

/** Settings section at /settings/game-updates. */
export default function GameUpdatesSection() {
  const {
    repo,
    release,
    checking,
    error,
    updateAvailable,
    installing,
    installed,
    profileUpdated,
    currentFile,
    progress,
    runCheck,
    install,
    restart,
  } = useGameUpdates();
  const { path: writePath, loading: writeRootLoading } = useWriteRoot();
  // Only once the read has landed and said there is none. Before that `writePath`
  // is undefined whatever the user has configured (issue #1104).
  const noWriteRoot = !writeRootLoading && !writePath;

  if (!repo) {
    return (
      <p className="text-sm text-muted-foreground">
        This build has no game-update source configured.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="text-sm text-muted-foreground">Update source</div>
        <div className="font-mono text-sm">{repo}</div>
      </div>

      <div className="flex items-center gap-3">
        <Button onClick={() => void runCheck()} disabled={checking}>
          {checking ? "Checking…" : "Check for updates"}
        </Button>
        {release && (
          <span className="text-xs text-muted-foreground">
            Latest: {release.name || release.tag}
          </span>
        )}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {noWriteRoot && (
        <p className="text-sm text-muted-foreground">
          Set a download folder in{" "}
          <Link
            className="underline underline-offset-4"
            to="/settings/downloads"
          >
            Downloads settings
          </Link>{" "}
          to enable updates.
        </p>
      )}

      {release && !updateAvailable && !checking && (
        <p className="text-sm text-muted-foreground">
          You have the latest game version ({release.tag}).
        </p>
      )}

      {release && updateAvailable && (
        <div className="flex flex-col gap-3 rounded-lg border p-4">
          <div className="font-medium">
            {release.name || release.tag} available
          </div>
          {release.body && (
            <div className="max-h-64 overflow-auto rounded-md bg-muted/40 p-3 text-sm [&_a]:text-primary [&_a]:underline [&_code]:font-mono [&_h1]:mt-2 [&_h1]:font-semibold [&_h2]:mt-2 [&_h2]:font-semibold [&_li]:ml-4 [&_li]:list-disc [&_p]:my-1">
              <Markdown>{release.body}</Markdown>
            </div>
          )}

          {installed ? (
            profileUpdated ? (
              <div className="flex items-center gap-3">
                <span className="text-sm">
                  Installed — restart to apply the updated profile.
                </span>
                <Button onClick={() => void restart()}>Restart now</Button>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Installed and ready.
              </p>
            )
          ) : installing ? (
            <div className="flex flex-col gap-2">
              <div className="text-sm text-muted-foreground">
                Downloading {currentFile ?? "…"}
              </div>
              {progress && <ProgressBar progress={progress} />}
            </div>
          ) : (
            <Button onClick={() => void install()} disabled={!writePath}>
              Download &amp; install
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
