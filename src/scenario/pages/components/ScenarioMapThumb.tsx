/**
 * The map a scenario row is set on, drawn at the size of a row (issue #2177).
 *
 * The picture is the same batch of rendered minimaps the maps pages draw, which
 * `ContentStartupProvider` primes once at startup and keeps for the session, so
 * a list of these costs no worker calls however many rows it has. Asking each
 * row for its own minimap would have been one call per row instead.
 *
 * Nothing here takes focus. The row is already a link into the editor and the
 * thumbnail sits inside it, so an image and a span are all this may be.
 */

import { AlertTriangle } from "lucide-react";
import type { MapThumbData } from "@/content/config";
import { MapThumb } from "@/content/pages/components/MapThumb";

export function ScenarioMapThumb({
  mapName,
  thumbs,
  installedMaps,
  loading,
}: {
  /** The scenario's `setup.mapName`, empty on a draft that has not picked one. */
  mapName?: string;
  /** Every rendered minimap for the current target, by map name. */
  thumbs: Map<string, MapThumbData>;
  /**
   * Every map this machine has, or null until the scan has said. Null rather
   * than an empty set because a scan still running knows of no maps, and would
   * otherwise have every row call its map missing.
   */
  installedMaps: Set<string> | null;
  /** Whether the minimaps are still rendering. */
  loading: boolean;
}) {
  const thumb = mapName ? thumbs.get(mapName) : undefined;
  // The two empty slots are different facts, so they are drawn differently. A
  // scenario with no map is unfinished and its author knows it, and gets the
  // same quiet glyph an empty thumbnail gets anywhere else. A scenario whose
  // map is missing looks finished and will not play, which is worth seeing from
  // the list rather than after opening it, so it is marked the way the setup
  // panel marks content this machine does not have.
  const missing = !!mapName && !!installedMaps && !installedMaps.has(mapName);

  return (
    <div className="w-14 shrink-0 overflow-hidden rounded-md border border-border/50">
      {missing ? (
        <div className="flex aspect-square items-center justify-center bg-muted">
          <AlertTriangle
            className="size-5 text-amber-600 dark:text-amber-400"
            aria-hidden="true"
          />
          <span className="sr-only">{mapName} is not installed</span>
        </div>
      ) : (
        <>
          <MapThumb
            url={thumb?.url}
            width={thumb?.width}
            height={thumb?.height}
            alt={mapName ? `Minimap of ${mapName}` : ""}
            loading={!!mapName && loading && !thumb}
          />
          {!mapName && <span className="sr-only">No map yet</span>}
        </>
      )}
    </div>
  );
}
