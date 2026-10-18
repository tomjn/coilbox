import type { EnqueueInput, QueueItem } from "./DownloadQueueProvider";
import { type DownloadAttempt, downloadKey, hostOf } from "./downloadHistory";
import { describeFailure, type FailureContext } from "./failureReason";

/** What the queue stores for a settled item, before it is dated. */
export interface RecordToWrite {
  key: string;
  attempt: DownloadAttempt;
}

/** Which host and file a failure of this item should be put in terms of. */
export function failureContextOf(item: QueueItem): FailureContext {
  switch (item.kind) {
    case "file":
      return { host: hostOf(item.args.url), filename: item.args.filename };
    case "rapid":
      return {
        host: item.args.masterUrl ? hostOf(item.args.masterUrl) : null,
        filename: null,
      };
    case "map":
      return {
        host: item.args.searchUrl ? hostOf(item.args.searchUrl) : null,
        filename: null,
      };
    default:
      return { host: null, filename: null };
  }
}

/**
 * What to show for a download that failed with `raw` (issue #4577). A game or map
 * fetched from any source has already put every source's reason in its error,
 * so that stands. The other kinds name the one host they used.
 */
export function failureText(item: QueueItem, raw: string): string {
  return item.kind === "game" || item.kind === "mapAnySource"
    ? raw
    : describeFailure(raw, failureContextOf(item));
}

const stem = (filename: string) => filename.replace(/\.(sd7|sdz)$/i, "");

/**
 * What to store for a download that has settled (issue #4576).
 *
 * A game or map fetched from any source reports each source it tried, so those
 * are stored as they came. Every other kind has the one source it names, so a
 * record is made from the request. Engines are not library items and store
 * nothing, and neither does a file outside the games and maps folders.
 *
 * `failure` is null when the download worked. A game or map that failed before
 * any source was tried has no source to name, so it stores nothing.
 */
export function attemptsToRecord(
  item: QueueItem,
  reported: readonly DownloadAttempt[],
  failure: string | null,
  now: number,
): RecordToWrite[] {
  const durationMs = Math.max(0, now - (item.startedAt ?? now));
  const single = (
    key: string,
    source: DownloadAttempt["source"],
    from: Pick<DownloadAttempt, "reference" | "filename"> & { url?: string },
  ): RecordToWrite[] => [
    {
      key,
      attempt: {
        source,
        outcome: failure === null ? "ok" : "failed",
        reference: from.reference,
        filename: from.filename,
        md5: null,
        mirror: from.url ? hostOf(from.url) : null,
        failure:
          failure === null
            ? null
            : describeFailure(failure, {
                host: from.url ? hostOf(from.url) : null,
                filename: from.filename,
              }),
        ...(failure === null ? {} : { detail: failure }),
        durationMs,
      },
    },
  ];
  const key = historyKeyOf(item);
  if (!key) return [];
  switch (item.kind) {
    case "game":
    case "mapAnySource":
      return reported.map((attempt) => ({ key, attempt }));
    case "rapid":
      return single(key, "rapid", {
        reference: item.args.tag,
        filename: null,
        url: item.args.masterUrl,
      });
    case "map":
      return single(key, "springfiles", {
        reference: item.args.searchUrl ?? item.args.springName,
        filename: null,
        url: item.args.searchUrl,
      });
    case "file":
      return single(key, "url", {
        reference: item.args.url,
        filename: item.args.filename,
        url: item.args.url,
      });
    default:
      return [];
  }
}

/**
 * The history key a download's attempts are stored under, or null for one that
 * stores nothing: an engine, or a file outside the games and maps folders.
 */
export function historyKeyOf(item: EnqueueInput): string | null {
  switch (item.kind) {
    case "game":
      return downloadKey("game", item.args.gameName);
    case "mapAnySource":
      return downloadKey("map", item.args.mapName);
    case "rapid":
      return downloadKey("game", item.label);
    case "map":
      return downloadKey("map", item.args.springName);
    case "file": {
      const name = stem(item.args.filename);
      if (item.args.destDir.endsWith("/maps")) return downloadKey("map", name);
      if (item.args.destDir.endsWith("/games"))
        return downloadKey("game", name.replace(/_/g, " "));
      return null;
    }
    default:
      return null;
  }
}
