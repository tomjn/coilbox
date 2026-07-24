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
  /** Failure message (non-cancel errors only). */
  error: string | null;
}

/** A tracked download: the enqueued request plus its live queue state. */
export type QueueItem = EnqueueInput & QueueItemMeta;

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
  /** Add a download; a no-op if an equal item is already queued or active. */
  enqueue: (input: EnqueueInput) => void;
  /** Cancel a queued item (dropped) or the active one (backend cancel). */
  cancel: (id: string) => void;
  /** Current status of the item with this identity, or null if not tracked. */
  statusFor: (identity: string) => QueueStatus | null;
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

  // Set synchronously in startNext so the pump can't launch a second item before
  // the "active" status commits to state.
  const activeIdRef = useRef<string | null>(null);

  const completeListeners = useRef(new Set<(item: QueueItem) => void>());
  const onComplete = useCallback((fn: (item: QueueItem) => void) => {
    completeListeners.current.add(fn);
    return () => {
      completeListeners.current.delete(fn);
    };
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
      onProgress.onmessage = (p) => patch(item.id, { progress: p });
      try {
        await start(item, onProgress);
        patch(item.id, { status: "done", progress: null });
        const done = { ...item, status: "done", progress: null } as QueueItem;
        for (const fn of completeListeners.current) fn(done);
      } catch (e) {
        const msg = errMessage(e);
        const canceled = /cancel/i.test(msg);
        patch(item.id, {
          status: canceled ? "canceled" : "error",
          error: canceled ? null : msg,
          progress: null,
        });
      } finally {
        activeIdRef.current = null;
        prune(item.id);
      }
    },
    [patch, prune, start],
  );

  // Promote the next queued item whenever nothing is active. `activeIdRef` guards
  // the synchronous gap before the "active" status is committed.
  const startNext = useCallback(() => {
    if (activeIdRef.current) return;
    const next = itemsRef.current.find((i) => i.status === "queued");
    if (!next) return;
    activeIdRef.current = next.id;
    patch(next.id, { status: "active", progress: null });
    void run(next);
  }, [patch, run]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `items` is the trigger that re-pumps the queue when a slot frees up, not read in the body
  useEffect(() => {
    startNext();
  }, [startNext, items]);

  const enqueue = useCallback((input: EnqueueInput) => {
    const identity = identityOf(input);
    setItems((list) => {
      if (
        list.some(
          (i) =>
            i.identity === identity &&
            (i.status === "queued" || i.status === "active"),
        )
      )
        return list;
      const item = {
        ...input,
        id: crypto.randomUUID(),
        identity,
        status: "queued",
        progress: null,
        error: null,
      } as QueueItem;
      return [...list, item];
    });
  }, []);

  const cancel = useCallback((id: string) => {
    const item = itemsRef.current.find((i) => i.id === id);
    if (!item) return;
    if (item.status === "active") {
      // Best-effort backend stop; `run`'s catch marks it canceled.
      dlCancel({ opId: id }).catch(() => {});
    } else if (item.status === "queued") {
      setItems((list) => list.filter((i) => i.id !== id));
    }
  }, []);

  const statusByIdentity = useMemo(() => {
    const m = new Map<string, QueueStatus>();
    for (const i of items) m.set(i.identity, i.status);
    return m;
  }, [items]);
  const statusFor = useCallback(
    (identity: string) => statusByIdentity.get(identity) ?? null,
    [statusByIdentity],
  );

  const active = useMemo(
    () => items.find((i) => i.status === "active") ?? null,
    [items],
  );
  const queued = useMemo(
    () => items.filter((i) => i.status === "queued"),
    [items],
  );

  const value: DownloadQueueValue = useMemo(
    () => ({ items, active, queued, enqueue, cancel, statusFor, onComplete }),
    [items, active, queued, enqueue, cancel, statusFor, onComplete],
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
