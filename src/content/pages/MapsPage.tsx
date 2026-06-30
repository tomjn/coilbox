import { useMemo, useState } from "react";
import { Link } from "react-router";
import {
  useScanTargetSelection,
  useUnitsyncScan,
  useUnitsyncThumbnails,
} from "../config";
import { BrowserToolbar } from "./components/BrowserToolbar";
import { FilterBar } from "./components/FilterBar";
import { MapThumb, mapSizeLabel } from "./components/MapThumb";
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
  const { data, loading, error, run } = useUnitsyncScan(
    selected?.enginePath,
    selected?.rootPath,
  );
  const { thumbs, loading: thumbsLoading } = useUnitsyncThumbnails(
    selected?.enginePath,
    selected?.rootPath,
  );

  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<SortKey>("name-asc");

  // A map can appear in more than one archive; show each name once.
  const maps = useMemo(
    () =>
      Array.from(new Map((data?.maps ?? []).map((m) => [m.name, m])).values()),
    [data],
  );
  const busy = loading || (!!selected && !data && !error);

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
      ) : maps.length === 0 ? (
        <EmptyState label="No maps found for this engine." />
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
                className="overflow-hidden rounded-lg border border-border/50 bg-card transition-colors hover:border-border hover:bg-accent/40 hover:shadow-sm [contain-intrinsic-size:13rem] [content-visibility:auto]"
              >
                <Link to={`/content/maps/${encodeURIComponent(m.name)}`}>
                  <MapThumb
                    dataUrl={thumb}
                    width={m.width}
                    height={m.height}
                    alt={`Minimap of ${m.name}`}
                    loading={thumbsLoading && !thumb}
                  />
                  <div className="flex flex-col gap-0.5 p-2">
                    <p className="truncate text-sm font-medium" title={m.name}>
                      {m.name}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {[size, archiveLabel].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
