import { Button, useSetting } from "@picoframe/frame";
import { Channel } from "@tauri-apps/api/core";
import { AlertTriangle, Download, RefreshCw } from "lucide-react";
import { useState } from "react";
import type { DownloadProgress } from "@/downloads/bindings";
import { useWriteRootPath } from "@/downloads/config";
import { useDownloadQueue } from "@/downloads/DownloadQueueProvider";
import { ProgressBar } from "@/downloads/pages/components/ProgressBar";
import { errMessage } from "@/downloads/pages/components/states";
import { AUTO_DOWNLOAD_ON_JOIN_KEY, useAutoDownload } from "./autoDownload";
import { downloadGameAnySource } from "./downloadGame";

/**
 * Shown when the battle's game isn't installed locally. Downloads the game
 * (rapid via pr-downloader, falling back to the springfiles catalog — see
 * `downloadGameAnySource`) or rescans if it's already on disk. On success it
 * calls `onRescan`, which re-scans and remounts the cards so the real game
 * appears. (The missing-map case is handled inline in the minimap box, see
 * `MissingMapBox`.)
 */
export function MissingContentCard({
  battleId,
  gameName,
  onRescan,
}: {
  /** The joined battle's id, to key the auto-download once per (battle, game). */
  battleId: number;
  gameName: string;
  onRescan: () => Promise<void>;
}) {
  const writePath = useWriteRootPath();
  const { active, queued } = useDownloadQueue();
  const [autoEnabled] = useSetting<boolean>(AUTO_DOWNLOAD_ON_JOIN_KEY, true);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [rescanning, setRescanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function downloadGame() {
    setDownloading(true);
    setProgress(null);
    setError(null);
    const onProgress = new Channel<DownloadProgress>();
    onProgress.onmessage = (p) => setProgress(p);
    try {
      await downloadGameAnySource({ gameName, writePath, onProgress });
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

  // On join, start the same download the button fires (issue #439) — this card
  // only renders when the game is missing, so mounting means the required content
  // is absent. Idempotent and gated so it fires once and never fights the queue.
  useAutoDownload({
    key: `${battleId}:game:${gameName}`,
    enabled: autoEnabled,
    writeRootReady: !!writePath,
    queueIdle: active == null && queued.length === 0,
    inFlight: downloading,
    start: downloadGame,
  });

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4">
      <div className="flex items-center gap-2 text-sm font-medium text-amber-700 dark:text-amber-400">
        <AlertTriangle className="size-4" />
        Game not installed
      </div>
      <p className="text-sm">
        <span className="font-medium">{gameName}</span> isn't installed —
        download it to join, or rescan if it's already on disk.
      </p>
      {downloading && progress ? (
        <ProgressBar progress={progress} />
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" disabled={downloading} onClick={downloadGame}>
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
            {rescanning ? "Rescanning…" : "Rescan"}
          </Button>
        </div>
      )}
      {error && <span className="text-sm text-destructive">{error}</span>}
    </div>
  );
}
