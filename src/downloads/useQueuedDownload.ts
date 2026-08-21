import { useCallback, useRef, useState } from "react";
import type { DownloadProgress } from "./bindings";
import {
  type EnqueueInput,
  identityOf,
  type QueueItem,
  type QueueStatus,
  useDownloadQueue,
} from "./DownloadQueueProvider";
import { type DownloadRate, IDLE_RATE } from "./downloadRate";

/** One screen's view of a download it can start, running on the app-wide queue. */
export interface QueuedDownload {
  /**
   * Put the download on the queue and resolve once it stops running. Pass
   * `override` when the request can only be built at click time, such as a
   * GitHub release archive that has to be looked up first.
   *
   * Resolves with the settled item, so a caller can rescan or re-check straight
   * after, exactly as it did when it ran the download itself. Resolves with
   * null when there is nothing to enqueue.
   */
  start: (override?: EnqueueInput) => Promise<QueueItem | null>;
  /** Where this download has got to, or null before it is started. */
  status: QueueStatus | null;
  /** Live progress while it is downloading. */
  progress: DownloadProgress | null;
  /** Speed and time left, as the queue estimates them. */
  rate: DownloadRate;
  /** When it started downloading, for elapsed time. Null until it does. */
  startedAt: number | null;
  /**
   * Why the last attempt failed, if it did. Outlives the queue row, so the
   * message is still there to read minutes later (issue #1860), and goes when
   * the download is started again.
   */
  error: string | null;
  /** Waiting for a slot, or downloading right now. */
  busy: boolean;
}

/**
 * Run one screen's download through the app-wide queue rather than beside it.
 *
 * A screen that calls a `dl*` binding directly gets its own progress bar and
 * nothing else: the topbar download indicator never hears about it, and it can
 * write a content folder at the same time as a queued download. This hook keeps
 * the screen's own progress UI working while the download itself goes on the
 * queue, so it shows up in the indicator and takes its turn.
 *
 * `input` is the request this screen would make, or null while it cannot make
 * one yet (no download folder, nothing selected). Reading state back by that
 * request's identity means a download already running for the same map or game,
 * started anywhere in the app, shows here as busy too.
 */
export function useQueuedDownload(input?: EnqueueInput | null): QueuedDownload {
  const { enqueue, waitFor, items, failureFor } = useDownloadQueue();
  const [started, setStarted] = useState<{
    id: string;
    identity: string;
  } | null>(null);

  const inputRef = useRef(input);
  inputRef.current = input;

  const start = useCallback(
    async (override?: EnqueueInput) => {
      const request = override ?? inputRef.current;
      if (!request) return null;
      const id = enqueue(request);
      setStarted({ id, identity: identityOf(request) });
      return waitFor(id);
    },
    [enqueue, waitFor],
  );

  // The screen's own request when it has one, and otherwise whatever it last
  // asked for at click time, which is the only identity a caller passing its
  // request to `start` has.
  const identity = input ? identityOf(input) : (started?.identity ?? null);
  const item =
    items.find((i) => i.id === started?.id) ??
    (identity ? items.find((i) => i.identity === identity) : undefined);

  return {
    start,
    status: item?.status ?? null,
    progress: item?.progress ?? null,
    rate: item?.rate ?? IDLE_RATE,
    startedAt: item?.startedAt ?? null,
    // The row wins while it is still there, then the queue's longer-lived
    // record of the failure takes over once it has been pruned.
    error: item?.error ?? (identity ? failureFor(identity) : null),
    busy: item?.status === "queued" || item?.status === "active",
  };
}
