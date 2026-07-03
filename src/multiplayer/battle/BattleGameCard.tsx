import type { GameItem } from "@/content/bindings";
import { useBrandingEntry, useBrandingImage } from "@/content/branding";
import { useUnitsyncGameHeaders } from "@/content/config";
import { isSdd } from "@/content/format";
import { GameCardShell } from "@/content/pages/components/GameCardShell";

/**
 * Read-only game display for the joined battle: the same `GameCardShell` art card
 * as the singleplayer picker, but with no picker (the autohost owns the game). It
 * shows the game name even when the game isn't installed locally.
 */
export function BattleGameCard({
  enginePath,
  dataDir,
  game,
  gameName,
}: {
  enginePath: string | undefined;
  dataDir: string | undefined;
  game: GameItem | undefined;
  gameName: string;
}) {
  const { headers } = useUnitsyncGameHeaders(enginePath, dataDir);
  const brand = useBrandingEntry(game ?? undefined);
  const brandBanner = useBrandingImage(brand?.banner, true);

  return (
    <GameCardShell
      name={game?.name ?? gameName}
      title={game?.name ?? gameName}
      artUrl={game ? (brandBanner ?? headers.get(game.name)) : undefined}
      alt={`${game?.name ?? gameName} loading screen`}
      version={game?.info.version}
      sdd={game ? isSdd(game.primaryArchive) : false}
      warnings={game?.warnings}
      // Half the usual 16:9 height; the art is center-cropped so the logo stays.
      artClassName="aspect-[32/9]"
    />
  );
}
