import { Button } from "@picoframe/frame";
import { Play } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { dlInstalledContent } from "../../downloads/bindings";
import { useContentRootPaths, useWriteRootPath } from "../../downloads/config";
import { filterUninstalledMaps, useSuggestedMaps } from "../branding";
import {
  useScanTargetSelection,
  useUnitsyncMapMeta,
  useUnitsyncScan,
  useUnitsyncThumbnails,
} from "../config";
import { mergeMapTiers } from "../mapTiers";
import { usePlayMap } from "../usePlayMap";
import { BrowserToolbar } from "./components/BrowserToolbar";
import { FilterBar } from "./components/FilterBar";
import { MapThumb, mapSizeLabel } from "./components/MapThumb";
import { SuggestionsList } from "./components/SuggestionsList";
import {
  Diagnostics,
  EmptyState,
  ErrorBanner,
  SkeletonList,
} from "./components/states";

type SortKey = "name-asc" | "name-desc" | "area-desc" | "area-asc";

const SORT_OPTIONS = [
  { value: "name-asc", label: "Name A–Z" },
  { value: "name-desc", label: "Name Z–A" },
  { value: "area-desc", label: "Largest" },
  { value: "area-asc", label: "Smallest" },
];

const mapArea = (m: { width?: number; height?: number }) =>
  (m.width ?? 0) * (m.height ?? 0);

/**
 * A grid of map thumbnails for the selected engine's content. Names + metadata
 * come from the scan; the minimap thumbnails are rendered as a batch (one
 * unitsync session) and fill in as they arrive. Both are cached for the session.
 */
export default function MapsPage() {
  const { targets, selected, selectedKey, setSelectedKey } =
    useScanTargetSelection();
  const { data, loading, error, cancelled, run, cancel } = useUnitsyncScan(
    selected?.enginePath,
    selected?.rootPath,
  );
  const { thumbs, loading: thumbsLoading } = useUnitsyncThumbnails(
    selected?.enginePath,
    selected?.rootPath,
  );
  const { meta } = useUnitsyncMapMeta(selected?.enginePath, selected?.rootPath);
  const playMap = usePlayMap();

  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<SortKey>("name-asc");

  // A map can appear in more than one archive; show each name once.
  // Proportions come from the thumbnail pass, which reads them while it already
  // has the archive open, so the size label and the area sorts fill in alongside
  // the minimaps rather than holding up the list.
  const maps = useMemo(() => {
    const unique = Array.from(
      new Map((data?.maps ?? []).map((m) => [m.name, m])).values(),
    );
    return mergeMapTiers(unique, thumbs, meta);
  }, [data, thumbs, meta]);
  const busy = loading || (!!selected && !data && !error && !cancelled);

  // Curated download suggestions shown when this engine sees no maps.
  const writePath = useWriteRootPath();
  const suggested = useSuggestedMaps();
  const rootPaths = useContentRootPaths();
  const [installed, setInstalled] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (rootPaths.length === 0) return;
    dlInstalledContent({ paths: rootPaths })
      .then(({ maps }) => setInstalled(new Set(maps)))
      .catch(() => setInstalled(new Set()));
  }, [rootPaths]);
  const suggestions = useMemo(
    () => filterUninstalledMaps(suggested, installed, maps),
    [suggested, installed, maps],
  );

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return maps;
    return maps.filter((m) => m.name.toLowerCase().includes(q));
  }, [maps, filter]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      switch (sort) {
        case "name-desc":
          return b.name.localeCompare(a.name);
        case "area-desc":
          return mapArea(b) - mapArea(a);
        case "area-asc":
          return mapArea(a) - mapArea(b);
        default:
          return a.name.localeCompare(b.name);
      }
    });
    return arr;
  }, [filtered, sort]);

  return (
    <div className="flex flex-col gap-4 p-4">
      <header className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold">Maps</h1>
        <p className="text-sm text-muted-foreground">
          Maps found in your content folders, read from their archives.
        </p>
      </header>

      <BrowserToolbar
        targets={targets}
        selectedKey={selectedKey}
        onSelect={setSelectedKey}
        onRescan={() => run(true)}
        scanning={loading}
        onCancel={cancel}
      />

      {!busy && maps.length > 0 && (
        <FilterBar
          search={filter}
          onSearch={setFilter}
          searchPlaceholder="Filter maps…"
          searchLabel="Filter maps"
          sort={sort}
          onSort={(v) => setSort(v as SortKey)}
          sortOptions={SORT_OPTIONS}
          total={maps.length}
          shown={sorted.length}
          noun="maps"
        />
      )}

      {error && <ErrorBanner message={error} />}
      {data?.errors?.length ? <Diagnostics errors={data.errors} /> : null}

      {targets.length === 0 ? null : busy ? (
        <SkeletonList />
      ) : cancelled && maps.length === 0 ? (
        <EmptyState label="Scan cancelled. Press Rescan to load maps." />
      ) : maps.length === 0 ? (
        suggestions.length > 0 ? (
          <SuggestionsList
            kind="map"
            heading="No maps yet — try one of these"
            items={suggestions}
            writePath={writePath}
            onComplete={() => run(true)}
          />
        ) : (
          <EmptyState label="No maps found for this engine." />
        )
      ) : sorted.length === 0 ? (
        <EmptyState label={`No maps match “${filter.trim()}”.`} />
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-3">
          {sorted.map((m) => {
            const size = mapSizeLabel(m.width, m.height);
            const thumb = thumbs.get(m.name);
            const archiveLabel = `${m.archives.length} archive${
              m.archives.length === 1 ? "" : "s"
            }`;
            return (
              <li
                key={m.name}
                className="group relative overflow-hidden rounded-lg border border-border/50 bg-card transition-colors hover:border-border hover:bg-accent/50 hover:shadow-md [contain-intrinsic-size:13rem] [content-visibility:auto]"
              >
                <MapThumb
                  url={thumb?.url}
                  width={m.width}
                  height={m.height}
                  alt={`Minimap of ${m.name}`}
                  loading={thumbsLoading && !thumb}
                />
                {/* Stretched link: anywhere but the Play button opens the map detail. */}
                <Link
                  to={`/content/maps/${encodeURIComponent(m.name)}`}
                  aria-label={m.name}
                  className="absolute inset-0 rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
                />
                <div className="flex items-center justify-between gap-2 p-2">
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <p className="truncate text-sm font-medium" title={m.name}>
                      {m.name}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {[size, archiveLabel].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    aria-label="Play"
                    className="pointer-events-auto relative z-10 shrink-0"
                    onClick={() => playMap(m.name)}
                  >
                    <Play className="size-4 fill-current" />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
