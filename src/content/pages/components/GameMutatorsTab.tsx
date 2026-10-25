import { Trans } from "@lingui/react/macro";
import { Button } from "@picoframe/frame";
import { Play } from "lucide-react";
import { Link } from "react-router";
import { isDeletableArchive } from "../../format";
import type { LibraryGame } from "../../library";
import { DeleteArchiveButton } from "./DeleteArchiveButton";

/**
 * The mutators built on a game: each one's name and mode, with Play and Delete.
 * The name links to the mutator's own page.
 */
export function GameMutatorsTab({
  mutators,
  onPlay,
}: {
  mutators: readonly LibraryGame[];
  onPlay: (gameName: string) => void;
}) {
  return (
    <ul className="divide-y divide-border/40 rounded-lg border border-border/60 bg-card">
      {mutators.map((m) => {
        const game = m.installed[0];
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
