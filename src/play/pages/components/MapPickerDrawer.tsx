import { Button, Input } from "@picoframe/frame";
import { ImageOff, Search, X } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { useMemo, useState } from "react";
import type { MapItem } from "@/content/bindings";
import { mapSizeLabel } from "@/content/pages/components/MapThumb";
import { cn } from "@/lib/utils";

/** Unique id for a map: its name plus its own archive (distinguishes variants). */
const mapId = (m: MapItem) => `${m.name}::${m.archives[0]?.name ?? ""}`;

/**
 * A right-hand slide-in sheet for picking a map from a searchable thumbnail grid.
 * Built on the radix `Dialog` primitive (the `@picoframe` registry ships no
 * sheet), styled as a side panel. Selecting a thumbnail sets the map and closes.
 */
export function MapPickerDrawer({
  open,
  onOpenChange,
  maps,
  thumbs,
  selectedName,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  maps: MapItem[];
  thumbs: Map<string, string>;
  selectedName: string;
  onSelect: (name: string) => void;
}) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    // De-dupe by name + own-archive: collapses true duplicates (same map listed
    // twice) while keeping genuine same-named variants (e.g. a packaged `.sd7` and
    // a decompiled `.sdd`). The composite is unique, so it's also a safe React key
    // — a colliding key here corrupts the grid across searches.
    const seen = new Set<string>();
    const unique = maps.filter((m) => {
      const id = mapId(m);
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
    const q = query.trim().toLowerCase();
    return q ? unique.filter((m) => m.name.toLowerCase().includes(q)) : unique;
  }, [maps, query]);

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

          <div className="px-5 pb-1 pt-4">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={`Search ${maps.length} maps…`}
                className="pl-9"
              />
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            <div className="grid grid-cols-3 content-start gap-3">
              {filtered.map((m) => {
                const thumb = thumbs.get(m.name);
                const size = mapSizeLabel(m.width, m.height);
                // The map's own archive disambiguates same-named variants (e.g. a
                // packaged `.sd7` vs a decompiled `.sdd`).
                const archiveName = m.archives[0]?.name;
                return (
                  <button
                    key={mapId(m)}
                    type="button"
                    onClick={() => {
                      onSelect(m.name);
                      onOpenChange(false);
                    }}
                    className={cn(
                      "flex flex-col overflow-hidden rounded-lg border bg-card text-left transition-colors hover:border-primary focus-visible:border-primary focus-visible:outline-none",
                      m.name === selectedName
                        ? "border-primary ring-2 ring-primary/25"
                        : "border-border/60",
                    )}
                  >
                    <div className="flex aspect-square items-center justify-center overflow-hidden bg-muted/40">
                      {thumb ? (
                        <img
                          src={thumb}
                          alt={`Minimap of ${m.name}`}
                          style={{
                            aspectRatio:
                              m.width && m.height
                                ? `${m.width} / ${m.height}`
                                : "1 / 1",
                            // unitsync thumbnails are square; stretch back to the
                            // map's real proportions (object-fill), letterboxed in
                            // the square cell by fixing the longer axis to 100%.
                            width:
                              !m.width || !m.height || m.width >= m.height
                                ? "100%"
                                : "auto",
                            height:
                              !m.width || !m.height || m.width >= m.height
                                ? "auto"
                                : "100%",
                          }}
                          className="object-fill"
                        />
                      ) : (
                        <ImageOff className="size-6 text-muted-foreground" />
                      )}
                    </div>
                    <div className="px-2.5 py-2">
                      <span className="line-clamp-2 block text-xs font-medium">
                        {m.name}
                      </span>
                      <div className="mt-0.5 flex flex-col text-[11px] text-muted-foreground">
                        {size && <span>{size}</span>}
                        {archiveName && (
                          <span className="truncate" title={archiveName}>
                            {archiveName}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
              {filtered.length === 0 && (
                <p className="col-span-3 py-8 text-center text-sm text-muted-foreground">
                  No maps match “{query}”.
                </p>
              )}
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
