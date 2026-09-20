import { Button, useSetting } from "@picoframe/frame";
import { AlertTriangle, Download, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { useWriteRootPath } from "@/downloads/config";
import {
  type EnqueueInput,
  identityOf,
  useDownloadQueue,
} from "@/downloads/DownloadQueueProvider";
import {
  QueueProgress,
  StartingBar,
} from "@/downloads/pages/components/ProgressBar";
import { errMessage } from "@/downloads/pages/components/states";
import { AUTO_DOWNLOAD_ON_JOIN_KEY, useAutoDownload } from "./autoDownload";
import type { ContentPresence } from "./useBattleRoom";

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
  onRescan: () => Promise<ContentPresence>;
}) {
  const writePath = useWriteRootPath();
  const {
    active,
    queued,
    items,
    enqueue,
    onComplete,
    failureFor,
    completedFor,
  } = useDownloadQueue();
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
  // This card only renders while the game is missing, so a finished download
  // with no rescan running means the engine cannot see what was downloaded.
  const downloadedButMissing =
    completedFor(identity) && !downloading && !rescanning;

  async function downloadGame() {
    setError(null);
    enqueue(input);
  }

  // What joining a battle starts. The scan this card was drawn from can be as
  // old as the session, so look again before fetching a game that may already
  // be on disk, and never repeat a download that has already finished once.
  async function downloadIfStillMissing() {
    const found = await rescan();
    if (found?.game || completedFor(identity)) return;
    downloadGame();
  }

  // The queue owns the download, so the card learns it finished by subscribing
  // rather than by awaiting it. Rescanning is still this screen's job: it is
  // what swaps these cards for the real ones.
  useEffect(
    () =>
      onComplete((done) => {
        if (done.identity !== identity) return;
        setRescanning(true);
        onRescan()
          .catch((e) => setError(errMessage(e)))
          .finally(() => setRescanning(false));
      }),
    [onComplete, identity, onRescan],
  );

  async function rescan() {
    setRescanning(true);
    setError(null);
    try {
      return await onRescan();
    } catch (e) {
      setError(errMessage(e));
      return null;
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
    start: downloadIfStillMissing,
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
      {downloadedButMissing && (
        <p className="text-sm">
          Downloaded to {writePath}, but the engine still does not list this
          game. The archive may be a different version, or one the engine cannot
          read.
        </p>
      )}
      {item?.status === "active" ? (
        progress ? (
          <QueueProgress item={item} />
        ) : (
          <StartingBar />
        )
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant={downloadedButMissing ? "secondary" : undefined}
            disabled={downloading}
            onClick={downloadGame}
          >
            <Download className="size-4" />
            {/* Queued is worth saying: the queue runs one download at a time, so
                waiting behind another is not the same as making no progress. */}
            {item?.status === "queued"
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
