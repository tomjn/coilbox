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
import { errorText } from "@/lib/helpers";
import { BACKGROUND_IDS, type BackgroundId } from "./ids";
import type { GamesDecision } from "./relevance";

interface Tracked {
  id: string;
  input: EnqueueInput;
}

const TERMINAL = new Set(["done", "error", "canceled"]);

/**
 * A background download that never reached the queue. `retry` is false when
 * trying again cannot help, as on a platform with no engine release.
 */
export interface BackgroundProblem {
  id: BackgroundId;
  label: string;
  message: string;
  retry: boolean;
}

/**
 * Downloads the engine and a distribution's game on first launch, whether or
 * not the wizard opens (spec: Engine and Games).
 *
 * Each id is started at most once per run, guarded by a ref so StrictMode's
 * double effects cannot queue it twice. An id settles when its first item stops
 * running, when nothing can be queued, or when queueing throws. A retry queues
 * the same request again and is the player's own request, so it does not look at
 * the settled list. A download that never reached the queue is a problem, shown
 * beside the queued items, and its retry starts that id again.
 */
export function useBackgroundDownloads(args: {
  settled: readonly string[];
  games: GamesDecision | null;
  onSettle(id: BackgroundId): void;
}): {
  items: QueueItem[];
  problems: BackgroundProblem[];
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
  // Ids the player retried, which start again even though they are settled.
  // A new set on every retry, so the effects below run again.
  const [forced, setForced] = useState<ReadonlySet<BackgroundId>>(new Set());
  const [problemById, setProblemById] = useState<
    Partial<Record<BackgroundId, BackgroundProblem>>
  >({});

  const finish = useCallback((id: BackgroundId) => {
    if (reported.current.has(id) || latest.current.settled.includes(id)) return;
    reported.current.add(id);
    latest.current.onSettle(id);
  }, []);

  const report = useCallback(
    (problem: BackgroundProblem, reason: unknown) => {
      console.warn(`Setup could not download the ${problem.id}:`, reason);
      setProblemById((s) => ({ ...s, [problem.id]: problem }));
      finish(problem.id);
    },
    [finish],
  );

  const start = useCallback(
    async (
      id: BackgroundId,
      label: string,
      build: () => Promise<EnqueueInput | null>,
      unavailable?: string,
    ) => {
      try {
        const input = await build();
        if (!input) {
          if (unavailable) {
            report(
              { id, label, message: unavailable, retry: false },
              "no release for this platform",
            );
          } else {
            console.warn(`Setup has nothing to download for the ${id}`);
            finish(id);
          }
          return;
        }
        const queued = latest.current.queue.enqueue(input);
        setTracked((s) => ({ ...s, [id]: { id: queued, input } }));
      } catch (e) {
        report({ id, label, message: errorText(e), retry: true }, e);
      }
    },
    [finish, report],
  );

  // Not started this run, and not settled unless the player retried it.
  const blocked = useCallback(
    (id: BackgroundId) =>
      started.current.has(id) || (settled.includes(id) && !forced.has(id)),
    [settled, forced],
  );

  // The bundled engine is being set up, or is about to be, so there is nothing
  // to download. A failed or cancelled copy falls through to the download.
  const bundleCovers =
    bundled.state.status === "checking" ||
    bundled.state.status === "copying" ||
    bundled.state.status === "done";

  useEffect(() => {
    if (blocked("engine")) return;
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
        .catch((e) => {
          started.current.add("engine");
          report(
            {
              id: "engine",
              label: t`Engine`,
              message: errorText(e),
              retry: true,
            },
            e,
          );
        });
      return;
    }
    if (!setup.needsEngine || !writePath) return;
    started.current.add("engine");
    void start(
      "engine",
      t`Engine`,
      () => engineDownloadRequest(writePath, (version) => t`Engine ${version}`),
      t`No engine is available to download for this platform.`,
    );
  }, [
    blocked,
    report,
    setup,
    bundleCovers,
    writePath,
    ensureWriteRoot,
    finish,
    start,
    t,
  ]);

  useEffect(() => {
    if (blocked("game")) return;
    if (games === null) return;
    if (games.kind !== "auto") {
      started.current.add("game");
      finish("game");
      return;
    }
    if (!writePath) return;
    started.current.add("game");
    const { game } = games;
    const label = t`Game: ${game.title}`;
    void start("game", label, () =>
      suggestionRequest(game.download, "game", label, writePath, repos),
    );
  }, [blocked, games, writePath, repos, finish, start, t]);

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

  const problems = useMemo(
    () => Object.values(problemById).filter((p) => p !== undefined),
    [problemById],
  );

  const retry = useCallback(
    (id: string) => {
      const problem = BACKGROUND_IDS.find((b) => b === id && problemById[b]);
      if (problem) {
        if (!problemById[problem]?.retry) return;
        setProblemById(({ [problem]: _, ...rest }) => rest);
        started.current.delete(problem);
        if (problem === "engine") folderTried.current = false;
        setForced((s) => new Set(s).add(problem));
        return;
      }
      for (const [key, entry] of Object.entries(tracked)) {
        if (entry.id !== id) continue;
        const queued = latest.current.queue.enqueue(entry.input);
        setTracked((s) => ({
          ...s,
          [key]: { id: queued, input: entry.input },
        }));
      }
    },
    [tracked, problemById],
  );

  return { items, problems, cancel, retry };
}
