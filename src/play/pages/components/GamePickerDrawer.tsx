import { Button } from "@picoframe/frame";
import { X } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import type { GameItem } from "@/content/bindings";
import { GamePickerGrid } from "./GamePickerGrid";

/**
 * A right-hand slide-in sheet for picking a game from a searchable grid of
 * tiles. The game counterpart of `MapPickerDrawer`: same radix `Dialog` sheet,
 * but each tile is a 16:9 loading-screen image over a caption band rather than
 * a square minimap. Selecting a tile sets the game and closes.
 *
 * A thin wrapper around `GamePickerGrid`, which owns the search box and the
 * grid itself. Kept for callers that open the picker over a page rather than
 * inside a drawer that is already open.
 */
export function GamePickerDrawer({
  open,
  onOpenChange,
  games,
  headers,
  selectedName,
  onSelect,
  gamesLoading,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  games: readonly GameItem[];
  /** Batched loading-screen art keyed by game name. A game without any shows
   *  the gradient. */
  headers: Map<string, string>;
  selectedName: string;
  onSelect: (name: string) => void;
  gamesLoading?: boolean;
}) {
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

          <GamePickerGrid
            games={games}
            headers={headers}
            selectedName={selectedName}
            onSelect={(name) => {
              onSelect(name);
              onOpenChange(false);
            }}
            gamesLoading={gamesLoading}
          />
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
