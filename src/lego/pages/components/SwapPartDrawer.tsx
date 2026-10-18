/**
 * Pick the part a piece is made of instead (issue #3294).
 *
 * Opens over the builder as a drawer, with the same search and filters as the
 * parts strip but their own state, so a search here does not change the strip.
 * The other colours of the piece's shape come first.
 */

import { Button } from "@picoframe/frame";
import { X } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { useMemo } from "react";

import type { LegoAtlas } from "../../atlas";
import { usePartFilter } from "../../filter";
import type { LegoPartInfo, LoadedPack } from "../../pack";
import { variantsFirst } from "../../swapPart";
import { NoMatches, PartFilters } from "./PartFilters";
import { TileGrid } from "./TileGrid";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pack: LoadedPack;
  /** The part the piece has now. */
  current: LegoPartInfo;
  atlas?: LegoAtlas;
  onPick: (part: LegoPartInfo) => void;
}

export function SwapPartDrawer({
  open,
  onOpenChange,
  pack,
  current,
  atlas,
  onPick,
}: Props) {
  const filter = usePartFilter(pack);
  const parts = useMemo(
    () => variantsFirst(pack, current, filter.parts),
    [pack, current, filter.parts],
  );
  const sections = useMemo(
    () => [
      {
        id: "parts",
        label: "Parts",
        total: filter.total,
        items: parts.map((part) => ({ kind: "part" as const, part })),
      },
    ],
    [filter.total, parts],
  );

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/55 backdrop-blur-[1px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="fixed inset-y-0 right-0 z-50 flex w-[560px] max-w-[92vw] flex-col border-l border-border bg-background shadow-xl duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right"
        >
          <div className="flex items-center justify-between border-b border-border/60 px-5 py-4">
            <DialogPrimitive.Title className="text-base font-semibold">
              Change part
            </DialogPrimitive.Title>
            <DialogPrimitive.Close asChild>
              <Button variant="ghost" size="icon" aria-label="Close">
                <X className="size-4" />
              </Button>
            </DialogPrimitive.Close>
          </div>
          <PartFilters
            pack={pack}
            query={filter.query}
            onQuery={filter.setQuery}
            category={filter.category}
            onCategory={filter.setCategory}
            packId={filter.packId}
            onPackId={filter.setPackId}
            shown={parts.length}
            className="border-b border-border/60 px-5 py-3"
          />
          <div className="flex min-h-0 flex-1 px-3 py-2">
            {parts.length === 0 ? (
              <NoMatches />
            ) : (
              <TileGrid
                pack={pack}
                sections={sections}
                atlas={atlas}
                onPick={(item) => item.kind === "part" && onPick(item.part)}
              />
            )}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
