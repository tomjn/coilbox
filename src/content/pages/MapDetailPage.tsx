import { ArrowLeft, ImageOff } from "lucide-react";
import { Link, useParams } from "react-router";
import {
  useScanTargetSelection,
  useUnitsyncMinimap,
  useUnitsyncScan,
} from "../config";
import { ArchiveRow } from "./components/ArchiveRow";
import { mapSizeLabel } from "./components/MapThumb";
import { DetailLoading, NotFound } from "./components/states";

/** Keys shown in the headline; everything else goes in the metadata table. */
const HEADLINE_KEYS = new Set(["name", "description"]);

/** A single map: a minimap preview, its metadata, and the archives it's from. */
export default function MapDetailPage() {
  const { name } = useParams();
  const decoded = name ? decodeURIComponent(name) : "";
  const { selected } = useScanTargetSelection();
  const { data, loading } = useUnitsyncScan(
    selected?.enginePath,
    selected?.rootPath,
  );
  const minimap = useUnitsyncMinimap(
    selected?.enginePath,
    selected?.rootPath,
    decoded,
  );

  if (!data || loading) return <DetailLoading backTo="/content/maps" />;
  const map = data.maps.find((m) => m.name === decoded);
  if (!map) return <NotFound backTo="/content/maps" label="map" />;

  const otherInfo = Object.entries(map.info).filter(
    ([k]) => !HEADLINE_KEYS.has(k),
  );
  const size = mapSizeLabel(map.width, map.height);

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

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">Preview</h2>
        <div
          className="flex w-full max-w-sm items-center justify-center overflow-hidden rounded-lg border border-border/50 bg-card"
          style={{
            aspectRatio:
              map.width && map.height
                ? `${map.width} / ${map.height}`
                : "1 / 1",
          }}
        >
          {minimap.loading ? (
            <div className="size-full animate-pulse bg-muted" />
          ) : minimap.dataUrl ? (
            <img
              src={minimap.dataUrl}
              alt={`Minimap of ${map.name}`}
              className="size-full object-fill"
            />
          ) : (
            <div className="flex flex-col items-center gap-1 text-muted-foreground">
              <ImageOff className="size-6" />
              <span className="text-xs">No minimap</span>
            </div>
          )}
        </div>
      </section>

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
            {map.archives.map((a) => (
              <ArchiveRow key={a.name} archive={a} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
