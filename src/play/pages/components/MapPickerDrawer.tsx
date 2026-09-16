import { Button } from "@picoframe/frame";
import { X } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import type { MapItem } from "@/content/bindings";
import type { MapThumbData } from "@/content/config";
import { MapPickerGrid } from "./MapPickerGrid";

/**
 * A right-hand slide-in sheet for picking a map from a searchable thumbnail grid.
 * Built on the radix `Dialog` primitive (the `@picoframe` registry ships no
 * sheet), styled as a side panel. Selecting a thumbnail sets the map and closes.
 *
 * A thin wrapper around `MapPickerGrid`, which owns the search box and the grid
 * itself (issue #2796). Kept as its own component, with its own `Dialog`, for
 * callers that open the picker over a page rather than inside a drawer that is
 * already open.
 */
export function MapPickerDrawer({
  open,
  onOpenChange,
  maps,
  thumbs,
  selectedName,
  onSelect,
  mapsLoading,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  maps: MapItem[];
  thumbs: Map<string, MapThumbData>;
  selectedName: string;
  onSelect: (name: string) => void;
  /** The map list is still being scanned, so an empty grid means "not loaded
   * yet" rather than "no maps installed". */
  mapsLoading?: boolean;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/55 backdrop-blur-[1px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content className="fixed inset-y-0 right-0 z-50 flex w-[560px] max-w-[92vw] flex-col border-l border-border bg-background shadow-xl duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right">
          <div className="flex items-center justify-between border-b border-border/60 px-5 py-4">
            <DialogPrimitive.Title className="text-base font-semibold">
              Choose a map
            </DialogPrimitive.Title>
            <DialogPrimitive.Close asChild>
              <Button variant="ghost" size="icon" aria-label="Close">
                <X className="size-4" />
              </Button>
            </DialogPrimitive.Close>
          </div>

          <MapPickerGrid
            maps={maps}
            thumbs={thumbs}
            selectedName={selectedName}
            onSelect={(name) => {
              onSelect(name);
              onOpenChange(false);
            }}
            mapsLoading={mapsLoading}
          />
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
