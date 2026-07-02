import { Button, Input } from "@picoframe/frame";
import { Search, X } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { useMemo, useState } from "react";
import type { GameItem } from "@/content/bindings";
import { useBrandingEntry, useBrandingImage } from "@/content/branding";
import { isSdd } from "@/content/format";
import { GameCardShell } from "@/content/pages/components/GameCardShell";

/** Unique id for a game: its name plus its own primary archive (matches GamesPage). */
const gameId = (g: GameItem) => `${g.primaryArchive.name}:${g.name}`;

/**
 * One picker tile: the shared {@link GameCardShell} wrapped in a stretched select
 * button. A component (not an inline call) so the branding hooks run per game
 * without breaking the rules of hooks in the map.
 */
function GameTile({
  game,
  headers,
  selected,
  onSelect,
}: {
  game: GameItem;
  headers: Map<string, string>;
  selected: boolean;
  onSelect: () => void;
}) {
  const brand = useBrandingEntry(game);
  const brandBanner = useBrandingImage(brand?.banner, true);
  return (
    <GameCardShell
      name={game.name}
      title={brand?.title ?? game.name}
      artUrl={brandBanner ?? headers.get(game.name)}
      alt={`${game.name} loading screen`}
      version={game.info.version}
      sdd={isSdd(game.primaryArchive)}
      warnings={game.warnings}
      selected={selected}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-label={game.name}
        aria-pressed={selected}
        className="absolute inset-0 rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
      />
    </GameCardShell>
  );
}

/**
 * A right-hand slide-in sheet for picking a game from a searchable grid of
 * tiles. The game counterpart of `MapPickerDrawer`: same radix `Dialog` sheet,
 * but each tile is a 16:9 loading-screen image (via `GameArt`) over a caption
 * band rather than a square minimap. Selecting a tile sets the game and closes.
 */
export function GamePickerDrawer({
  open,
  onOpenChange,
  games,
  headers,
  selectedName,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  games: GameItem[];
  /** Batched loading-screen art keyed by game name; absent shows the gradient. */
  headers: Map<string, string>;
  selectedName: string;
  onSelect: (name: string) => void;
}) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return games;
    return games.filter(
      (g) =>
        g.name.toLowerCase().includes(q) ||
        g.primaryArchive.name.toLowerCase().includes(q),
    );
  }, [games, query]);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/55 backdrop-blur-[1px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content className="fixed inset-y-0 right-0 z-50 flex w-[560px] max-w-[92vw] flex-col border-l border-border bg-background shadow-xl duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right">
          <div className="flex items-center justify-between border-b border-border/60 px-5 py-4">
            <DialogPrimitive.Title className="text-base font-semibold">
              Choose a game
            </DialogPrimitive.Title>
            <DialogPrimitive.Close asChild>
              <Button variant="ghost" size="icon" aria-label="Close">
                <X className="size-4" />
              </Button>
            </DialogPrimitive.Close>
          </div>

          <div className="px-5 pb-1 pt-4">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={`Search ${games.length} games…`}
                className="pl-9"
              />
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            <div className="grid grid-cols-2 content-start gap-3">
              {filtered.map((g) => (
                <GameTile
                  key={gameId(g)}
                  game={g}
                  headers={headers}
                  selected={g.name === selectedName}
                  onSelect={() => {
                    onSelect(g.name);
                    onOpenChange(false);
                  }}
                />
              ))}
              {filtered.length === 0 && (
                <p className="col-span-2 py-8 text-center text-sm text-muted-foreground">
                  No games match “{query}”.
                </p>
              )}
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
