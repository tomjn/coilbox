import { Button, useSetting } from "@picoframe/frame";
import { Download, RefreshCw } from "lucide-react";
import { useState } from "react";
import { useWriteRootPath } from "@/downloads/config";
import { useDownloadQueue } from "@/downloads/DownloadQueueProvider";
import {
  QueueProgress,
  StartingBar,
} from "@/downloads/pages/components/ProgressBar";
import { useQueuedDownload } from "@/downloads/useQueuedDownload";
import type { MapPicture } from "@/hub/assets/picture";
import { useMapPictureRung } from "@/hub/assets/useMapPicture";
import { AUTO_DOWNLOAD_ON_JOIN_KEY, useAutoDownload } from "./autoDownload";
import type { ContentPresence } from "./useBattleRoom";

/**
 * The map-not-installed state, rendered inside the minimap box (where the user is
 * already looking) instead of a separate card: download the map via the
 * pr-downloader sidecar, or rescan if it's already on disk. On success it calls
 * `onRescan`, which re-scans and remounts this card so the real minimap appears.
 */
export function MissingMapBox({
  battleId,
  mapName,
  onRescan,
  picture,
}: {
  /** The joined battle's id, to key the auto-download once per (battle, map). */
  battleId: number;
  mapName: string;
  onRescan: () => Promise<ContentPresence>;
  /**
   * Remote pictures of the map, best first, from `@/hub/assets/picture`. Shown
   * behind the controls while the map isn't installed.
   *
   * The drawing at the bottom of the ladder is skipped here, unlike everywhere
   * else it is used: this box already says the map is not installed and offers
   * the download, so an outline saying the same thing under it would be the
   * second answer to a question already answered.
   */
  picture: MapPicture[];
}) {
  const { picture: rung, onError } = useMapPictureRung(picture);
  const previewUrl = rung.from === "placeholder" ? undefined : rung.url;
  const writePath = useWriteRootPath();
  const { active, queued } = useDownloadQueue();
  const [autoEnabled] = useSetting<boolean>(AUTO_DOWNLOAD_ON_JOIN_KEY, true);
  const mapDl = useQueuedDownload({
    kind: "mapAnySource",
    label: `Map: ${mapName}`,
    args: { mapName, writePath },
  });
  const [rescanning, setRescanning] = useState(false);

  const downloading = mapDl.busy;
  const progress = mapDl.progress;
  // This box only renders while the map is missing, so a finished download with
  // no rescan running means the engine cannot see what was downloaded. Read
  // from the queue rather than held here, because a rescan remounts this box.
  const downloadedButMissing = mapDl.completed && !downloading && !rescanning;

  async function downloadMap() {
    const settled = await mapDl.start();
    if (settled?.status !== "done") return;
    await rescan();
  }

  async function rescan() {
    setRescanning(true);
    try {
      return await onRescan();
    } finally {
      setRescanning(false);
    }
  }

  // What joining a battle starts. The scan this box was drawn from can be as
  // old as the session, so look again before fetching a map that may already
  // be on disk, and never repeat a download that has already finished once.
  async function downloadIfStillMissing() {
    const found = await rescan();
    if (found.map || mapDl.completed) return;
    await downloadMap();
  }

  // On join, start the same download the button fires (issue #439) — this box only
  // renders when the map is missing, so mounting means the required map is absent.
  // Idempotent and gated so it fires once and never fights the queue.
  useAutoDownload({
    key: `${battleId}:map:${mapName}`,
    enabled: autoEnabled,
    writeRootReady: !!writePath,
    queueIdle: active == null && queued.length === 0,
    inFlight: downloading,
    start: downloadIfStillMissing,
  });

  return (
    <>
      {previewUrl && (
        // Covers the whole minimap box (absolute → the positioned MinimapPreview
        // frame). Pointer-transparent so the controls above stay interactive.
        <img
          src={previewUrl}
          alt=""
          aria-hidden
          // A picture that fails to load drops to the next rung rather than
          // leaving a broken image behind the controls. The last rung is the
          // drawing, which has no URL, so this terminates.
          onError={onError}
          className="pointer-events-none absolute inset-0 size-full object-cover"
        />
      )}
      <div
        className={
          previewUrl
            ? "relative flex w-full max-w-56 flex-col items-center gap-2 rounded-md bg-background/75 p-3 text-center backdrop-blur-sm"
            : "flex w-full flex-col items-center gap-2 text-center"
        }
      >
        <span className="text-xs font-medium text-muted-foreground">
          Map not installed
        </span>
        {downloadedButMissing && (
          <span className="text-xs">
            Downloaded to {writePath}, but the engine still does not list this
            map. The file may be a different version, or one the engine cannot
            read.
          </span>
        )}
        {mapDl.status === "active" ? (
          progress ? (
            <QueueProgress item={mapDl} className="w-full" />
          ) : (
            <StartingBar className="w-full" />
          )
        ) : (
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button
              size="sm"
              variant={downloadedButMissing ? "secondary" : undefined}
              disabled={downloading}
              onClick={downloadMap}
            >
              <Download className="size-4" />
              {mapDl.status === "queued"
                ? "Queued…"
                : downloadedButMissing
                  ? "Download again"
                  : "Download"}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={rescanning || downloading}
              onClick={rescan}
            >
              <RefreshCw
                className={rescanning ? "size-4 animate-spin" : "size-4"}
              />
              Rescan
            </Button>
          </div>
        )}
        {mapDl.error && (
          <span className="text-xs text-destructive">{mapDl.error}</span>
        )}
      </div>
    </>
  );
}
