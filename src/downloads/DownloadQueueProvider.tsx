import { Channel } from "@tauri-apps/api/core";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { contentRescan } from "../content/bindings";
import { invalidateScans } from "../content/config";
import { warmAllRoots } from "../content/rapidPoolWarm";
import {
  type DownloadProgress,
  dlCancel,
  dlDownload,
  dlDownloadEngineRecoil,
  dlDownloadEngineSpring,
  dlDownloadFile,
  dlDownloadMap,
} from "./bindings";
import { downloadGameAnySource } from "./downloadGame";
import { downloadMapAnySource } from "./downloadMap";
import {
  addSample,
  type DownloadRate,
  IDLE_RATE,
  type RateSample,
  rateFrom,
} from "./downloadRate";
import { errMessage } from "./pages/components/states";

/**
 * A download request as enqueued by a page. `kind` selects the backend start
 * command; `args` mirror that command's arguments (minus `opId`/`onProgress`,
 * which the runner supplies). `label` is the human name shown in the widget.
 */
export type EnqueueInput =
  | {
      kind: "rapid";
      label: string;
      args: { tag: string; masterUrl?: string; writePath?: string };
    }
  | {
      // Resolve a game across every source in policy order (GitHub and mirrors
      // first, pr-downloader last, per issue 500), rather than pinning rapid.
      kind: "game";
      label: string;
      args: { gameName: string; writePath?: string };
    }
  | {
      kind: "map";
      label: string;
      args: { springName: string; searchUrl?: string; writePath?: string };
    }
  | {
      // Resolve a map across every source in policy order (known mirrors first,
      // pr-downloader last, per issue 511), rather than pinning rapid. Distinct
      // from "map" (a specific catalog source the user already picked, e.g. the
      // browse page or a curated pack).
      kind: "mapAnySource";
      label: string;
      args: { mapName: string; writePath?: string };
    }
  | {
      kind: "file";
      label: string;
      args: { url: string; destDir: string; filename: string };
    }
  | {
      kind: "engineRecoil";
      label: string;
      args: { version: string; assetUrl: string; writePath: string };
    }
  | {
      kind: "engineSpring";
      label: string;
      args: { version: string; writePath?: string };
    };

export type QueueStatus = "queued" | "active" | "done" | "error" | "canceled";

/** The runtime fields the queue tracks on top of an enqueued request. */
interface QueueItemMeta {
  /** Stable per-item id, reused as the backend `opId` so `dlCancel` can stop it. */
  id: string;
  /** Dedupe key derived from kind+args; equal items are collapsed while pending. */
  identity: string;
  status: QueueStatus;
  progress: DownloadProgress | null;
  /**
   * Speed and time left, estimated from this item's own progress samples. The
   * queue owns the estimate rather than each screen, so a download reads the
   * same in the topbar as it does on the page that started it, and so closing
   * the popover does not throw the history away.
   */
  rate: DownloadRate;
  /** When this item started downloading, for elapsed time. Null until it does. */
  startedAt: number | null;
  /** Failure message (non-cancel errors only). */
  error: string | null;
}

/** A tracked download: the enqueued request plus its live queue state. */
export type QueueItem = EnqueueInput & QueueItemMeta;

/**
 * A download the queue does not run, but the indicator should still show. The
 * app updater fetching its own installer is the one of these: it goes through
 * `@tauri-apps/plugin-updater` rather than the downloads plugin, writes no
 * content folder, and ends in a restart (issue #1790).
 *
 * It sits beside the queue rather than in it, so an app update never waits
 * behind a map and never holds one up. The rate is estimated here all the same,
 * from the same trailing window as everything else, so it reads identically
 * wherever it is drawn.
 *
 * There is no cancel. Whoever reported the download owns stopping it, and the
 * updater plugin offers no way to abort a download it has started.
 */
export interface ReportedDownload {
  /** Caller-chosen id, stable for the life of the download. */
  id: string;
  /** Human name shown in the indicator. */
  label: string;
  progress: DownloadProgress;
  rate: DownloadRate;
  /** When the first sample arrived, for elapsed time. */
  startedAt: number;
}

/**
 * A stable identity for an enqueued request, used to dedupe (a second add of an
 * item already queued or active is ignored) and to let a page's button read the
 * status of the item it would enqueue.
 */
export function identityOf(input: EnqueueInput): string {
  switch (input.kind) {
    case "rapid":
      return `rapid:${input.args.masterUrl ?? ""}:${input.args.tag}`;
    case "game":
      return `game:${input.args.gameName}`;
    case "map":
      return `map:${input.args.springName}`;
    case "mapAnySource":
      return `mapAnySource:${input.args.mapName}`;
    case "file":
      return `file:${input.args.destDir}/${input.args.filename}`;
    case "engineRecoil":
      return `engine:recoil:${input.args.version}`;
    case "engineSpring":
      return `engine:spring:${input.args.version}`;
  }
}

interface DownloadQueueValue {
  items: QueueItem[];
  active: QueueItem | null;
  queued: QueueItem[];
  /**
   * Add a download and return its id. When an equal item is already queued or
   * active nothing is added and that item's id comes back, so the caller can
   * still wait on the download it asked for.
   */
  enqueue: (input: EnqueueInput) => string;
  /**
   * Resolve once the item with this id stops running, whether it finished,
   * failed or was cancelled. Resolves with the settled item, or null for an id
   * the queue no longer holds. Never rejects: read `status` and `error` on the
   * result instead.
   */
  waitFor: (id: string) => Promise<QueueItem | null>;
  /** Downloads running outside the queue, shown alongside it. */
  reported: ReportedDownload[];
  /**
   * Report where a download the queue is not running has got to, so the
   * indicator can show it. Call again with the same id on every progress event,
   * and with null once it is over, however it ended.
   */
  report: (
    id: string,
    update: { label: string; progress: DownloadProgress } | null,
  ) => void;
  /** Cancel a queued item (dropped) or the active one (backend cancel). */
  cancel: (id: string) => void;
  /** Current status of the item with this identity, or null if not tracked. */
  statusFor: (identity: string) => QueueStatus | null;
  /** The tracked item with this identity, or null. For pages that enqueue
   * directly and want to draw the download's progress themselves. */
  itemFor: (identity: string) => QueueItem | null;
  /** Subscribe to items completing (done). Returns an unsubscribe fn. */
  onComplete: (fn: (item: QueueItem) => void) => () => void;
}

const DownloadQueueContext = createContext<DownloadQueueValue | null>(null);

/** Access the app-wide download queue. Must be used within DownloadQueueProvider. */
export function useDownloadQueue(): DownloadQueueValue {
  const ctx = useContext(DownloadQueueContext);
  if (!ctx)
    throw new Error(
      "useDownloadQueue must be used within DownloadQueueProvider",
    );
  return ctx;
}

/** How long a finished/failed/canceled row lingers before it's pruned. */
const PRUNE_MS = 4000;

/** Still on its way: waiting for a slot, or downloading right now. */
function isPending(item: QueueItem): boolean {
  return item.status === "queued" || item.status === "active";
}

/**
 * App-wide serial download queue. Downloads run one at a time (two ops must never
 * write the same content dir); many can be stacked. Each item drives the backend
 * start command matching its `kind`, streams progress back, and on completion
 * runs that kind's side effects (scan-cache invalidation / content rescan) before
 * the next item starts. Cancellation reuses the per-op `dlCancel`. Mounted above
 * the router so an in-flight queue survives navigation.
 */
export function DownloadQueueProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<QueueItem[]>([]);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const [reported, setReported] = useState<ReportedDownload[]>([]);

  // Set synchronously in startNext so the pump can't launch a second item before
  // the "active" status commits to state.
  const activeIdRef = useRef<string | null>(null);

  // The progress samples behind each running download's rate estimate, queued
  // and reported alike, keyed by id. Kept out of React state because they change
  // far faster than anything drawn from them, and dropped as soon as the
  // download settles.
  const samplesRef = useRef(
    new Map<string, { samples: RateSample[]; totalBytes: number | null }>(),
  );

  const completeListeners = useRef(new Set<(item: QueueItem) => void>());
  const onComplete = useCallback((fn: (item: QueueItem) => void) => {
    completeListeners.current.add(fn);
    return () => {
      completeListeners.current.delete(fn);
    };
  }, []);

  // Callers waiting on a specific item, by id. Drained (and dropped) the moment
  // that item settles, so a caller can queue a download and still run whatever
  // it used to run straight after its own inline download.
  const settleWaiters = useRef(new Map<string, ((i: QueueItem) => void)[]>());
  const settle = useCallback((item: QueueItem) => {
    const waiters = settleWaiters.current.get(item.id);
    if (!waiters) return;
    settleWaiters.current.delete(item.id);
    for (const fn of waiters) fn(item);
  }, []);

  // Only ever updates the runtime meta fields; the cast keeps the discriminated
  // union's `kind`/`args` intact (spreading a union otherwise widens `kind`).
  const patch = useCallback((id: string, next: Partial<QueueItemMeta>) => {
    setItems((list) =>
      list.map((i) => (i.id === id ? ({ ...i, ...next } as QueueItem) : i)),
    );
  }, []);

  const prune = useCallback((id: string) => {
    setTimeout(() => {
      setItems((list) => list.filter((i) => i.id !== id));
    }, PRUNE_MS);
  }, []);

  // Fire the backend start command for an item and apply its kind's side effects.
  const start = useCallback(
    async (item: QueueItem, onProgress: Channel<DownloadProgress>) => {
      switch (item.kind) {
        case "rapid":
          await dlDownload({ ...item.args, opId: item.id, onProgress });
          // The freshly-written `.sdp` is now on disk; warm it into the page
          // cache so the first launch/join after this download is quicker.
          warmAllRoots().catch(() => {});
          return;
        case "game":
          // May install a rapid pool entry or a direct file in the games folder,
          // so run both a scan invalidation and the rapid page-cache warm.
          await downloadGameAnySource({
            ...item.args,
            opId: item.id,
            onProgress,
          });
          invalidateScans();
          warmAllRoots().catch(() => {});
          return;
        case "map":
          await dlDownloadMap({ ...item.args, opId: item.id, onProgress });
          invalidateScans();
          return;
        case "mapAnySource":
          await downloadMapAnySource({
            ...item.args,
            opId: item.id,
            onProgress,
          });
          invalidateScans();
          return;
        case "file":
          await dlDownloadFile({ ...item.args, opId: item.id, onProgress });
          invalidateScans();
          return;
        case "engineRecoil":
          await dlDownloadEngineRecoil({
            ...item.args,
            opId: item.id,
            onProgress,
          });
          await contentRescan(undefined).catch(() => {});
          return;
        case "engineSpring":
          await dlDownloadEngineSpring({
            ...item.args,
            opId: item.id,
            onProgress,
          });
          await contentRescan(undefined).catch(() => {});
          return;
      }
    },
    [],
  );

  const run = useCallback(
    async (item: QueueItem) => {
      const onProgress = new Channel<DownloadProgress>();
      let samples: RateSample[] = [];
      onProgress.onmessage = (p) => {
        const now = Date.now();
        // The sidecar's final event reports zero bytes and no percentage, so it
        // is a terminator rather than a measurement. `addSample` drops it, but
        // feeding it in at all would only move the stall clock.
        if (p.phase !== "done") {
          samples = addSample(samples, {
            at: now,
            bytes: p.downloadedBytes,
            fraction: p.percent == null ? null : p.percent / 100,
          });
        }
        samplesRef.current.set(item.id, { samples, totalBytes: p.totalBytes });
        patch(item.id, {
          progress: p,
          rate: rateFrom(samples, p.totalBytes, now),
        });
      };
      let settled = { ...item, status: "done", progress: null } as QueueItem;
      try {
        await start(item, onProgress);
        patch(item.id, { status: "done", progress: null, rate: IDLE_RATE });
        for (const fn of completeListeners.current) fn(settled);
      } catch (e) {
        const msg = errMessage(e);
        const canceled = /cancel/i.test(msg);
        const meta = {
          status: canceled ? "canceled" : "error",
          error: canceled ? null : msg,
          progress: null,
          rate: IDLE_RATE,
        } as const;
        patch(item.id, meta);
        settled = { ...item, ...meta } as QueueItem;
      } finally {
        activeIdRef.current = null;
        samplesRef.current.delete(item.id);
        settle(settled);
        prune(item.id);
      }
    },
    [patch, prune, settle, start],
  );

  // Promote the next queued item whenever nothing is active. `activeIdRef` guards
  // the synchronous gap before the "active" status is committed.
  const startNext = useCallback(() => {
    if (activeIdRef.current) return;
    const next = itemsRef.current.find((i) => i.status === "queued");
    if (!next) return;
    activeIdRef.current = next.id;
    patch(next.id, {
      status: "active",
      progress: null,
      rate: IDLE_RATE,
      startedAt: Date.now(),
    });
    void run(next);
  }, [patch, run]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `items` is the trigger that re-pumps the queue when a slot frees up, not read in the body
  useEffect(() => {
    startNext();
  }, [startNext, items]);

  const enqueue = useCallback((input: EnqueueInput): string => {
    const identity = identityOf(input);
    const already = itemsRef.current.find(
      (i) => i.identity === identity && isPending(i),
    );
    if (already) return already.id;
    const item = {
      ...input,
      id: crypto.randomUUID(),
      identity,
      status: "queued",
      progress: null,
      rate: IDLE_RATE,
      startedAt: null,
      error: null,
    } as QueueItem;
    // Push into the ref as well as state: two enqueues in the same tick both
    // read the ref, so without this the second would miss the first and add a
    // duplicate of a download already on its way.
    itemsRef.current = [...itemsRef.current, item];
    setItems((list) =>
      list.some((i) => i.identity === identity && isPending(i))
        ? list
        : [...list, item],
    );
    return item.id;
  }, []);

  const waitFor = useCallback((id: string): Promise<QueueItem | null> => {
    const item = itemsRef.current.find((i) => i.id === id);
    // Already finished, or an id the queue never held: there is nothing left to
    // wait for, so answer now rather than leaving the caller hanging.
    if (!item || !isPending(item)) return Promise.resolve(item ?? null);
    return new Promise((resolve) => {
      const list = settleWaiters.current.get(id) ?? [];
      list.push(resolve);
      settleWaiters.current.set(id, list);
    });
  }, []);

  const cancel = useCallback(
    (id: string) => {
      const item = itemsRef.current.find((i) => i.id === id);
      if (!item) return;
      if (item.status === "active") {
        // Best-effort backend stop, and `run`'s catch marks it canceled.
        dlCancel({ opId: id }).catch(() => {});
      } else if (item.status === "queued") {
        itemsRef.current = itemsRef.current.filter((i) => i.id !== id);
        setItems((list) => list.filter((i) => i.id !== id));
        // A dropped item never reaches `run`, so settle its waiters here.
        settle({ ...item, status: "canceled", progress: null } as QueueItem);
      }
    },
    [settle],
  );

  const report = useCallback(
    (
      id: string,
      next: { label: string; progress: DownloadProgress } | null,
    ) => {
      if (!next) {
        samplesRef.current.delete(id);
        setReported((list) => list.filter((r) => r.id !== id));
        return;
      }
      const now = Date.now();
      const tracked = samplesRef.current.get(id);
      const samples = addSample(tracked?.samples ?? [], {
        at: now,
        bytes: next.progress.downloadedBytes,
        fraction:
          next.progress.percent == null ? null : next.progress.percent / 100,
      });
      samplesRef.current.set(id, {
        samples,
        totalBytes: next.progress.totalBytes,
      });
      const rate = rateFrom(samples, next.progress.totalBytes, now);
      setReported((list) => {
        const was = list.find((r) => r.id === id);
        const entry: ReportedDownload = {
          id,
          label: next.label,
          progress: next.progress,
          rate,
          startedAt: was?.startedAt ?? now,
        };
        return was
          ? list.map((r) => (r.id === id ? entry : r))
          : [...list, entry];
      });
    },
    [],
  );

  const statusByIdentity = useMemo(() => {
    const m = new Map<string, QueueStatus>();
    for (const i of items) m.set(i.identity, i.status);
    return m;
  }, [items]);
  const statusFor = useCallback(
    (identity: string) => statusByIdentity.get(identity) ?? null,
    [statusByIdentity],
  );

  const itemByIdentity = useMemo(() => {
    const m = new Map<string, QueueItem>();
    for (const i of items) m.set(i.identity, i);
    return m;
  }, [items]);
  const itemFor = useCallback(
    (identity: string) => itemByIdentity.get(identity) ?? null,
    [itemByIdentity],
  );

  const active = useMemo(
    () => items.find((i) => i.status === "active") ?? null,
    [items],
  );
  const queued = useMemo(
    () => items.filter((i) => i.status === "queued"),
    [items],
  );

  // A download that goes quiet sends no event saying so, so the rate has to be
  // re-read against the clock for the stall to ever show. Covers the reported
  // downloads too, since an app update can lose its connection the same way a
  // map can. Only writes when the answer actually changed.
  const runningIds = useRef<string[]>([]);
  runningIds.current = [active?.id, ...reported.map((r) => r.id)].filter(
    (id): id is string => id != null,
  );
  const anyRunning = runningIds.current.length > 0;
  useEffect(() => {
    if (!anyRunning) return;
    const timer = setInterval(() => {
      for (const id of runningIds.current) {
        const tracked = samplesRef.current.get(id);
        if (!tracked) continue;
        const next = rateFrom(tracked.samples, tracked.totalBytes, Date.now());
        const item = itemsRef.current.find((i) => i.id === id);
        if (item) {
          if (item.rate.stalled !== next.stalled) patch(id, { rate: next });
          continue;
        }
        setReported((list) =>
          list.some((r) => r.id === id && r.rate.stalled !== next.stalled)
            ? list.map((r) => (r.id === id ? { ...r, rate: next } : r))
            : list,
        );
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [anyRunning, patch]);

  const value: DownloadQueueValue = useMemo(
    () => ({
      items,
      active,
      queued,
      reported,
      report,
      enqueue,
      waitFor,
      cancel,
      statusFor,
      itemFor,
      onComplete,
    }),
    [
      items,
      active,
      queued,
      reported,
      report,
      enqueue,
      waitFor,
      cancel,
      statusFor,
      itemFor,
      onComplete,
    ],
  );

  return (
    <DownloadQueueContext.Provider value={value}>
      {children}
    </DownloadQueueContext.Provider>
  );
}

/**
 * Run `cb` whenever a download completes successfully. Used by pages to refresh
 * their installed-content view once the queue finishes one of their items.
 */
export function useDownloadComplete(cb: (item: QueueItem) => void): void {
  const { onComplete } = useDownloadQueue();
  const ref = useRef(cb);
  ref.current = cb;
  useEffect(() => onComplete((item) => ref.current(item)), [onComplete]);
}
