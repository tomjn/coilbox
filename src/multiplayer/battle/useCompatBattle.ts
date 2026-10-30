import { t } from "@lingui/core/macro";
import { Channel } from "@tauri-apps/api/core";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { describeError } from "@/i18n/uiError";
import { compatBuild, compatStatus } from "../../compat/bindings";
import type { Convert3doProgress } from "../../content/bindings";
import { primeGameInfo } from "../../content/config";
import {
  type CompatBattleState,
  classifyCompatBattle,
  compatBuildable,
} from "./compatBattle";

interface ScannedGame {
  name: string;
  primaryArchive: { name: string };
}

const msg = (e: unknown): string => describeError(e);

/** Builds under way, so leaving a room and coming back does not start a second write of one folder. */
const inFlight = new Map<string, Promise<CompatBattleState | null>>();

/**
 * The newest progress line of each build in `inFlight`, by the same token. A
 * `Channel` belongs to the one call that made it, so a component that mounts
 * mid build reads the count here instead of subscribing to the channel.
 */
const progressOf = new Map<string, Convert3doProgress>();
const progressListeners = new Set<() => void>();

function setProgress(token: string, progress: Convert3doProgress | null) {
  if (progress) progressOf.set(token, progress);
  else progressOf.delete(token);
  for (const listener of progressListeners) listener();
}

function subscribeProgress(listener: () => void) {
  progressListeners.add(listener);
  return () => {
    progressListeners.delete(listener);
  };
}

/**
 * Build the compat mutator a battle names when this machine has its base game
 * and not the mutator (issue #4564). Joining the battle is the player's choice
 * to play it, so this builds on join, with the manifest version the host is on.
 * It never turns on the player's own switch for the game.
 *
 * `rescan` forces a content scan and answers with the games it found, or null.
 * Answers `idle` when there is nothing to build, `building` from the moment
 * there is, and `update` when the host's manifest is newer than any this
 * coilbox carries.
 */
export function useCompatBattle(opts: {
  gameName: string | undefined;
  games: readonly ScannedGame[];
  enginePath: string | undefined;
  dataDir: string | undefined;
  /** The content scan has settled, so an absent mutator is a fact. */
  contentKnown: boolean;
  rescan: () => Promise<readonly { name: string }[] | null>;
}): { state: CompatBattleState; retry: () => void } {
  const { gameName, games, enginePath, dataDir, contentKnown } = opts;
  const plan = useMemo(
    () =>
      gameName
        ? classifyCompatBattle(gameName, games)
        : { kind: "none" as const },
    [gameName, games],
  );
  const planRef = useRef(plan);
  planRef.current = plan;
  const rescanRef = useRef(opts.rescan);
  rescanRef.current = opts.rescan;

  const needs = plan.kind === "needs-mutator";
  const [outcome, setOutcome] = useState<{
    key: string;
    state: CompatBattleState;
  } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const startedRef = useRef<string | null>(null);
  const key = `${dataDir}::${gameName}`;
  const token = `${key}#${attempt}`;
  const progress = useSyncExternalStore(subscribeProgress, () =>
    progressOf.get(token),
  );

  useEffect(() => {
    const p = planRef.current;
    if (p.kind !== "needs-mutator" || !contentKnown) return;
    if (!enginePath || !dataDir || !gameName) return;
    if (startedRef.current === token) return;
    startedRef.current = token;

    const failed = (e: unknown): CompatBattleState => ({
      status: "failed",
      baseName: p.baseName,
      version: p.version,
      error: msg(e),
    });
    const run = async (): Promise<CompatBattleState | null> => {
      try {
        const info = await primeGameInfo(enginePath, dataDir, p.archiveName);
        if (!info.checksum) {
          return failed(t`the base game could not be read`);
        }
        const { latest } = await compatStatus({
          dataDir,
          enginePath,
          archiveName: p.archiveName,
          baseChecksum: info.checksum,
        });
        if (compatBuildable(p.version, latest) === "update") {
          return {
            status: "update",
            baseName: p.baseName,
            version: p.version,
            latest,
          };
        }
        const onProgress = new Channel<Convert3doProgress>();
        onProgress.onmessage = (line) => setProgress(token, line);
        await compatBuild({
          dataDir,
          enginePath,
          archiveName: p.archiveName,
          gameName: p.baseName,
          baseChecksum: info.checksum,
          manifestVersion: p.version,
          onProgress,
        });
        const found = await rescanRef.current();
        if (found?.some((g) => g.name === gameName)) return null;
        return failed(t`the engine did not find it once built`);
      } catch (e) {
        return failed(e);
      }
    };

    let running = inFlight.get(token);
    if (!running) {
      running = run().finally(() => {
        inFlight.delete(token);
        setProgress(token, null);
      });
      inFlight.set(token, running);
    }
    void running.then((state) => {
      if (state) setOutcome({ key: token, state });
    });
  }, [contentKnown, enginePath, dataDir, gameName, token]);

  const retry = useCallback(() => {
    startedRef.current = null;
    setOutcome(null);
    setAttempt((n) => n + 1);
  }, []);

  if (!needs) return { state: { status: "idle" }, retry };
  if (outcome?.key === token) return { state: outcome.state, retry };
  return {
    state: {
      status: "building",
      baseName: plan.baseName,
      version: plan.version,
      progress: progress && { done: progress.done, total: progress.total },
    },
    retry,
  };
}
