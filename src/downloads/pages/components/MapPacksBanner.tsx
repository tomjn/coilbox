import { ChevronRight, Layers } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { type SuggestedMap, useSuggestedMapLists } from "@/content/branding";
import { getProfileMapLists } from "@/profile/profile";
import {
  mergeMapLists,
  packMapState,
  packSummary,
  suggestedMapToInput,
} from "../../mapLists";
import { MapPacksDrawer } from "./MapPacksDrawer";

/** A map with an optional remote thumbnail, used to enrich pack maps by filename. */
type ThumbSource = { filename: string; thumb?: string };

/**
 * Curated map packs (from the branding catalog and/or the distribution profile),
 * shown as a single banner that opens a drawer. The drawer lists each pack's maps
 * with per-map status and a "Download all"; every download goes through the shared
 * queue, which dedupes and runs serially. The banner counts only packs with maps
 * still to fetch, so fully-downloaded packs stop drawing the eye but stay
 * reviewable inside. Renders nothing when no packs are defined.
 *
 * Used both on the Downloads > Maps page (above the browsable grid, with the loaded
 * remote list as `items` for opportunistic thumbnails) and on the welcome card
 * (no `items`, so pack thumbnails come only from a map's own `thumb`).
 */
export function MapPacksBanner({
  writePath,
  installed,
  items,
}: {
  writePath?: string;
  installed: Set<string>;
  items?: ThumbSource[];
}) {
  const catalogLists = useSuggestedMapLists();
  const packs = mergeMapLists(catalogLists, getProfileMapLists());
  const [open, setOpen] = useState(false);

  // Opportunistic thumbnails: reuse a passed-in list's remote preview for any pack
  // map matched by filename. Coverage is partial and depends on the caller.
  const thumbByFile = useMemo(() => {
    const m = new Map<string, string>();
    for (const it of items ?? [])
      if (it.thumb) m.set(it.filename.toLowerCase(), it.thumb);
    return m;
  }, [items]);
  const thumbFor = useCallback(
    (map: SuggestedMap): string | undefined =>
      map.thumb?.[0] ??
      (map.filename ? thumbByFile.get(map.filename.toLowerCase()) : undefined),
    [thumbByFile],
  );

  // A pack is "available" while any map is still to download; completeness is a
  // pure on-disk check (installed filenames), independent of the queue.
  const available = useMemo(
    () =>
      packs.filter(
        (pack) =>
          !packSummary(
            pack.maps.map((map) =>
              packMapState({
                input: suggestedMapToInput(map, writePath),
                filename: map.filename,
                installed,
                queueStatus: null,
              }),
            ),
          ).complete,
      ).length,
    [packs, writePath, installed],
  );

  if (packs.length === 0) return null;

  return (
    <section className="mb-5">
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-3 rounded-lg border border-border bg-card p-4 text-left transition-colors hover:border-border hover:bg-accent/50 focus-visible:border-primary focus-visible:outline-none"
      >
        <Layers className="size-5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">Map packs</p>
          <p className="text-xs text-muted-foreground">
            {available > 0
              ? `${available} pack${available === 1 ? "" : "s"} available · curated map sets`
              : "All packs downloaded"}
          </p>
        </div>
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
      </button>
      <MapPacksDrawer
        open={open}
        onOpenChange={setOpen}
        packs={packs}
        writePath={writePath}
        installed={installed}
        thumbFor={thumbFor}
      />
    </section>
  );
}
