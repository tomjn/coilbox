import { Button, Input } from "@picoframe/frame";
import { Search, X } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { useMemo, useState } from "react";
import type { GameItem } from "@/content/bindings";
import { isSdd } from "@/content/format";
import { GameArt } from "@/content/pages/components/GameArt";
import { SddBadge } from "@/content/pages/components/SddBadge";
import { WarningIcon } from "@/content/pages/components/states";
import { cn, versionLabel } from "@/lib/utils";

/** Unique id for a game: its name plus its own primary archive (matches GamesPage). */
const gameId = (g: GameItem) => `${g.primaryArchive.name}:${g.name}`;

/**
 * A right-hand slide-in sheet for picking a game from a searchable grid of hero
 * tiles. The game counterpart of `MapPickerDrawer`: same radix `Dialog` sheet,
 * but each tile is a 16:9 loading-screen card (via `GameArt`) rather than a square
 * minimap. Selecting a tile sets the game and closes.
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
                <button
                  key={gameId(g)}
                  type="button"
                  onClick={() => {
                    onSelect(g.name);
                    onOpenChange(false);
                  }}
                  className={cn(
                    "group relative aspect-video overflow-hidden rounded-lg border bg-card text-left transition-colors hover:border-primary focus-visible:border-primary focus-visible:outline-none",
                    g.name === selectedName
                      ? "border-primary ring-2 ring-primary/25"
                      : "border-border/60",
                  )}
                >
                  <GameArt
                    name={g.name}
                    artUrl={headers.get(g.name)}
                    alt={`${g.name} loading screen`}
                  />
                  <div
                    className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent"
                    aria-hidden
                  />
                  <div className="absolute inset-x-2.5 bottom-2 flex flex-col gap-0.5">
                    <div className="flex items-center gap-1.5">
                      <span
                        className="truncate text-xs font-semibold text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.9)]"
                        title={g.name}
                      >
                        {g.name}
                      </span>
                      {isSdd(g.primaryArchive) && <SddBadge />}
                      {g.warnings?.length ? (
                        <WarningIcon warnings={g.warnings} />
                      ) : null}
                    </div>
                    {g.info.version && (
                      <span className="text-[11px] text-white/90 drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]">
                        {versionLabel(g.info.version)}
                      </span>
                    )}
                  </div>
                </button>
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
