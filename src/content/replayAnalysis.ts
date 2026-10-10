import { listen } from "@tauri-apps/api/event";
import { useEffect, useSyncExternalStore } from "react";
import { isProfileHidden } from "../profile/hidden";
import {
  ANALYSIS_QUEUE_EVENT,
  contentAnalysisCancel,
  contentAnalysisDismiss,
  contentAnalysisEnqueue,
  contentAnalysisQueue,
  contentReplayAnalyses,
  contentReplayAnalysisDelete,
  type ReplayAnalysisQueue,
  type ReplayAnalysisRunningJob,
  type ReplayDisagreement,
  type StoredReplayAnalysis,
} from "./bindings";

/**
 * Replay analysis on the frontend (#1157, #1158): the queue as every window
 * sees it, the stored analyses to join to replays by game id, and the only
 * way a run is asked for.
 *
 * The queue lives in Rust and outlives any page. This module asks for it once
 * and then follows `ANALYSIS_QUEUE_EVENT`, so a page opened while a run is
 * going shows it.
 *
 * `analytics.run` gates everything that can start or steer a run. A
 * distribution that hides it cannot start one from anywhere: {@link
 * requestAnalysis} is the one call that reaches the enqueue command, and it
 * refuses. Analyses that are already stored are still read.
 */

/** Whether this distribution hides the analysis run. */
export function analysisRunHidden(): boolean {
  return isProfileHidden("analytics.run");
}

const EMPTY_QUEUE: ReplayAnalysisQueue = {
  running: null,
  queued: [],
  waitingForGame: false,
  failures: [],
  stored: 0,
};

type Analyses = ReadonlyMap<string, StoredReplayAnalysis>;

let queue: ReplayAnalysisQueue = EMPTY_QUEUE;
let analyses: Analyses = new Map();
let started = false;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function setQueue(next: ReplayAnalysisQueue): void {
  const storeChanged = next.stored !== queue.stored;
  queue = next;
  emit();
  // A run stored or replaced something, so the list is out of date.
  if (storeChanged) void refreshStoredAnalyses();
}

/** Read the stored analyses again. Called after anything that changes them. */
export async function refreshStoredAnalyses(): Promise<void> {
  try {
    const { analyses: list } = await contentReplayAnalyses(undefined);
    analyses = new Map(list.map((a) => [a.gameId, a]));
    emit();
  } catch {
    // No bridge, or the folder could not be read. What is on screen stays.
  }
}

/** Ask for the queue and the store once, and follow the queue from then on. */
function start(): void {
  if (started) return;
  started = true;
  void refreshStoredAnalyses();
  // With the run hidden nothing can be queued, so there is nothing to follow.
  if (analysisRunHidden()) return;
  contentAnalysisQueue(undefined).then(
    (r) => setQueue(r.queue),
    () => {},
  );
  try {
    listen<ReplayAnalysisQueue>(ANALYSIS_QUEUE_EVENT, (event) =>
      setQueue(event.payload),
    ).catch(() => {});
  } catch {
    // No event bridge: the first read is all there is.
  }
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

const readQueue = () => queue;
const readAnalyses = () => analyses;

/** The analysis queue, kept current. Empty when the run is hidden. */
export function useAnalysisQueue(): ReplayAnalysisQueue {
  useEffect(start, []);
  return useSyncExternalStore(subscribe, readQueue, readQueue);
}

/**
 * Every stored analysis by game id, kept current. Join it to replay records by
 * `gameId`, leaving out records with `remixed` set: a remix carries its
 * original's id and has no analysis of its own.
 */
export function useStoredAnalyses(): Analyses {
  useEffect(start, []);
  return useSyncExternalStore(subscribe, readAnalyses, readAnalyses);
}

/**
 * Ask for a replay to be analysed. The one place the enqueue command is
 * called, and it refuses when the distribution hides the run. Call it only
 * from a press of the button for that replay.
 */
export async function requestAnalysis(args: {
  replayPath: string;
  enginePath: string;
  dataDir: string;
  /** Another installed version of the replay's game, in place of its own. */
  game?: string;
  force?: boolean;
}): Promise<"queued" | "alreadyQueued" | "alreadyAnalysed"> {
  if (analysisRunHidden()) {
    throw new Error("Replay analysis is turned off in this distribution.");
  }
  const { outcome, queue: next } = await contentAnalysisEnqueue(args);
  setQueue(next);
  if (outcome === "alreadyAnalysed") void refreshStoredAnalyses();
  return outcome;
}

/** Cancel one analysis, or every one when no id is given. */
export async function cancelAnalysis(id?: number): Promise<void> {
  if (analysisRunHidden()) return;
  await contentAnalysisCancel({ id });
}

/** Forget a match's last failed run. */
export async function dismissAnalysisFailure(gameId: string): Promise<void> {
  if (analysisRunHidden()) return;
  await contentAnalysisDismiss({ gameId });
}

/** Delete a match's stored analysis, leaving the replay alone. */
export async function deleteStoredAnalysis(gameId: string): Promise<void> {
  await contentReplayAnalysisDelete({ gameId });
  await refreshStoredAnalyses();
}

/** For tests: forget everything and stop following. */
export function resetReplayAnalysisForTests(): void {
  queue = EMPTY_QUEUE;
  analyses = new Map();
  started = false;
  emit();
}

/** For tests: put a queue and a store in place without a backend. */
export function seedReplayAnalysisForTests(seed: {
  queue?: Partial<ReplayAnalysisQueue>;
  analyses?: StoredReplayAnalysis[];
}): void {
  started = true;
  queue = { ...EMPTY_QUEUE, ...seed.queue };
  analyses = new Map((seed.analyses ?? []).map((a) => [a.gameId, a]));
  emit();
}

// ---- words and figures -----------------------------------------------------

/** What stops a replay being analysed, each as a sentence to show. */
export function analysisBlockers(facts: {
  /** `contentAnalysisCheck`'s answer, or undefined while it is being asked. */
  cannot: "remix" | "noGameId" | "noGameOver" | "unreadable" | null | undefined;
  engineVersion: string;
  /** The exact engine the replay was recorded on is installed. */
  engineInstalled: boolean;
  /**
   * How many other installed engines the analysis could use instead, and how
   * many engines are installed at all, for saying which is the problem. Left
   * out, they read as none.
   */
  otherEngines?: number;
  installedEngines?: number;
  missingGame: boolean;
  /** Another installed version of the game stands in for the missing one. */
  otherGame?: boolean;
  missingMap: boolean;
  /** `replayDependencyBlock`: why the replay's game cannot run, or null. */
  dependencyBlock: string | null;
}): string[] {
  // These are about the replay itself, and nothing installed changes them.
  switch (facts.cannot) {
    case "remix":
      return [
        "This is a remix. The result it recorded belongs to the original match, so there is nothing to check a playback of it against. Analyse the original.",
      ];
    case "noGameOver":
      return [
        "This match never recorded a game over, usually because it was quit before it ended. There is nothing to check a playback against, so it cannot be analysed.",
      ];
    case "noGameId":
      return [
        "This replay has no game id, so there is nothing to file an analysis under.",
      ];
    case "unreadable":
      return ["This file does not read as a replay."];
  }
  const blockers: string[] = [];
  if (!facts.engineInstalled && !facts.otherEngines) {
    const which = facts.engineVersion
      ? `Engine ${facts.engineVersion} is not installed`
      : "This replay does not say which engine recorded it";
    blockers.push(
      facts.installedEngines
        ? `${which}, and none of the engines that are installed can run an analysis, which needs one with a headless build.`
        : `${which}, and no other engine is installed.`,
    );
  }
  if (facts.missingGame && !facts.otherGame) {
    blockers.push("The game is not installed.");
  }
  if (facts.missingMap) blockers.push("The map is not installed.");
  if (facts.dependencyBlock) blockers.push(facts.dependencyBlock);
  return blockers;
}

/**
 * What a stored analysis says about being made with another engine or another
 * version of the game than the replay was recorded with (#3869), or null when
 * it was not. A file from before this was kept, or a replay that named no
 * engine, leaves it unknown, which says nothing: it is never read as the same.
 */
export function differenceNote(a: StoredReplayAnalysis): string | null {
  const engine = a.engineDiffers === true;
  const game = a.gameDiffers === true;
  if (!engine && !game) return null;
  const said: string[] = [];
  if (engine) {
    said.push(
      `It used engine ${a.engine || "unknown"}, and the replay was recorded on engine ${a.recordedEngine || "unknown"}.`,
    );
  }
  if (game) {
    said.push(
      `It used ${a.game || "an unnamed game"}, and the replay was recorded on ${a.recordedGame || "an unnamed game"}.`,
    );
  }
  const what =
    engine && game
      ? "engine or game version"
      : engine
        ? "engine"
        : "game version";
  said.push(
    a.outcome === "diverged"
      ? `A different ${what} is the likely reason.`
      : "The playback still matched the recorded match exactly, so the events are kept.",
  );
  return said.join(" ");
}

/**
 * How long this machine's own finished runs suggest an analysis of a match
 * will take, or null when it has finished none.
 *
 * Nothing is promised from elsewhere. The figure is the playback time of every
 * stored run on this computer over the length of the matches they played,
 * applied to this match, and it comes with how many runs that is.
 */
export function estimateAnalysisSeconds(
  stored: Iterable<StoredReplayAnalysis>,
  matchSeconds: number,
): { seconds: number; runs: number } | null {
  let wall = 0;
  let played = 0;
  let runs = 0;
  for (const a of stored) {
    if (a.wallSeconds > 0 && a.matchSeconds > 0) {
      wall += a.wallSeconds;
      played += a.matchSeconds;
      runs += 1;
    }
  }
  if (runs === 0 || matchSeconds <= 0) return null;
  return { seconds: Math.round((wall / played) * matchSeconds), runs };
}

/** How far a running analysis has got, as a share of the match from 0 to 100. */
export function analysisPercent(job: ReplayAnalysisRunningJob): number {
  if (job.phase !== "playing" || job.lastFrame <= 0) return 0;
  return Math.max(
    0,
    Math.min(100, Math.round((job.frame / job.lastFrame) * 100)),
  );
}

/** What a running analysis is doing, in a few words. */
export function analysisProgressLabel(job: ReplayAnalysisRunningJob): string {
  if (job.cancelling) return "Stopping";
  if (job.phase === "starting") return "Starting the engine";
  if (job.phase === "loading") return "Loading the match";
  // The header holds whole seconds, so the last event can land past it.
  const frame = Math.min(job.frame, job.lastFrame);
  return `Frame ${frame.toLocaleString()} of ${job.lastFrame.toLocaleString()}`;
}

const FIGURE_WORDS: Record<string, string> = {
  winners: "Who won",
  gameSeconds: "The length of the match in seconds",
  teams: "The number of teams",
  samples: "The number of statistics samples",
  desyncWarnings: "Desync warnings from the engine",
  gameOver: "The game over",
  unitCreatedLines: "Units made",
  unitDestroyedLines: "Units lost",
};

/** A camel case name as words, for a figure nothing has a label for. */
function wordsFromCamelCase(name: string): string {
  const spaced = name.replace(/([A-Z])/g, " $1").toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * One figure a playback and its replay disagreed on, as a sentence.
 *
 * A team statistic is named by its key in the metric registry, so `labels` is
 * the registry's key to label map. The registry is the only place the frontend
 * names a metric.
 */
export function disagreementInWords(
  d: ReplayDisagreement,
  labels?: ReadonlyMap<string, string>,
): string {
  const figure =
    FIGURE_WORDS[d.figure] ??
    labels?.get(d.figure) ??
    wordsFromCamelCase(d.figure);
  const whose = d.team === undefined ? "" : ` for team ${d.team}`;
  const recorded = d.recorded === "" ? "nobody" : d.recorded;
  const observed = d.observed === "" ? "nobody" : d.observed;
  return `${figure}${whose}: the replay recorded ${recorded}, the playback gave ${observed}.`;
}
