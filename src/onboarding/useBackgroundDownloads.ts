import { useLingui } from "@lingui/react/macro";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useBundledEngine } from "@/content/BundledEngineSetup";
import { contentCreateStandardRoot } from "@/content/bindings";
import { useGithubGameRepos } from "@/content/branding";
import { useSetupStatus } from "@/content/config";
import { engineDownloadRequest } from "@/content/engineDownloadRequest";
import { suggestionRequest } from "@/content/pages/components/SuggestionsList";
import { useDefaultWriteRoot, useWriteRootPath } from "@/downloads/config";
import {
  type EnqueueInput,
  type QueueItem,
  useDownloadQueue,
} from "@/downloads/DownloadQueueProvider";
import { GAME_REPOS, mergeGameRepos } from "@/downloads/gameRepos";
import type { BackgroundId } from "./ids";
import type { GamesDecision } from "./relevance";

interface Tracked {
  id: string;
  input: EnqueueInput;
}

const TERMINAL = new Set(["done", "error", "canceled"]);

/**
 * Downloads the engine and a distribution's game on first launch, whether or
 * not the wizard opens (spec: Engine and Games).
 *
 * Each id is started at most once per run, guarded by a ref so StrictMode's
 * double effects cannot queue it twice. An id settles when its first item stops
 * running, when nothing can be queued, or when queueing throws. A retry queues
 * the same request again and is the player's own request, so it does not look at
 * the settled list.
 */
export function useBackgroundDownloads(args: {
  settled: readonly string[];
  games: GamesDecision | null;
  onSettle(id: BackgroundId): void;
}): {
  items: QueueItem[];
  cancel(id: string): void;
  retry(id: string): void;
} {
  const { settled, games, onSettle } = args;
  const { t } = useLingui();
  const queue = useDownloadQueue();
  const setup = useSetupStatus();
  const bundled = useBundledEngine();
  const writePath = useWriteRootPath();
  const ensureWriteRoot = useDefaultWriteRoot();
  const catalogRepos = useGithubGameRepos();
  const repos = useMemo(
    () => mergeGameRepos(catalogRepos, GAME_REPOS),
    [catalogRepos],
  );
  const [tracked, setTracked] = useState<
    Partial<Record<BackgroundId, Tracked>>
  >({});

  const latest = useRef({ queue, settled, onSettle });
  latest.current = { queue, settled, onSettle };
  const started = useRef(new Set<BackgroundId>());
  const reported = useRef(new Set<BackgroundId>());
  const folderTried = useRef(false);

  const finish = useCallback((id: BackgroundId) => {
    if (reported.current.has(id) || latest.current.settled.includes(id)) return;
    reported.current.add(id);
    latest.current.onSettle(id);
  }, []);

  const start = useCallback(
    async (id: BackgroundId, build: () => Promise<EnqueueInput | null>) => {
      try {
        const input = await build();
        if (!input) {
          finish(id);
          return;
        }
        const queued = latest.current.queue.enqueue(input);
        setTracked((s) => ({ ...s, [id]: { id: queued, input } }));
      } catch {
        finish(id);
      }
    },
    [finish],
  );

  // The bundled engine is being set up, or is about to be, so there is nothing
  // to download. A failed or cancelled copy falls through to the download.
  const bundleCovers =
    bundled.state.status === "checking" ||
    bundled.state.status === "copying" ||
    bundled.state.status === "done";

  useEffect(() => {
    if (settled.includes("engine") || started.current.has("engine")) return;
    if (setup.loading) return;
    if (setup.complete) {
      started.current.add("engine");
      finish("engine");
      return;
    }
    if (bundleCovers) return;
    if (setup.needsFolder) {
      if (setup.missingRoot || folderTried.current) return;
      folderTried.current = true;
      contentCreateStandardRoot(undefined)
        .then(({ state }) => {
          ensureWriteRoot(state);
          return setup.refresh();
        })
        .catch(() => {
          started.current.add("engine");
          finish("engine");
        });
      return;
    }
    if (!setup.needsEngine || !writePath) return;
    started.current.add("engine");
    void start("engine", () =>
      engineDownloadRequest(writePath, (version) => t`Engine ${version}`),
    );
  }, [
    settled,
    setup,
    bundleCovers,
    writePath,
    ensureWriteRoot,
    finish,
    start,
    t,
  ]);

  useEffect(() => {
    if (settled.includes("game") || started.current.has("game")) return;
    if (games === null) return;
    if (games.kind !== "auto") {
      started.current.add("game");
      finish("game");
      return;
    }
    if (!writePath) return;
    started.current.add("game");
    const { game } = games;
    void start("game", () =>
      suggestionRequest(
        game.download,
        "game",
        t`Game: ${game.title}`,
        writePath,
        repos,
      ),
    );
  }, [settled, games, writePath, repos, finish, start, t]);

  const items = useMemo(() => {
    const byId = new Map<string, QueueItem>();
    for (const i of queue.settled ?? []) byId.set(i.id, i);
    for (const i of queue.items) byId.set(i.id, i);
    const found: QueueItem[] = [];
    for (const entry of Object.values(tracked)) {
      const item = byId.get(entry.id);
      if (item) found.push(item);
    }
    return found;
  }, [tracked, queue.items, queue.settled]);

  useEffect(() => {
    for (const [id, entry] of Object.entries(tracked)) {
      const item = items.find((i) => i.id === entry.id);
      if (item && TERMINAL.has(item.status)) finish(id as BackgroundId);
    }
  }, [tracked, items, finish]);

  const cancel = useCallback(
    (id: string) => latest.current.queue.cancel(id),
    [],
  );

  const retry = useCallback(
    (id: string) => {
      for (const [key, entry] of Object.entries(tracked)) {
        if (entry.id !== id) continue;
        const queued = latest.current.queue.enqueue(entry.input);
        setTracked((s) => ({
          ...s,
          [key]: { id: queued, input: entry.input },
        }));
      }
    },
    [tracked],
  );

  return { items, cancel, retry };
}
