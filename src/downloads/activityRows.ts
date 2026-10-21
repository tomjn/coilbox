import { t } from "@lingui/core/macro";
import type { EnqueueInput, QueueItem } from "./DownloadQueueProvider";
import {
  type DownloadHistory,
  type DownloadRecord,
  type DownloadSourceKind,
  hostOf,
  recordsFor,
} from "./downloadHistory";
import { historyKeyOf } from "./downloadRecording";
import { contentOf, type QueueContent } from "./queueLanes";
import type { SourceStep } from "./sourceWalk";

/**
 * The rows of the Library > Downloads page (issue #4583): the queue, the
 * downloads that stopped this session, and the history from #4576 for the rest.
 */

export type ActivityState =
  | "active"
  | "queued"
  | "failed"
  | "canceled"
  | "done";

export interface ActivityRow {
  /** The queue item's id, or the history key for a row from history. */
  id: string;
  state: ActivityState;
  name: string;
  content: QueueContent;
  /** Where it is coming from or came from, or null when that is not known. */
  source: string | null;
  /** The queue's item, for progress, cancel and retry. Null for history. */
  item: QueueItem | null;
  failure: string | null;
  /** The attempts behind the row, newest first, for its log. */
  records: DownloadRecord[];
  /** The first source the download did not get to, for a retry. */
  next: SourceStep | null;
  /** When it stopped, in ms. Null while it is queued or running. */
  at: number | null;
}

/** The source's name. Only the generic ones are translated, the rest are brands. */
function sourceLabel(source: DownloadSourceKind): string {
  switch (source) {
    case "rapid":
      return "Rapid";
    case "github":
      return "GitHub";
    case "springfiles":
      return "Springfiles";
    case "hakora":
      return "Hakora";
    case "evolutionrts":
      return "EvolutionRTS";
    case "url":
      return t`Direct`;
    case "file":
      return t`File`;
  }
}

/** "Springfiles · mirror.test", or the source alone when it has no host. */
export function sourceText(step: {
  source: DownloadSourceKind;
  mirror: string | null;
}): string {
  const label = sourceLabel(step.source);
  return step.mirror ? `${label} · ${step.mirror}` : label;
}

/**
 * The retry button's text. A step with a host is the next mirror of the source
 * that stopped. A map's rapid step is pr-downloader, which fetches from
 * springfiles, so it is named for what it is.
 */
export function retryLabel(next: SourceStep, content: QueueContent): string {
  if (next.mirror) return t`Try next mirror`;
  if (next.source === "rapid" && content === "map") return t`Try pr-downloader`;
  const label = sourceLabel(next.source);
  return t`Try ${label}`;
}

/**
 * The same download, asked for again from `next`. Null for a kind that fetches
 * from one source only, which has no next to start at.
 */
export function retryInput(
  item: QueueItem,
  next: SourceStep,
): EnqueueInput | null {
  const sizeBytes = item.sizeBytes;
  switch (item.kind) {
    case "game":
      return {
        kind: "game",
        label: item.label,
        args: { ...item.args, startAt: next },
        sizeBytes,
      };
    case "mapAnySource":
      return {
        kind: "mapAnySource",
        label: item.label,
        args: { ...item.args, startAt: next },
        sizeBytes,
      };
    default:
      return null;
  }
}

const isUrl = (s: string) => hostOf(s) !== null;
const stem = (filename: string) => filename.replace(/\.(sd7|sdz|7z|zip)$/i, "");

function itemName(item: QueueItem): string {
  switch (item.kind) {
    case "game":
      return item.args.gameName;
    case "mapAnySource":
      return item.args.mapName;
    case "map":
      return item.args.springName;
    case "file":
      return item.args.filename;
    default:
      return item.label;
  }
}

/** Where a download that names one source fetches from. */
function itemSource(item: QueueItem): string | null {
  switch (item.kind) {
    case "rapid":
      return `Rapid · ${item.args.tag}`;
    case "map":
      return "Springfiles";
    case "file":
      return sourceText({ source: "url", mirror: hostOf(item.args.url) });
    case "engineRecoil":
      return sourceText({
        source: "github",
        mirror: hostOf(item.args.assetUrl),
      });
    case "engineBundled":
      return t`Bundled`;
    default:
      return null;
  }
}

/** A row for an item on the queue now, or one that stopped this session. */
function itemRow(item: QueueItem, history: DownloadHistory): ActivityRow {
  const key = historyKeyOf(item);
  const stopped =
    item.status === "done" ||
    item.status === "error" ||
    item.status === "canceled";
  // This run's attempts: the ones recorded since it started.
  const since = item.startedAt ?? 0;
  const records =
    stopped && key
      ? recordsFor(history, key).filter((r) => Date.parse(r.at) >= since)
      : [];
  const state: ActivityState = item.status === "error" ? "failed" : item.status;
  const shown =
    state === "done"
      ? records.find((r) => r.outcome === "ok")
      : (records[0] ?? undefined);
  // A finished run names the attempt it recorded. A cancelled one recorded
  // nothing, so it names the source it was on when it stopped.
  const source = shown
    ? sourceText(shown)
    : item.trying
      ? sourceText(item.trying)
      : itemSource(item);
  return {
    id: item.id,
    state,
    name: itemName(item),
    content: contentOf(item),
    source,
    item,
    failure: item.error,
    records,
    next: stopped ? (item.next ?? null) : null,
    at: item.settledAt ?? null,
  };
}

/** A name for an item known only from its history. */
function recordName(key: string, records: readonly DownloadRecord[]): string {
  const named = records.find(
    (r) => r.source === "rapid" && r.reference && !isUrl(r.reference),
  );
  if (named?.reference) return named.reference;
  const file = records.find((r) => r.filename)?.filename;
  if (file) return stem(file);
  return key.slice(key.indexOf(":") + 1);
}

/**
 * Every row, the queue first in queue order, then everything that stopped,
 * newest first. A download this session stopped is drawn from the queue rather
 * than history, because only the queue knows its next source.
 */
export function activityRows(input: {
  items: readonly QueueItem[];
  settled: readonly QueueItem[];
  history: DownloadHistory;
}): ActivityRow[] {
  const { items, settled, history } = input;
  const live = items.filter(
    (i) => i.status === "queued" || i.status === "active",
  );
  const liveIds = new Set(live.map((i) => i.identity));
  // A row still in `items` after it stopped is also in `settled`. The settled
  // copy wins, since it carries when it stopped.
  const stopped = settled.filter((i) => !liveIds.has(i.identity));
  // When a download this session started under each history key. Its own
  // records belong to its row. Anything older is a separate history row, since
  // one key holds every version of a game.
  const runStarts = new Map<string, number>();
  for (const i of [...live, ...stopped]) {
    const key = historyKeyOf(i);
    if (!key) continue;
    const since = i.startedAt ?? Number.POSITIVE_INFINITY;
    runStarts.set(key, Math.min(since, runStarts.get(key) ?? since));
  }
  const fromHistory: ActivityRow[] = Object.keys(history).flatMap((key) => {
    const since = runStarts.get(key) ?? Number.POSITIVE_INFINITY;
    const records = recordsFor(history, key).filter(
      (r) => Date.parse(r.at) < since,
    );
    const newest = records[0];
    if (!newest) return [];
    return [
      {
        id: key,
        state: newest.outcome === "ok" ? "done" : "failed",
        name: recordName(key, records),
        content: key.startsWith("game:") ? "game" : "map",
        source: sourceText(newest),
        item: null,
        failure: newest.failure,
        records,
        next: null,
        at: Date.parse(newest.at),
      } satisfies ActivityRow,
    ];
  });
  const ended = [...stopped.map((i) => itemRow(i, history)), ...fromHistory];
  ended.sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
  const queue = [
    ...live.filter((i) => i.status === "active"),
    ...live.filter((i) => i.status === "queued"),
  ];
  return [...queue.map((i) => itemRow(i, history)), ...ended];
}
