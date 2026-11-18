import { plural, t } from "@lingui/core/macro";
import { useSyncExternalStore } from "react";
import {
  type UploadFactsResult,
  unitsyncUploadFacts,
} from "@/content/bindings";
import { primeScan } from "@/content/config";
import { describeError } from "@/i18n/uiError";
import { type NotifyInput, notify } from "@/notify/notify";
import {
  type ArchiveFacts,
  type ArchiveUploadOutcome,
  type ArchiveUploadState,
  cancelArchiveUpload,
  startArchiveUpload,
} from "../archiveUploads";
import {
  beginManualSend,
  endManualSend,
  type SendSubject,
} from "../manualSend/grant";
import {
  catalogSkipSummary,
  liveSweepTools,
  type SweepReport,
  sweepMapCatalog,
} from "../maps/catalogSweep";
import { fetchMapFacts, type LookupResult } from "../maps/lookup";
import { describeUploadEnd } from "./messages";
import {
  followArchiveUploads,
  readArchiveUploads,
  rememberUpload,
  subscribeArchiveUploads,
} from "./store";

/**
 * Uploading every installed map the hub has no file for, from Settings >
 * Coilbox hub.
 *
 * Two steps, each started by a press. Finding asks the hub about every
 * installed map by name, then reads the upload facts of each map it has no
 * file for. Reading hashes the archive, so maps the hub already has a file for
 * are never read. Uploading sends the maps found one at a time, each under a
 * grant of its own as a single upload is, and carries on past one that fails.
 * Each map's facts go first, under the same grant, because the hub lists a map
 * only once it has its facts and refuses the file of a map it has none for.
 *
 * The run belongs to the app, not to the settings page, so leaving the page
 * does not stop it. Its uploads are quiet: the run says how it went once, at the
 * end, rather than once per map.
 */

/** A map that can be uploaded: its facts and the file to send. */
export interface BulkMapCandidate {
  mapName: string;
  facts: ArchiveFacts;
  path: string;
}

/** A map the hub has no file for that cannot be uploaded, and why. */
export interface BulkMapSkip {
  mapName: string;
  reason: string;
}

export interface BulkFindResult {
  candidates: BulkMapCandidate[];
  skipped: BulkMapSkip[];
  /** How many installed maps the hub already has a file for. */
  listed: number;
}

export type BulkFindProgress =
  | { phase: "asking" }
  | { phase: "reading"; done: number; total: number };

export type BulkItemStatus =
  | "waiting"
  | "sending"
  | "listed"
  | "failed"
  | "stopped";

export interface BulkItem {
  mapName: string;
  filename: string;
  size: number;
  status: BulkItemStatus;
  /** Why it failed, for a `failed` item. */
  said?: string;
}

/** Which hub, and where the library the maps come from is. */
export interface BulkTarget {
  hubUrl: string;
  enginePath: string;
  dataDir: string;
}

export interface BulkRun {
  hubUrl: string;
  items: BulkItem[];
  running: boolean;
}

/** Everything a find and a run reach outside this file, so tests can stand in. */
export interface BulkTools {
  mapNames(enginePath: string, dataDir: string): Promise<string[]>;
  hubFacts(hubUrl: string, names: string[]): Promise<LookupResult>;
  readFacts(args: {
    enginePath: string;
    dataDir: string;
    map: string;
  }): Promise<UploadFactsResult>;
  begin(subject: SendSubject): Promise<string>;
  end(grant: string): Promise<void>;
  /** Send one map's facts under this grant, if the hub does not have them. */
  sendFacts(
    target: BulkTarget,
    mapName: string,
    grant: string,
  ): Promise<SweepReport>;
  start(
    hubUrl: string,
    path: string,
    facts: ArchiveFacts,
    grant: string,
  ): Promise<ArchiveUploadState>;
  /** Wait for the upload with this id to end, and answer how. */
  ended(opId: string): Promise<ArchiveUploadOutcome>;
  cancel(opId: string): Promise<void>;
  notify(input: NotifyInput): void;
}

export const liveBulkTools: BulkTools = {
  mapNames: async (enginePath, dataDir) =>
    (await primeScan(enginePath, dataDir)).maps.map((map) => map.name),
  hubFacts: (hubUrl, names) => fetchMapFacts(hubUrl, names),
  readFacts: (args) => unitsyncUploadFacts(args),
  begin: beginManualSend,
  end: endManualSend,
  sendFacts: (target, mapName, grant) =>
    sweepMapCatalog({ ...target, only: mapName }, () => {}, {
      ...liveSweepTools,
      ask: (hubUrl, keys, onProgress) =>
        liveSweepTools.ask(hubUrl, keys, onProgress, grant),
      send: (hubUrl, entries, onProgress) =>
        liveSweepTools.send(hubUrl, entries, onProgress, grant),
    }),
  start: async (hubUrl, path, facts, grant) => {
    await followArchiveUploads();
    const state = await startArchiveUpload(hubUrl, path, facts, grant);
    rememberUpload(
      state,
      { kind: "map", label: facts.internal_name, mapName: facts.internal_name },
      { quiet: true },
    );
    return state;
  },
  ended: uploadEnded,
  cancel: cancelArchiveUpload,
  notify: (input) => void notify(input),
};

/** Wait until the store holds this upload as done. */
function uploadEnded(opId: string): Promise<ArchiveUploadOutcome> {
  return new Promise((resolve) => {
    const check = () => {
      const state = readArchiveUploads().find((one) => one.opId === opId);
      if (state?.phase !== "done" || !state.outcome) return false;
      stop();
      resolve(state.outcome);
      return true;
    };
    const stop = subscribeArchiveUploads(check);
    check();
  });
}

/**
 * Find the installed maps the hub has no file for, and read the facts of each.
 * Rejects when the library cannot be listed or the hub cannot be asked, because
 * either would make every map look missing.
 */
export async function findMissingMaps(
  target: BulkTarget,
  onProgress: (progress: BulkFindProgress) => void,
  tools: BulkTools = liveBulkTools,
): Promise<BulkFindResult> {
  const { hubUrl, enginePath, dataDir } = target;
  const names = [...new Set(await tools.mapNames(enginePath, dataDir))];
  onProgress({ phase: "asking" });
  const answer = await tools.hubFacts(hubUrl, names);
  if (!answer.ok) throw new Error(answer.reason);

  const missing = names.filter(
    (_, at) => !(answer.maps[at]?.downloads ?? []).some((d) => d.sha256),
  );
  const candidates: BulkMapCandidate[] = [];
  const skipped: BulkMapSkip[] = [];
  const hashes = new Set<string>();
  for (const [at, mapName] of missing.entries()) {
    onProgress({ phase: "reading", done: at, total: missing.length });
    try {
      const read = await tools.readFacts({ enginePath, dataDir, map: mapName });
      if (read.facts && read.path) {
        // Two names can come from one archive, and it goes up once.
        if (hashes.has(read.facts.sha256)) continue;
        hashes.add(read.facts.sha256);
        candidates.push({ mapName, facts: read.facts, path: read.path });
      } else {
        skipped.push({
          mapName,
          reason:
            read.problem ??
            read.errors[0] ??
            t`Coilbox could not find the file for this map.`,
        });
      }
    } catch (e) {
      skipped.push({ mapName, reason: describeError(e) });
    }
  }
  onProgress({
    phase: "reading",
    done: missing.length,
    total: missing.length,
  });
  return {
    candidates,
    skipped,
    listed: names.length - missing.length,
  };
}

/**
 * Why a map's file cannot go up after sending its facts, or null when the hub
 * now holds them or already did.
 */
export function factsProblem(report: SweepReport): string | null {
  if (report.read === 0) {
    return (
      report.errors[0] ??
      catalogSkipSummary(report.skipped) ??
      t`Coilbox could not read the map.`
    );
  }
  const refused = report.problems[0];
  if (!refused) return null;
  if (refused.said) return refused.said;
  return refused.outcome === "conflict"
    ? t`The hub has a different map under this name, so your copy may not match other players'.`
    : t`The hub would not take this map's facts.`;
}

/**
 * Send one map's facts under the grant its upload holds, ahead of its file.
 * Answers why the file cannot go up, or null when it can.
 */
export async function sendMapFactsFirst(
  target: BulkTarget,
  mapName: string,
  grant: string,
  tools: Pick<BulkTools, "sendFacts"> = liveBulkTools,
): Promise<string | null> {
  return factsProblem(await tools.sendFacts(target, mapName, grant));
}

let run: BulkRun | null = null;
let current: string | null = null;
let stopping = false;
const listeners = new Set<() => void>();

function set(next: BulkRun): void {
  run = next;
  for (const listener of listeners) listener();
}

function setItem(at: number, change: Partial<BulkItem>): void {
  if (!run) return;
  set({
    ...run,
    items: run.items.map((item, i) =>
      i === at ? { ...item, ...change } : item,
    ),
  });
}

/** The run in progress or the last one to end, or null before any. */
export function readBulkRun(): BulkRun | null {
  return run;
}

export function useBulkRun(): BulkRun | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    readBulkRun,
    readBulkRun,
  );
}

/**
 * Upload these maps one after another. Answers when the run ends, however it
 * ends, and never rejects: each map's failure is kept on its item. Starting a
 * run while one is going does nothing.
 */
export async function runBulkUpload(
  target: BulkTarget,
  candidates: readonly BulkMapCandidate[],
  tools: BulkTools = liveBulkTools,
): Promise<void> {
  const { hubUrl } = target;
  if (run?.running) return;
  stopping = false;
  set({
    hubUrl,
    running: true,
    items: candidates.map((one) => ({
      mapName: one.mapName,
      filename: one.facts.filename,
      size: one.facts.size,
      status: "waiting",
    })),
  });

  for (const [at, one] of candidates.entries()) {
    if (stopping) {
      setItem(at, { status: "stopped" });
      continue;
    }
    setItem(at, { status: "sending" });
    let grant: string | null = null;
    let opId: string | null = null;
    try {
      grant = await tools.begin({
        kind: "map",
        map_name: one.facts.internal_name,
      });
      const problem = await sendMapFactsFirst(
        target,
        one.mapName,
        grant,
        tools,
      );
      if (problem) setItem(at, { status: "failed", said: problem });
      else if (stopping) setItem(at, { status: "stopped" });
      else opId = (await tools.start(hubUrl, one.path, one.facts, grant)).opId;
    } catch (e) {
      setItem(at, { status: "failed", said: describeError(e) });
    } finally {
      if (grant) {
        await tools.end(grant).catch((e: unknown) => {
          console.warn("could not end hub upload grant", e);
        });
      }
    }
    if (!opId) continue;
    current = opId;
    // Stop pressed while the upload was starting, before its id was known.
    if (stopping) await tools.cancel(opId).catch(() => {});
    const outcome = await tools.ended(opId);
    current = null;
    if (outcome.kind === "listed") setItem(at, { status: "listed" });
    else if (outcome.kind === "cancelled") setItem(at, { status: "stopped" });
    else {
      const said = describeUploadEnd(outcome, one.mapName, {
        listed: null,
        game: null,
      });
      setItem(at, {
        status: "failed",
        said: said.body ? `${said.title} ${said.body}` : said.title,
      });
    }
  }

  if (run) set({ ...run, running: false });
  const items = run?.items ?? [];
  const listed = items.filter((item) => item.status === "listed").length;
  const failed = items.filter((item) => item.status === "failed").length;
  const total = items.length;
  tools.notify({
    title: t`Uploaded ${listed} of ${plural(total, { one: "# map", other: "# maps" })} to the hub`,
    body:
      failed > 0
        ? plural(failed, {
            one: "# map failed. Settings > Coilbox hub says why.",
            other: "# maps failed. Settings > Coilbox hub says why.",
          })
        : undefined,
    level: failed > 0 ? "warning" : "success",
    to: "/settings/hub",
    sticky: failed > 0,
  });
}

/** Stop the run: cancel the upload going now and send no more. */
export function stopBulkUpload(tools: BulkTools = liveBulkTools): void {
  if (!run?.running) return;
  stopping = true;
  if (current) void tools.cancel(current).catch(() => {});
}

/** Forget the run. For tests, which must not inherit each other's. */
export function forgetBulkRun(): void {
  run = null;
  current = null;
  stopping = false;
  for (const listener of listeners) listener();
}
