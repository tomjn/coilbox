import { Button } from "@picoframe/frame";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  ImageOff,
  Loader2,
  X,
} from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import type { SuggestedMap, SuggestedMapList } from "@/content/branding";
import {
  identityOf,
  type QueueItem,
  useDownloadQueue,
} from "../../DownloadQueueProvider";
import {
  type PackMapState,
  packMapState,
  packSummary,
  suggestedMapToInput,
} from "../../mapLists";
import { CachedThumb } from "./CachedThumb";
import { QueueProgress } from "./ProgressBar";

/**
 * A right-hand slide-in sheet for browsing curated map packs. Two levels: a list
 * of packs, and a per-pack detail listing its maps with download status and
 * per-map actions. Built on the radix `Dialog` primitive (the `@picoframe`
 * registry ships no sheet), mirroring `MapPickerDrawer`. Owns nothing about which
 * packs exist — it renders whatever `packs` it's handed and drives the shared
 * download queue itself.
 */
export function MapPacksDrawer({
  open,
  onOpenChange,
  packs,
  writePath,
  installed,
  thumbFor,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  packs: SuggestedMapList[];
  writePath?: string;
  installed: Set<string>;
  thumbFor?: (map: SuggestedMap) => string | undefined;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = packs.find((p) => p.id === selectedId) ?? null;

  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        // Reset to the list whenever the drawer closes, so it reopens at the top.
        if (!next) setSelectedId(null);
        onOpenChange(next);
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/55 backdrop-blur-[1px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content className="fixed inset-y-0 right-0 z-50 flex w-[560px] max-w-[92vw] flex-col border-l border-border bg-background shadow-xl duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right">
          <div className="flex items-center gap-2 border-b border-border/60 px-5 py-4">
            {selected && (
              <Button
                variant="ghost"
                size="icon"
                aria-label="Back to all packs"
                onClick={() => setSelectedId(null)}
              >
                <ChevronLeft className="size-4" />
              </Button>
            )}
            <DialogPrimitive.Title className="min-w-0 flex-1 truncate text-base font-semibold">
              {selected ? selected.title : "Map packs"}
            </DialogPrimitive.Title>
            <DialogPrimitive.Close asChild>
              <Button variant="ghost" size="icon" aria-label="Close">
                <X className="size-4" />
              </Button>
            </DialogPrimitive.Close>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            {selected ? (
              <PackDetail
                pack={selected}
                writePath={writePath}
                installed={installed}
                thumbFor={thumbFor}
              />
            ) : (
              <PackList
                packs={packs}
                writePath={writePath}
                installed={installed}
                onSelect={setSelectedId}
              />
            )}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** Compute each map's state and roll them up, shared by list rows and detail. */
function usePackStates(
  pack: SuggestedMapList,
  writePath: string | undefined,
  installed: Set<string>,
) {
  const { itemFor } = useDownloadQueue();
  return useMemo(() => {
    const rows = pack.maps.map((map) => {
      const input = suggestedMapToInput(map, writePath);
      const item = input ? itemFor(identityOf(input)) : null;
      const state = packMapState({
        input,
        filename: map.filename,
        installed,
        queueStatus: item?.status ?? null,
      });
      return { map, input, item, state };
    });
    return { rows, summary: packSummary(rows.map((r) => r.state)) };
  }, [pack, writePath, installed, itemFor]);
}

function PackList({
  packs,
  writePath,
  installed,
  onSelect,
}: {
  packs: SuggestedMapList[];
  writePath?: string;
  installed: Set<string>;
  onSelect: (id: string) => void;
}) {
  return (
    <ul className="flex flex-col gap-2">
      {packs.map((pack) => (
        <PackRow
          key={pack.id}
          pack={pack}
          writePath={writePath}
          installed={installed}
          onSelect={onSelect}
        />
      ))}
    </ul>
  );
}

function PackRow({
  pack,
  writePath,
  installed,
  onSelect,
}: {
  pack: SuggestedMapList;
  writePath?: string;
  installed: Set<string>;
  onSelect: (id: string) => void;
}) {
  const { summary } = usePackStates(pack, writePath, installed);
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(pack.id)}
        className="flex w-full items-center gap-3 rounded-lg border border-border/50 bg-card p-3 text-left transition-colors hover:border-border hover:bg-accent/50 focus-visible:border-primary focus-visible:outline-none"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-medium">{pack.title}</p>
            {summary.complete && (
              <Badge variant="outline" className="gap-1 text-emerald-600">
                <Check className="size-3" />
                Complete
              </Badge>
            )}
          </div>
          {pack.blurb && (
            <p className="line-clamp-2 text-xs text-muted-foreground">
              {pack.blurb}
            </p>
          )}
          <p className="mt-1 text-xs text-muted-foreground">
            {summary.done} / {summary.total} downloaded
          </p>
        </div>
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
      </button>
    </li>
  );
}

function PackDetail({
  pack,
  writePath,
  installed,
  thumbFor,
}: {
  pack: SuggestedMapList;
  writePath?: string;
  installed: Set<string>;
  thumbFor?: (map: SuggestedMap) => string | undefined;
}) {
  const { enqueue } = useDownloadQueue();
  const { rows, summary } = usePackStates(pack, writePath, installed);
  const downloadAll = () => {
    for (const r of rows)
      if (r.state === "available" && r.input) enqueue(r.input);
  };
  return (
    <div className="flex flex-col gap-3">
      {pack.blurb && (
        <p className="text-xs text-muted-foreground">{pack.blurb}</p>
      )}
      <Button
        variant="outline"
        size="sm"
        className="w-full"
        onClick={downloadAll}
        disabled={!writePath || summary.pending === 0}
        aria-label={`Download all maps in ${pack.title}`}
      >
        <Download className="size-4" />
        {summary.complete
          ? "All downloaded"
          : summary.pending === 0
            ? "Queued"
            : `Download all (${summary.pending})`}
      </Button>
      <ul className="flex flex-col gap-2">
        {rows.map(({ map, input, item, state }) => (
          <MapRow
            key={map.id}
            map={map}
            thumb={thumbFor?.(map)}
            state={state}
            item={item}
            canDownload={!!writePath && !!input}
            onDownload={() => input && enqueue(input)}
          />
        ))}
      </ul>
    </div>
  );
}

function MapRow({
  map,
  thumb,
  state,
  item,
  canDownload,
  onDownload,
}: {
  map: SuggestedMap;
  thumb?: string;
  state: PackMapState;
  item: QueueItem | null;
  canDownload: boolean;
  onDownload: () => void;
}) {
  return (
    <li className="flex items-center gap-3 rounded-lg border border-border/50 bg-card p-2">
      <div className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded bg-muted/40">
        <CachedThumb
          url={thumb}
          alt={`Minimap of ${map.title}`}
          className="size-full object-cover"
          fallback={<ImageOff className="size-4 text-muted-foreground" />}
        />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{map.title}</p>
        {/* The bar takes the blurb's line rather than adding one, so a row that
            is downloading is the same height as a row that is not. */}
        {item?.progress ? (
          <QueueProgress item={item} />
        ) : (
          map.blurb && (
            <p className="line-clamp-1 text-xs text-muted-foreground">
              {map.blurb}
            </p>
          )
        )}
      </div>
      <MapAction
        state={state}
        canDownload={canDownload}
        onDownload={onDownload}
      />
    </li>
  );
}

function MapAction({
  state,
  canDownload,
  onDownload,
}: {
  state: PackMapState;
  canDownload: boolean;
  onDownload: () => void;
}) {
  if (state === "installed") {
    return (
      <span className="flex items-center gap-1 px-1 text-xs text-emerald-600">
        <Check className="size-4" />
        Installed
      </span>
    );
  }
  if (state === "active" || state === "queued") {
    return (
      <span className="flex items-center gap-1 px-1 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" />
        {state === "active" ? "Downloading…" : "Queued"}
      </span>
    );
  }
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={onDownload}
      disabled={!canDownload || state === "unavailable"}
      aria-label="Download map"
    >
      <Download className="size-4" />
      {state === "unavailable" ? "Unavailable" : "Download"}
    </Button>
  );
}
