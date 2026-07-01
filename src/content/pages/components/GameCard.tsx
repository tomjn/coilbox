import { Button } from "@picoframe/frame";
import { Play } from "lucide-react";
import { Link } from "react-router";
import { versionLabel } from "@/lib/utils";
import type { GameItem } from "../../bindings";
import { isSdd } from "../../format";
import { GameArt } from "./GameArt";
import { SddBadge } from "./SddBadge";
import { WarningIcon } from "./states";

/**
 * A game as a 16:9 hero card for the Games grid: the game's loading-screen art
 * (or a gradient placeholder) with its name, version and a Play button overlaid on
 * a bottom scrim — a compact echo of the game detail banner.
 *
 * The whole card links to the game detail; the Play button seeds the Singleplayer
 * setup instead. To keep those two interactive targets from nesting (a `<button>`
 * inside an `<a>` is invalid and breaks keyboard use), the detail link is a
 * stretched overlay (`absolute inset-0`) and the Play button sits above it with
 * its own pointer events.
 */
export function GameCard({
  game,
  artUrl,
  loading,
  onPlay,
}: {
  game: GameItem;
  /** Resolved header art (from the batch loader); absent shows the gradient. */
  artUrl?: string;
  /** Art batch still in flight and this game has none yet — show a shimmer. */
  loading?: boolean;
  onPlay: () => void;
}) {
  return (
    <div className="group relative aspect-video overflow-hidden rounded-lg border border-border/50 bg-card shadow-sm transition-[transform,box-shadow,border-color] duration-150 hover:-translate-y-0.5 hover:border-border hover:shadow-lg hover:shadow-black/30 focus-within:ring-2 focus-within:ring-ring motion-reduce:transition-none motion-reduce:hover:translate-y-0">
      <GameArt
        name={game.name}
        artUrl={artUrl}
        alt={`${game.name} loading screen`}
      />
      {loading && !artUrl && (
        <div className="absolute inset-0 animate-pulse bg-muted-foreground/10" />
      )}
      {/* Scrim: darken the bottom so the overlaid title/version stay legible. */}
      <div
        className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent"
        aria-hidden
      />
      {/* Hover wash: a subtle brighten so the card responds to the pointer. */}
      <div
        className="pointer-events-none absolute inset-0 bg-white/0 transition-colors duration-150 group-hover:bg-white/10"
        aria-hidden
      />

      {/* Stretched link: anywhere but the Play button opens the game detail. */}
      <Link
        to={`/content/games/${encodeURIComponent(game.name)}`}
        aria-label={game.name}
        className="absolute inset-0 rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
      />

      <div className="pointer-events-none absolute inset-x-3 bottom-2 flex items-end justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="flex items-center gap-1.5">
            <p
              className="truncate text-sm font-semibold text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.9)]"
              title={game.name}
            >
              {game.name}
            </p>
            {isSdd(game.primaryArchive) && <SddBadge />}
            {game.warnings?.length ? (
              <WarningIcon warnings={game.warnings} />
            ) : null}
          </div>
          {game.info.version && (
            <span className="text-xs text-white/90 drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]">
              {versionLabel(game.info.version)}
            </span>
          )}
        </div>
        <Button
          size="sm"
          className="pointer-events-auto relative z-10 shrink-0 gap-1.5"
          onClick={onPlay}
        >
          <Play className="size-4" /> Play
        </Button>
      </div>
    </div>
  );
}
