import { Trans } from "@lingui/react/macro";
import { Button } from "@picoframe/frame";
import { Download, Loader2, Play } from "lucide-react";
import { Link } from "react-router";
import { isDeletableArchive } from "../../format";
import type { LibraryGame } from "../../library";
import { DeleteArchiveButton } from "./DeleteArchiveButton";

/**
 * The mutators built on a game: each one's name and mode, with Play and Delete.
 * The name links to the mutator's own page. A mutator the hub lists that is not
 * installed has an Install button in their place and no page to link to.
 */
export function GameMutatorsTab({
  mutators,
  onPlay,
  canInstall,
  onInstall,
  installing,
  failures,
}: {
  mutators: readonly LibraryGame[];
  onPlay: (gameName: string) => void;
  /** A download folder is set. */
  canInstall: boolean;
  onInstall: (mutator: LibraryGame) => void;
  /** Ids of the mutators whose hub sources are being turned into a download. */
  installing: ReadonlySet<string>;
  /** Why the last install of a mutator failed, by id. */
  failures: Readonly<Record<string, string>>;
}) {
  return (
    <ul className="divide-y divide-border/40 rounded-lg border border-border/60 bg-card">
      {mutators.map((m) => {
        const game = m.installed[0];
        if (!game) {
          const running = m.state === "downloading" || m.state === "queued";
          const busy = installing.has(m.id) || running;
          const failure = failures[m.id] ?? m.download?.error;
          return (
            <li key={m.id} className="flex items-center gap-3 p-3">
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="break-words text-sm font-medium">
                  {m.title}
                </span>
                {failure && !running && (
                  <span className="break-words text-xs text-destructive">
                    {failure}
                  </span>
                )}
              </div>
              {m.state === "noSource" ? (
                <span className="shrink-0 text-xs text-destructive">
                  <Trans>no download source</Trans>
                </span>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="shrink-0 gap-1.5"
                  disabled={!canInstall || busy}
                  onClick={() => onInstall(m)}
                >
                  {busy ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Download className="size-4" />
                  )}
                  <Trans>Install</Trans>
                </Button>
              )}
            </li>
          );
        }
        const path = game.primaryArchive.path;
        const mode = game.info.mutator;
        return (
          <li key={m.id} className="flex items-center gap-3 p-3">
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <Link
                to={`/library/games/${encodeURIComponent(game.name)}`}
                className="break-words text-sm font-medium hover:underline"
              >
                {game.name}
              </Link>
              {mode && (
                <span className="break-words text-xs text-muted-foreground">
                  {mode}
                </span>
              )}
            </div>
            <Button
              type="button"
              size="sm"
              className="shrink-0 gap-1.5"
              onClick={() => onPlay(game.name)}
            >
              <Play className="size-4 fill-current" /> <Trans>Play</Trans>
            </Button>
            {path && isDeletableArchive(path) && (
              <DeleteArchiveButton
                path={path}
                name={game.primaryArchive.name}
                onDeleted={() => {}}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}
