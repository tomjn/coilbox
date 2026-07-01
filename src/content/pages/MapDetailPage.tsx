import { ArrowLeft, ImageOff } from "lucide-react";
import { Link, useParams } from "react-router";
import { MapPreview3D } from "../../mapconv/pages/components/MapPreview3D";
import {
  classifyArchive,
  useScanTargetSelection,
  useUnitsyncHeightmap,
  useUnitsyncMapInfo,
  useUnitsyncMinimap,
  useUnitsyncScan,
} from "../config";
import { ArchiveRow } from "./components/ArchiveRow";
import { mapSizeLabel } from "./components/MapThumb";
import { OptionsList } from "./components/OptionsList";
import {
  DetailError,
  DetailLoading,
  NotFound,
  WarningBanner,
} from "./components/states";

/** Keys shown in the headline; everything else goes in the metadata table. */
const HEADLINE_KEYS = new Set(["name", "description"]);

/** A single map: a minimap preview, its metadata, and the archives it's from. */
export default function MapDetailPage() {
  const { name } = useParams();
  const decoded = name ? decodeURIComponent(name) : "";
  const { selected } = useScanTargetSelection();
  const { data, loading, error, run } = useUnitsyncScan(
    selected?.enginePath,
    selected?.rootPath,
  );
  const minimap = useUnitsyncMinimap(
    selected?.enginePath,
    selected?.rootPath,
    decoded,
  );
  const heightmap = useUnitsyncHeightmap(
    selected?.enginePath,
    selected?.rootPath,
    decoded,
  );
  const mapInfo = useUnitsyncMapInfo(
    selected?.enginePath,
    selected?.rootPath,
    decoded,
  );

  if (error && !data)
    return (
      <DetailError
        backTo="/content/maps"
        message={error}
        onRetry={() => run(true)}
      />
    );
  if (!data || loading) return <DetailLoading backTo="/content/maps" />;
  const map = data.maps.find((m) => m.name === decoded);
  if (!map) return <NotFound backTo="/content/maps" label="map" />;

  const otherInfo = Object.entries(map.info).filter(
    ([k]) => !HEADLINE_KEYS.has(k),
  );
  const size = mapSizeLabel(map.width, map.height);

  // Start positions are in world coords; the map's world size is its metal-map
  // dimension * 16, so normalise to 0..1 for overlaying on the (object-fill,
  // aspect-correct) minimap.
  const worldW = (map.width ?? 0) * 16;
  const worldH = (map.height ?? 0) * 16;
  const markers =
    worldW > 0 && worldH > 0
      ? minimap.startPositions.map((p) => ({
          key: `${p.x},${p.z}`,
          left: (p.x / worldW) * 100,
          top: (p.z / worldH) * 100,
        }))
      : [];

  // The 3D preview only renders when both its inputs are ready. When it does, the
  // minimap is height-capped to it (see the preview row below).
  const show3D = !!(heightmap.data?.dataUrl && minimap.dataUrl);

  return (
    <div className="flex flex-col gap-5 p-4">
      <header className="flex flex-col gap-1">
        <Link
          to="/content/maps"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline"
        >
          <ArrowLeft className="size-3.5" /> Maps
        </Link>
        <h1 className="break-words text-lg font-semibold">{map.name}</h1>
        <div className="flex flex-wrap gap-x-3 gap-y-1 font-mono text-xs text-muted-foreground">
          {size && <span>{size}</span>}
          {map.fileName && <span className="break-all">{map.fileName}</span>}
          {map.checksum && <span>checksum {map.checksum}</span>}
        </div>
        {map.info.description && (
          <p className="mt-1 max-w-prose text-sm text-muted-foreground">
            {map.info.description}
          </p>
        )}
      </header>

      {mapInfo.info?.warnings?.length ? (
        <WarningBanner warnings={mapInfo.info.warnings} noun="map" />
      ) : null}

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">
          Preview
          {minimap.startPositions.length > 0
            ? ` · ${minimap.startPositions.length} start positions`
            : ""}
        </h2>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-stretch">
          <div className="relative w-full max-w-sm shrink-0 overflow-hidden rounded-lg border border-border/50 bg-card">
            {/* When the 3D preview is shown, this layer is absolutely filled on
                `lg` so the minimap doesn't drive the row height — the 3D preview
                does, and the minimap is contained (centered, capped) within it. */}
            <div
              className={`flex h-full items-center justify-center${show3D ? " lg:absolute lg:inset-0" : ""}`}
            >
              {minimap.loading ? (
                <div className="size-32 animate-pulse rounded bg-muted" />
              ) : minimap.dataUrl ? (
                <div className="relative inline-flex max-h-full max-w-full">
                  <img
                    src={minimap.dataUrl}
                    alt={`Minimap of ${map.name}`}
                    style={{
                      aspectRatio:
                        map.width && map.height
                          ? `${map.width} / ${map.height}`
                          : "1 / 1",
                    }}
                    className="block max-h-full max-w-full object-fill"
                  />
                  {markers.map((m, i) => (
                    <span
                      key={m.key}
                      className="absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white bg-primary shadow"
                      style={{ left: `${m.left}%`, top: `${m.top}%` }}
                      title={`Start position ${i + 1}`}
                    />
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center gap-1 text-muted-foreground">
                  <ImageOff className="size-6" />
                  <span className="text-xs">No minimap</span>
                </div>
              )}
            </div>
          </div>

          {heightmap.data?.dataUrl && minimap.dataUrl && (
            <MapPreview3D
              className="w-full min-w-0 lg:flex-1"
              heightSrc={heightmap.data.dataUrl}
              textureSrc={minimap.dataUrl}
              minHeight={heightmap.data.minHeight ?? 0}
              maxHeight={heightmap.data.maxHeight ?? 0}
              worldWidth={
                heightmap.data.width
                  ? (heightmap.data.width - 1) * 8
                  : (map.width ?? 1) * 16
              }
              worldHeight={
                heightmap.data.height
                  ? (heightmap.data.height - 1) * 8
                  : (map.height ?? 1) * 16
              }
            />
          )}
        </div>
      </section>

      <OptionsList options={mapInfo.info?.options ?? []} title="Map options" />

      {otherInfo.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium">Metadata</h2>
          <dl className="grid grid-cols-[minmax(8rem,auto)_1fr] gap-x-4 gap-y-1 rounded-lg border border-border/50 bg-card p-3 text-sm">
            {otherInfo.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="font-mono text-xs text-muted-foreground">{k}</dt>
                <dd className="break-words">{v}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">
          Archives ({map.archives.length})
        </h2>
        {map.archives.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No archives reported for this map.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {map.archives.map((a, i) => (
              <ArchiveRow
                key={a.name}
                archive={a}
                // Skip the self-classification on the map's own archive (i === 0)
                // so it doesn't render a redundant "View map" back to this page.
                classification={
                  i === 0 ? undefined : classifyArchive(data, a.name)
                }
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
