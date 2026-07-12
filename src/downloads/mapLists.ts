import type { SuggestedMap, SuggestedMapList } from "../content/branding";
import type { EnqueueInput } from "./DownloadQueueProvider";

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
