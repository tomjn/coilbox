import type { SuggestedMap, SuggestedMapList } from "../content/branding";
import type { EnqueueInput, QueueStatus } from "./DownloadQueueProvider";

/**
 * Pure helpers backing the "Map packs" section on the maps download page: turning
 * a curated map into a queue request, and merging the catalog's packs with the
 * distribution profile's. Kept React-free so they can be unit-tested.
 */

/**
 * A curated map as a download-queue request, or null when it can't be queued.
 * `map` downloads go through pr-downloader by springname; `url` downloads stream a
 * direct mirror file into `<writePath>/<subdir|maps>` and so need a write root.
 * `rapid` isn't a map-download kind, so it's skipped.
 */
export function suggestedMapToInput(
  map: SuggestedMap,
  writePath: string | undefined,
): EnqueueInput | null {
  const dl = map.download;
  if (dl.kind === "map") {
    return {
      kind: "map",
      label: map.title,
      args: { springName: dl.springName, searchUrl: dl.searchUrl, writePath },
    };
  }
  if (dl.kind === "url") {
    if (!writePath) return null;
    return {
      kind: "file",
      label: map.title,
      args: {
        url: dl.url,
        destDir: `${writePath}/${dl.subdir ?? "maps"}`,
        filename: dl.filename,
      },
    };
  }
  return null;
}

/**
 * The download state of a single curated map, derived from what's on disk and the
 * shared download queue. Drives the per-map row in the pack detail view and, via
 * `packSummary`, the pack's progress count and "complete" badge.
 */
export type PackMapState =
  | "installed" // filename present on disk, or the queue reports it done
  | "active" // currently downloading
  | "queued" // waiting in the queue
  | "available" // downloadable, not started (or a failed attempt, retryable)
  | "unavailable"; // no queue input could be built (non-map download kind)

/**
 * Classify one curated map. An on-disk filename match wins outright; otherwise the
 * queue's own status decides. `error`/`canceled` fall through to "available" so a
 * failed download can be retried. React-free: the caller passes the queue status.
 */
export function packMapState(args: {
  input: EnqueueInput | null;
  filename?: string;
  /** Read-only, so a caller holding one shared listing can pass it as it is. */
  installed: ReadonlySet<string>;
  queueStatus: QueueStatus | null;
}): PackMapState {
  const { input, filename, installed, queueStatus } = args;
  if (!input) return "unavailable";
  if (filename && installed.has(filename.toLowerCase())) return "installed";
  if (queueStatus === "done") return "installed";
  if (queueStatus === "active") return "active";
  if (queueStatus === "queued") return "queued";
  return "available";
}

export interface PackSummary {
  total: number;
  done: number; // installed
  pending: number; // available to enqueue now
  inFlight: number; // queued + active
  complete: boolean; // every map installed (false for an empty pack)
}

/** Roll per-map states up into the counts the banner and pack rows display. */
export function packSummary(states: PackMapState[]): PackSummary {
  const done = states.filter((s) => s === "installed").length;
  const pending = states.filter((s) => s === "available").length;
  const inFlight = states.filter(
    (s) => s === "queued" || s === "active",
  ).length;
  return {
    total: states.length,
    done,
    pending,
    inFlight,
    complete: states.length > 0 && done === states.length,
  };
}

/**
 * Merge the branding catalog's packs with the profile's, catalog first, deduped
 * by `id` (first occurrence wins). A distribution can thus add packs or override a
 * catalog pack by reusing its id.
 */
export function mergeMapLists(
  catalog: SuggestedMapList[],
  profile: SuggestedMapList[],
): SuggestedMapList[] {
  const seen = new Set<string>();
  const out: SuggestedMapList[] = [];
  for (const list of [...catalog, ...profile]) {
    if (seen.has(list.id)) continue;
    seen.add(list.id);
    out.push(list);
  }
  return out;
}
