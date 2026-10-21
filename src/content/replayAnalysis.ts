import { i18n, type MessageDescriptor } from "@lingui/core";
import { msg, t } from "@lingui/core/macro";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useSyncExternalStore } from "react";
import { formatNumber } from "@/lib/format";
import { isProfileHidden } from "../profile/hidden";
import {
  ANALYSIS_QUEUE_EVENT,
  contentAnalysisCancel,
  contentAnalysisDismiss,
  contentAnalysisEngineOutput,
  contentAnalysisEnqueue,
  contentAnalysisQueue,
  contentReplayAnalyses,
  contentReplayAnalysisDelete,
  type ReplayAnalysisQueue,
  type ReplayAnalysisRunningJob,
  type ReplayDisagreement,
  type StoredReplayAnalysis,
} from "./bindings";
import { refreshStoredTracks } from "./replayTracks";

/**
 * Replay analysis on the frontend (#1157, #1158): the queue as every window
 * sees it, the stored analyses to join to replays by game id, and the only
 * way a run is asked for. A run also records the match as a track (#3962), so
 * there is one way to ask and the engine plays a replay once for both.
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

/**
 * The element id of the section that analyses and records a replay, so another
 * section can point at it.
 */
export const ANALYSIS_SECTION_ID = "replay-analysis";

/**
 * Marks the button in that section that asks for a run, so another section can
 * send focus to it. The section's first button is its help.
 */
export const ANALYSIS_ACTION_ATTRIBUTE = "data-analysis-action";

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
  tracks: 0,
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
  const tracksChanged = next.tracks !== queue.tracks;
  queue = next;
  emit();
  // A run stored or replaced something, so the list is out of date.
  if (storeChanged) void refreshStoredAnalyses();
  if (tracksChanged) void refreshStoredTracks();
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
 * Ask for a replay to be analysed and recorded. The one place the enqueue
 * command is called, and it refuses when the distribution hides the run. Call
 * it only from a press of the button for that replay.
 *
 * Answers `queued`, `alreadyQueued`, or `alreadyDone` for a match whose
 * analysis and track are both current when `force` is not set.
 */
export async function requestAnalysis(args: {
  replayPath: string;
  enginePath: string;
  dataDir: string;
  /** Another installed version of the replay's game, in place of its own. */
  game?: string;
  force?: boolean;
}): Promise<"queued" | "alreadyQueued" | "alreadyDone"> {
  if (analysisRunHidden()) {
    throw new Error(t`Replay analysis is turned off in this distribution.`);
  }
  const { outcome, queue: next } = await contentAnalysisEnqueue(args);
  setQueue(next);
  if (outcome === "alreadyDone") {
    void refreshStoredAnalyses();
    void refreshStoredTracks();
  }
  return outcome;
}

/** Cancel one analysis, or every one when no id is given. */
export async function cancelAnalysis(id?: number): Promise<void> {
  if (analysisRunHidden()) return;
  await contentAnalysisCancel({ id });
}

/**
 * What a running analysis's engine has said most recently, oldest line first.
 * Empty when that job is no longer the one running.
 */
export async function analysisEngineOutput(id: number): Promise<string[]> {
  if (analysisRunHidden()) return [];
  const { lines } = await contentAnalysisEngineOutput({ id });
  return lines ?? [];
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
  cannot:
    | "remix"
    | "noGameId"
    | "noGameOver"
    | "playbackGame"
    | "unreadable"
    | null
    | undefined;
  engineVersion: string;
  /** The exact engine the replay was recorded on is installed. */
  engineInstalled: boolean;
  /**
   * That engine has a headless build, which is the only kind that can play a
   * match back without a window. Left out, it reads as yes.
   */
  engineHeadless?: boolean;
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
        t`This is a remix. The result it recorded belongs to the original match, so there is nothing to check a playback of it against. Analyse the original.`,
      ];
    case "noGameOver":
      return [
        t`This match never recorded a game over, usually because it was quit before it ended. There is nothing to check a playback against, so it cannot be analysed.`,
      ];
    case "noGameId":
      return [
        t`This replay has no game id, so there is nothing to file an analysis under.`,
      ];
    case "playbackGame":
      return [
        t`This replay was recorded on the replay playback game. It has no match of its own to record.`,
      ];
    case "unreadable":
      return [t`This file does not read as a replay.`];
  }
  const blockers: string[] = [];
  if (!facts.engineInstalled && !facts.otherEngines) {
    const engineVersion = facts.engineVersion;
    blockers.push(
      facts.installedEngines
        ? engineVersion
          ? t`Engine ${engineVersion} is not installed, and none of the engines that are installed can run an analysis, which needs one with a headless build.`
          : t`This replay does not say which engine recorded it, and none of the engines that are installed can run an analysis, which needs one with a headless build.`
        : engineVersion
          ? t`Engine ${engineVersion} is not installed, and no other engine is installed.`
          : t`This replay does not say which engine recorded it, and no other engine is installed.`,
    );
  } else if (facts.engineInstalled && facts.engineHeadless === false) {
    const engineVersion = facts.engineVersion;
    blockers.push(
      t`Engine ${engineVersion} has no headless build, which the playback needs.`,
    );
  }
  if (facts.missingGame && !facts.otherGame) {
    blockers.push(t`The game is not installed.`);
  }
  if (facts.missingMap) blockers.push(t`The map is not installed.`);
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
    const usedEngine = a.engine || t`unknown`;
    const recordedEngine = a.recordedEngine || t`unknown`;
    said.push(
      t`It used engine ${usedEngine}, and the replay was recorded on engine ${recordedEngine}.`,
    );
  }
  if (game) {
    const usedGame = a.game || t`an unnamed game`;
    const recordedGame = a.recordedGame || t`an unnamed game`;
    said.push(
      t`It used ${usedGame}, and the replay was recorded on ${recordedGame}.`,
    );
  }
  if (a.outcome === "diverged") {
    said.push(
      engine && game
        ? t`A different engine or game version is the likely reason.`
        : engine
          ? t`A different engine is the likely reason.`
          : t`A different game version is the likely reason.`,
    );
  } else {
    said.push(
      t`The playback still matched the recorded match exactly, so the events are kept.`,
    );
  }
  return said.join(" ");
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
  if (job.cancelling) return t`Stopping`;
  if (job.phase === "thinning") return t`Making the track`;
  if (job.phase === "starting") return t`Starting the engine`;
  if (job.phase === "loading") return t`Loading the match`;
  // The header holds whole seconds, so the last event can land past it.
  const frame = Math.min(job.frame, job.lastFrame);
  const current = formatNumber(frame);
  const last = formatNumber(job.lastFrame);
  return t`Frame ${current} of ${last}`;
}

const FIGURE_WORDS: Record<string, MessageDescriptor> = {
  winners: msg`Who won`,
  gameSeconds: msg`The length of the match in seconds`,
  teams: msg`The number of teams`,
  samples: msg`The number of statistics samples`,
  desyncWarnings: msg`Desync warnings from the engine`,
  gameOver: msg`The game over`,
  unitCreatedLines: msg`Units made`,
  unitDestroyedLines: msg`Units lost`,
  unitsReceivedLines: msg`Units given to the team, as the log counted them`,
  unitsSentLines: msg`Units the team gave away, as the log counted them`,
  unitsCapturedLines: msg`Units the team captured, as the log counted them`,
  unitsOutCapturedLines: msg`Units captured from the team, as the log counted them`,
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
  const known = FIGURE_WORDS[d.figure];
  const figure =
    (known ? i18n._(known) : undefined) ??
    labels?.get(d.figure) ??
    wordsFromCamelCase(d.figure);
  const recorded = d.recorded === "" ? t`nobody` : d.recorded;
  const observed = d.observed === "" ? t`nobody` : d.observed;
  if (d.team === undefined)
    return t`${figure}: the replay recorded ${recorded}, the playback gave ${observed}.`;
  const team = d.team;
  return t`${figure} for team ${team}: the replay recorded ${recorded}, the playback gave ${observed}.`;
}
