import { Button } from "@picoframe/frame";
import { ArrowLeft, Play } from "lucide-react";
import { Link } from "react-router";
import type { GameItem } from "../../bindings";
import { useGameHeaderImage } from "../../config";
import { isSdd } from "../../format";
import { SddBadge } from "./SddBadge";

/**
 * Steam-library-style hero banner for a game. Always renders a full-bleed 192px
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
  const { data } = useGameHeaderImage(
    enginePath,
    dataDir,
    game.primaryArchive.name,
    game.checksum,
    game.info.loadpicture,
  );
  const artUrl = data?.dataUrl;

  return (
    <header className="relative -mx-4 -mt-4 h-48 w-full overflow-hidden">
      {/* Base layer: deterministic gradient so every game has a hero. */}
      <div
        className="absolute inset-0"
        style={{ background: gradientFor(game.name) }}
        aria-hidden
      />
      {/* Art layer: loading-screen image cropped to the wide/short strip. */}
      {artUrl && (
        <img
          src={artUrl}
          alt={`${game.name} loading screen`}
          className="absolute inset-0 size-full animate-[fadein_240ms_ease-out] object-cover object-center motion-reduce:animate-none"
        />
      )}
      {/* Scrim: fade into the page background along the bottom for text contrast. */}
      <div
        className="absolute inset-0 bg-gradient-to-t from-background via-background/40 to-transparent"
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
            <h1 className="break-words text-lg font-semibold text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.9)]">
              {game.name}
            </h1>
            {isSdd(game.primaryArchive) && <SddBadge />}
          </div>
          {game.info.version && (
            <span className="text-xs text-white/90 drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]">
              v{game.info.version}
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

/** A stable dark diagonal gradient derived from the game name (placeholder art). */
function gradientFor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0;
  }
  const h1 = Math.abs(hash) % 360;
  const h2 = (h1 + 40) % 360;
  return `linear-gradient(135deg, hsl(${h1} 45% 22%), hsl(${h2} 50% 12%))`;
}
