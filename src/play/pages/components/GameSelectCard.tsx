import { useState } from "react";
import type { GameItem } from "@/content/bindings";
import { useBrandingEntry, useBrandingImage } from "@/content/branding";
import { isSdd } from "@/content/format";
import { GameCardShell } from "@/content/pages/components/GameCardShell";
import { GamePickerDrawer } from "./GamePickerDrawer";

/**
 * The game picker: the selected game rendered through the shared
 * {@link GameCardShell} (art over a caption band), echoing the Games-grid card.
 * The game counterpart of `MapCard` — the whole card is a single button that
 * opens a searchable grid drawer, with a "Choose game" chip as the affordance
 * cue. Deliberately not a dropdown.
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
    <GameCardShell
      name={game?.name ?? ""}
      title={
        game?.name ?? (gamesLoading ? "Loading games…" : "No game selected")
      }
      artUrl={game ? (brandBanner ?? headers.get(game.name)) : undefined}
      alt={game ? `${game.name} loading screen` : "No game selected"}
      art={
        game ? undefined : (
          <div className="absolute inset-0 bg-muted/40" aria-hidden />
        )
      }
      version={game?.info.version}
      sdd={game ? isSdd(game.primaryArchive) : false}
      warnings={game?.warnings}
      action={
        <span className="shrink-0 rounded-md border border-border/60 bg-muted/40 px-2 py-1 text-xs font-medium text-foreground group-hover:bg-muted">
          Choose game
        </span>
      }
    >
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

      <GamePickerDrawer
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        games={games}
        headers={headers}
        selectedName={game?.name ?? ""}
        onSelect={onSelectGame}
      />
    </GameCardShell>
  );
}
