import { useState } from "react";
import type { GameItem } from "@/content/bindings";
import { useBrandingEntry, useBrandingImage } from "@/content/branding";
import { isSdd } from "@/content/format";
import { GameArt } from "@/content/pages/components/GameArt";
import { SddBadge } from "@/content/pages/components/SddBadge";
import { WarningIcon } from "@/content/pages/components/states";
import { versionLabel } from "@/lib/utils";
import { GamePickerDrawer } from "./GamePickerDrawer";

/**
 * The game picker: the selected game's loading-screen art (or a gradient
 * placeholder) as a 16:9 hero card with its name/version overlaid, echoing the
 * Games-grid `GameCard`. The game counterpart of `MapCard` — the whole card is a
 * single button that opens a searchable grid drawer, with a "Choose game" chip as
 * the affordance cue. Deliberately not a dropdown.
 */
export function GameSelectCard({
  game,
  games,
  headers,
  gamesLoading,
  onSelectGame,
  disabled,
}: {
  game: GameItem | null;
  games: GameItem[];
  /** Batched loading-screen art keyed by game name; absent shows the gradient. */
  headers: Map<string, string>;
  /** The game list is still being scanned, so no games are available yet. */
  gamesLoading?: boolean;
  onSelectGame: (name: string) => void;
  disabled?: boolean;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const blocked = disabled || gamesLoading;
  // Catalog branding art wins over the game's own loading-screen art.
  const brand = useBrandingEntry(game ?? undefined);
  const brandBanner = useBrandingImage(brand?.banner, true);

  return (
    <div className="group relative aspect-video overflow-hidden rounded-lg border border-border/50 bg-card shadow-sm">
      {game ? (
        <GameArt
          name={game.name}
          artUrl={brandBanner ?? headers.get(game.name)}
          alt={`${game.name} loading screen`}
        />
      ) : (
        <div className="absolute inset-0 bg-muted/40" aria-hidden />
      )}
      {/* Scrim: darken the bottom so the overlaid title/version stay legible. */}
      <div
        className="absolute inset-0 bg-gradient-to-t from-white/80 via-white/20 to-transparent dark:from-black/80 dark:via-black/20"
        aria-hidden
      />
      {/* Hover wash: a subtle brighten so the card responds to the pointer. */}
      {!blocked && (
        <div
          className="pointer-events-none absolute inset-0 bg-white/0 transition-colors duration-150 group-hover:bg-white/10"
          aria-hidden
        />
      )}

      {/* Stretched button: the whole card opens the picker. */}
      <button
        type="button"
        disabled={blocked}
        onClick={() => setPickerOpen(true)}
        aria-label={
          game ? `Choose game (current: ${game.name})` : "Choose game"
        }
        className="absolute inset-0 rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring disabled:cursor-default"
      />

      <div className="pointer-events-none absolute inset-x-3 bottom-2 flex items-end justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="flex items-center gap-1.5">
            <p
              className="truncate text-sm font-semibold text-foreground drop-shadow-[0_1px_3px_rgba(255,255,255,0.9)] dark:text-white dark:drop-shadow-[0_1px_3px_rgba(0,0,0,0.9)]"
              title={game?.name}
            >
              {game?.name ??
                (gamesLoading ? "Loading games…" : "No game selected")}
            </p>
            {game && isSdd(game.primaryArchive) && <SddBadge />}
            {game?.warnings?.length ? (
              <WarningIcon warnings={game.warnings} />
            ) : null}
          </div>
          {game?.info.version && (
            <span className="text-xs text-foreground/90 drop-shadow-[0_1px_2px_rgba(255,255,255,0.9)] dark:text-white/90 dark:drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]">
              {versionLabel(game.info.version)}
            </span>
          )}
        </div>
        <span className="shrink-0 rounded-md border border-black/20 bg-white/40 px-2 py-1 text-xs font-medium text-foreground backdrop-blur-sm group-hover:bg-white/60 dark:border-white/30 dark:bg-black/30 dark:text-white dark:group-hover:bg-black/40">
          Choose game
        </span>
      </div>

      <GamePickerDrawer
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        games={games}
        headers={headers}
        selectedName={game?.name ?? ""}
        onSelect={onSelectGame}
      />
    </div>
  );
}
