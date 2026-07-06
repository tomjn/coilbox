import { Button } from "@picoframe/frame";
import { ArrowLeft, Play } from "lucide-react";
import { Link } from "react-router";
import { versionLabel } from "@/lib/utils";
import type { GameItem } from "../../bindings";
import { useBrandingEntry, useBrandingImage } from "../../branding";
import { useUnitsyncGameHeaders } from "../../config";
import { isSdd } from "../../format";
import { GameArt } from "./GameArt";
import { SddBadge } from "./SddBadge";

/**
 * Steam-library-style hero banner for a game. Always renders a full-bleed 292px
 * banner: a deterministic gradient placeholder as the base layer, with the game's
 * resolved loading-screen art (when available) cropped over it. The back-link,
 * title, version and Play button overlay the banner.
 */
export function GameHeader({
  game,
  enginePath,
  dataDir,
  onPlay,
}: {
  game: GameItem;
  enginePath?: string;
  dataDir?: string;
  onPlay: () => void;
}) {
  // Same art source as the Games grid: the batch loader keyed on cheap file
  // identity. Unlike the old per-game loader it needs no sync checksum (which
  // some engine builds don't expose), so the banner resolves whenever the grid
  // does — and shows the identical image.
  const { headers } = useUnitsyncGameHeaders(enginePath, dataDir);
  const brand = useBrandingEntry(game);
  const brandBanner = useBrandingImage(brand?.banner, true);
  // Catalog art wins; the game's own loading-screen art is the fallback.
  const artUrl = brandBanner ?? headers.get(game.name);

  return (
    <header className="relative -mx-4 -mt-4 h-[292px] overflow-hidden">
      {/* Base + art layers (deterministic gradient, then loading-screen image).
          Constrained to the top 75% so the image's bottom edge lands exactly
          where the scrim below reaches full opacity, rather than being drawn
          (and wasted) underneath it. */}
      <div className="absolute inset-x-0 top-0 bottom-1/4">
        <GameArt
          name={game.name}
          artUrl={artUrl}
          alt={`${game.name} loading screen`}
        />
      </div>
      {/* Scrim: fade into the page background along the bottom for text contrast.
          Fully opaque across the bottom 25% (where the art stops). */}
      <div
        className="absolute inset-0 bg-gradient-to-t from-background from-25% to-transparent to-50%"
        aria-hidden
      />

      <Link
        to="/content/games"
        className="absolute left-3 top-3 inline-flex items-center gap-1 rounded bg-black/40 px-2 py-1 text-xs text-white backdrop-blur-sm hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
      >
        <ArrowLeft className="size-3.5" /> Games
      </Link>

      <div className="absolute inset-x-4 bottom-3 flex items-end justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex items-center gap-2">
            <h1 className="break-words text-lg font-semibold text-foreground dark:text-white dark:drop-shadow-[0_1px_3px_rgba(0,0,0,0.9)]">
              {brand?.title ?? game.name}
            </h1>
            {isSdd(game.primaryArchive) && <SddBadge />}
          </div>
          {game.info.version && (
            <span className="text-xs text-foreground/90 dark:text-white/90 dark:drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]">
              {versionLabel(game.info.version)}
            </span>
          )}
        </div>
        <Button size="sm" className="shrink-0 gap-1.5" onClick={onPlay}>
          <Play className="size-4" /> Play
        </Button>
      </div>
    </header>
  );
}
