import { Link } from "react-router";
import {
  useScanTargetSelection,
  useUnitsyncScan,
  useUnitsyncThumbnails,
} from "../config";
import { BrowserToolbar } from "./components/BrowserToolbar";
import { MapThumb, mapSizeLabel } from "./components/MapThumb";
import {
  Diagnostics,
  EmptyState,
  ErrorBanner,
  SkeletonList,
} from "./components/states";

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

  // A map can appear in more than one archive; show each name once.
  const maps = Array.from(
    new Map((data?.maps ?? []).map((m) => [m.name, m])).values(),
  );
  const busy = loading || (!!selected && !data && !error);

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

      {error && <ErrorBanner message={error} />}
      {data?.errors?.length ? <Diagnostics errors={data.errors} /> : null}

      {targets.length === 0 ? null : busy ? (
        <SkeletonList />
      ) : maps.length === 0 ? (
        <EmptyState label="No maps found for this engine." />
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-3">
          {maps.map((m) => {
            const size = mapSizeLabel(m.width, m.height);
            const thumb = thumbs.get(m.name);
            const archiveLabel = `${m.archives.length} archive${
              m.archives.length === 1 ? "" : "s"
            }`;
            return (
              <li
                key={m.name}
                className="overflow-hidden rounded-lg border border-border/50 bg-card transition-colors hover:border-border [contain-intrinsic-size:13rem] [content-visibility:auto]"
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
