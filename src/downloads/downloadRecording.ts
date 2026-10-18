import type { QueueItem } from "./DownloadQueueProvider";
import { type DownloadAttempt, downloadKey, hostOf } from "./downloadHistory";

/** What the queue stores for a settled item, before it is dated. */
export interface RecordToWrite {
  key: string;
  attempt: DownloadAttempt;
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
        failure,
        durationMs,
      },
    },
  ];
  const each = (key: string): RecordToWrite[] =>
    reported.map((attempt) => ({ key, attempt }));

  switch (item.kind) {
    case "game":
      return each(downloadKey("game", item.args.gameName));
    case "mapAnySource":
      return each(downloadKey("map", item.args.mapName));
    case "rapid":
      return single(downloadKey("game", item.label), "rapid", {
        reference: item.args.tag,
        filename: null,
        url: item.args.masterUrl,
      });
    case "map":
      return single(downloadKey("map", item.args.springName), "springfiles", {
        reference: item.args.searchUrl ?? item.args.springName,
        filename: null,
        url: item.args.searchUrl,
      });
    case "file": {
      const name = stem(item.args.filename);
      const from = {
        reference: item.args.url,
        filename: item.args.filename,
        url: item.args.url,
      };
      if (item.args.destDir.endsWith("/maps"))
        return single(downloadKey("map", name), "url", from);
      if (item.args.destDir.endsWith("/games"))
        return single(
          downloadKey("game", name.replace(/_/g, " ")),
          "url",
          from,
        );
      return [];
    }
    default:
      return [];
  }
}
