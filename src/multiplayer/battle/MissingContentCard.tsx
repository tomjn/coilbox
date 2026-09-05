import { Button, useSetting } from "@picoframe/frame";
import { AlertTriangle, Download, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { useWriteRootPath } from "@/downloads/config";
import {
  type EnqueueInput,
  identityOf,
  useDownloadQueue,
} from "@/downloads/DownloadQueueProvider";
import { QueueProgress } from "@/downloads/pages/components/ProgressBar";
import { errMessage } from "@/downloads/pages/components/states";
import { AUTO_DOWNLOAD_ON_JOIN_KEY, useAutoDownload } from "./autoDownload";

/**
 * Shown when the battle's game isn't installed locally. Downloads the game
 * (GitHub releases and mirrors first, pr-downloader last, see
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
  const { active, queued, items, enqueue, onComplete, failureFor } =
    useDownloadQueue();
  const [autoEnabled] = useSetting<boolean>(AUTO_DOWNLOAD_ON_JOIN_KEY, true);
  const [rescanning, setRescanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Downloads go through the app-wide queue rather than being run here, so this
  // one appears in the download widget like every other, cannot run alongside a
  // download writing the same content dir, and gets the scan invalidation and
  // pool warm the queue does on completion.
  const input: EnqueueInput = {
    kind: "game",
    label: gameName,
    args: { gameName, writePath },
  };
  const identity = identityOf(input);
  const item = items.find((i) => i.identity === identity) ?? null;
  const downloading = item?.status === "queued" || item?.status === "active";
  const progress = item?.progress ?? null;
  // The row wins while it is still there, then the queue's longer-lived record
  // of the failure takes over once it has been pruned (issue #2504).
  const downloadError = item?.error ?? failureFor(identity);

  async function downloadGame() {
    setError(null);
    enqueue(input);
  }

  // The queue owns the download, so the card learns it finished by subscribing
  // rather than by awaiting it. Rescanning is still this screen's job: it is
  // what swaps these cards for the real ones.
  useEffect(
    () =>
      onComplete((done) => {
        if (done.identity !== identity) return;
        onRescan().catch((e) => setError(errMessage(e)));
      }),
    [onComplete, identity, onRescan],
  );

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
        <QueueProgress item={item} />
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" disabled={downloading} onClick={downloadGame}>
            <Download className="size-4" />
            {/* Queued is worth saying: the queue runs one download at a time, so
                waiting behind another is not the same as making no progress. */}
            {item?.status === "queued"
              ? "Queued…"
              : downloading
                ? "Downloading…"
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
            {rescanning ? "Rescanning…" : "Rescan"}
          </Button>
        </div>
      )}
      {(error ?? downloadError) && (
        <span className="text-sm text-destructive">
          {error ?? downloadError}
        </span>
      )}
    </div>
  );
}
