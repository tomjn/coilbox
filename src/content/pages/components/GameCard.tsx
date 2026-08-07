import { Button } from "@picoframe/frame";
import { Play } from "lucide-react";
import { Link } from "react-router";
import { generatedGameNote } from "@/lib/generatedGames";
import type { GameItem } from "../../bindings";
import { useBrandingEntry, useBrandingImage } from "../../branding";
import { isSdd } from "../../format";
import { GameCardShell } from "./GameCardShell";

/**
 * A game card for the Games grid: 16:9 loading-screen art (or a gradient
 * placeholder) over a solid caption band with the name, version and a Play
 * button — rendered through the shared {@link GameCardShell}.
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
  const brand = useBrandingEntry(game);
  const brandBanner = useBrandingImage(brand?.banner, true);
  const art = brandBanner ?? artUrl;
  return (
    <GameCardShell
      name={game.name}
      title={brand?.title ?? game.name}
      artUrl={art}
      alt={`${game.name} loading screen`}
      version={game.info.version}
      sdd={isSdd(game.primaryArchive)}
      generated={generatedGameNote(game.primaryArchive.name)}
      warnings={game.warnings}
      loading={loading}
      action={
        <Button
          size="sm"
          aria-label="Play"
          className="pointer-events-auto relative z-10 shrink-0"
          onClick={onPlay}
        >
          <Play className="size-4 fill-current" />
        </Button>
      }
    >
      {/* Stretched link: anywhere but the Play button opens the game detail. */}
      <Link
        to={`/content/games/${encodeURIComponent(game.name)}`}
        aria-label={game.name}
        className="absolute inset-0 rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
      />
    </GameCardShell>
  );
}
