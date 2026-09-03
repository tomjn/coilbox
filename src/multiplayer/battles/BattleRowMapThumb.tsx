import { Download, Loader2 } from "lucide-react";
import { useState } from "react";
import {
  invalidateMapPreview,
  primeScan,
  THUMB_MINIMAP_MIP,
  useUnitsyncMinimap,
} from "../../content/config";
import { MapThumb } from "../../content/pages/components/MapThumb";
import { useWriteRootPath } from "../../downloads/config";
import { useQueuedDownload } from "../../downloads/useQueuedDownload";
import type { Battle } from "../bindings";

/**
 * A battle row's minimap box, and also its "download this map" control (issue
 * #2373). The minimap renders from the LOCAL unitsync copy only, so a blank
 * result already means "not installed here" (see `BattleRow`'s docstring), and
 * that same box is where the download lives, rather than adding a fourth
 * control to a right-hand edge that already carries an invite link and a join
 * button.
 *
 * Rendered as its own element, outside the row's join button: once a map is
 * missing this box becomes a button in its own right, and a button cannot nest
 * inside another button (the row's join button wraps the title instead, see
 * `SuggestedMapCard` in `src/home/zones/SuggestedMap.tsx` for the same rule
 * applied to a card). Installed, it goes back to being the plain minimap
 * `BattleRow` always drew.
 */
export function BattleRowMapThumb({
  battle,
  enginePath,
  dataDir,
}: {
  battle: Battle;
  enginePath?: string;
  dataDir?: string;
}) {
  const writePath = useWriteRootPath();
  // Bumped after a download lands, to remount `Minimap` with a fresh
  // `useUnitsyncMinimap` call: that hook's effect only reruns on
  // enginePath/dataDir/mapName/mip, none of which change when a map appears on
  // disk. Remounting with a new `key` is the pattern `invalidateMapPreview`'s
  // own doc comment describes, and what `BattleRoomPage` does with its
  // `contentNonce` for the same reason.
  const [nonce, setNonce] = useState(0);

  return (
    <Minimap
      key={nonce}
      battle={battle}
      enginePath={enginePath}
      dataDir={dataDir}
      writePath={writePath}
      onDownloaded={() => setNonce((n) => n + 1)}
    />
  );
}

function Minimap({
  battle,
  enginePath,
  dataDir,
  writePath,
  onDownloaded,
}: {
  battle: Battle;
  enginePath?: string;
  dataDir?: string;
  writePath?: string;
  onDownloaded: () => void;
}) {
  const { url, loading } = useUnitsyncMinimap(
    enginePath,
    dataDir,
    battle.map,
    THUMB_MINIMAP_MIP,
  );
  // Not installed: unitsync answered (or can't be asked) and produced nothing.
  const missing = !loading && !url;
  const mapDl = useQueuedDownload(
    missing
      ? {
          kind: "mapAnySource",
          label: `Map: ${battle.map}`,
          args: { mapName: battle.map, writePath },
        }
      : null,
  );
  const downloading = mapDl.busy;

  async function download() {
    const settled = await mapDl.start();
    if (settled?.status !== "done") return;
    if (enginePath && dataDir) {
      invalidateMapPreview(enginePath, dataDir, battle.map);
      await primeScan(enginePath, dataDir, true).catch(() => {});
    }
    onDownloaded();
  }

  if (!missing) {
    return (
      <div className="w-14 shrink-0 overflow-hidden rounded-md border border-border">
        <MapThumb
          url={url ?? undefined}
          loading={loading}
          alt={`Minimap of ${battle.map}`}
        />
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={download}
      disabled={downloading}
      aria-label={
        downloading
          ? `Downloading map for ${battle.title}`
          : mapDl.error
            ? `Retry downloading the map for ${battle.title}`
            : `Download the map for ${battle.title}`
      }
      title={
        downloading
          ? "Downloading…"
          : mapDl.error
            ? `Download failed: ${mapDl.error}`
            : "Map not installed. Click to download."
      }
      className="flex aspect-square w-14 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-muted text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground disabled:cursor-wait disabled:hover:bg-muted disabled:hover:text-muted-foreground"
    >
      {downloading ? (
        <Loader2 className="size-6 animate-spin" aria-hidden />
      ) : (
        <Download className="size-6" aria-hidden />
      )}
    </button>
  );
}
