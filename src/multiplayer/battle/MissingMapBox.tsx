import { Button, useSetting } from "@picoframe/frame";
import { Channel } from "@tauri-apps/api/core";
import { Download, RefreshCw } from "lucide-react";
import { useState } from "react";
import type { DownloadProgress } from "@/downloads/bindings";
import { useWriteRootPath } from "@/downloads/config";
import { useDownloadQueue } from "@/downloads/DownloadQueueProvider";
import { ProgressBar } from "@/downloads/pages/components/ProgressBar";
import { errMessage } from "@/downloads/pages/components/states";
import { AUTO_DOWNLOAD_ON_JOIN_KEY, useAutoDownload } from "./autoDownload";
import { downloadMapAnySource } from "./downloadMap";

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
  previewUrl,
}: {
  /** The joined battle's id, to key the auto-download once per (battle, map). */
  battleId: number;
  mapName: string;
  onRescan: () => Promise<void>;
  /** Remote map preview shown behind the controls while the map isn't installed. */
  previewUrl?: string;
}) {
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
