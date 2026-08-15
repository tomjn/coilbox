import { Button, useSetting } from "@picoframe/frame";
import { Channel } from "@tauri-apps/api/core";
import { Download, RefreshCw } from "lucide-react";
import { useState } from "react";
import type { DownloadProgress } from "@/downloads/bindings";
import { useWriteRootPath } from "@/downloads/config";
import { useDownloadQueue } from "@/downloads/DownloadQueueProvider";
import { downloadMapAnySource } from "@/downloads/downloadMap";
import { ProgressBar } from "@/downloads/pages/components/ProgressBar";
import { errMessage } from "@/downloads/pages/components/states";
import type { MapPicture } from "@/hub/assets/picture";
import { useMapPictureRung } from "@/hub/assets/useMapPicture";
import { AUTO_DOWNLOAD_ON_JOIN_KEY, useAutoDownload } from "./autoDownload";

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
  onRescan: () => Promise<void>;
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
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [rescanning, setRescanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function downloadMap() {
    setDownloading(true);
    setProgress(null);
    setError(null);
    const onProgress = new Channel<DownloadProgress>();
    onProgress.onmessage = (p) => setProgress(p);
    try {
      await downloadMapAnySource({ mapName, writePath, onProgress });
      await onRescan();
    } catch (e) {
      setError(errMessage(e));
    } finally {
      setDownloading(false);
      setProgress(null);
    }
  }

  async function rescan() {
    setRescanning(true);
    setError(null);
    try {
      await onRescan();
    } finally {
      setRescanning(false);
    }
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
    start: downloadMap,
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
        {downloading && progress ? (
          <ProgressBar progress={progress} className="w-full" />
        ) : (
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button size="sm" disabled={downloading} onClick={downloadMap}>
              <Download className="size-4" />
              {downloading ? "Downloading…" : "Download"}
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
        {error && <span className="text-xs text-destructive">{error}</span>}
      </div>
    </>
  );
}
