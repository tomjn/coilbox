import type { Channel } from "@tauri-apps/api/core";
import {
  type DownloadProgress,
  dlDownloadFileRaw,
  dlDownloadMapRaw,
  dlHakoraMaps,
  dlSpringfilesList,
} from "./bindings";
import { withDownloadNotify } from "./downloadNotify";
import { type MapSource, mapSourceOrder } from "./mapSources";

/** BAR's map search endpoint for pr-downloader (`PRD_HTTP_SEARCH_URL`). */
const BAR_SEARCH_URL = "https://files-cdn.beyondallreason.dev/find";

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Loose key for matching a catalog entry to a battle's map name. */
const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/\.(sd7|sdz)$/, "")
    .replace(/[\s_]+/g, "");

/**
 * Download a map, trying each source in the order set by mapSourceOrder and
 * resolving with the name of the first that succeeds. Per project policy (issue
 * 511, following #500's game ordering) that order is known mirrors first, then
 * pr-downloader (rapid) as the last resort.
 *
 * 1. springfiles catalog mirror. Match by springname/name, fetch the first mirror.
 * 2. the hakora.xyz mirror. Match by filename, since it carries no springname.
 * 3. rapid via pr-downloader, tried with both the default (springfiles) search and
 *    the BAR files-cdn search. BAR-only maps aren't on springfiles, so both are
 *    attempted before giving up.
 *
 * Steps 1-2 need a write root. Without one only rapid is attempted. Throws with
 * every attempted source's error when all fail.
 */
async function downloadMapAnySourceImpl(opts: {
  mapName: string;
  writePath?: string;
  /** Pass a stable id to make the active download cancellable via dlCancel. */
  opId?: string;
  onProgress: Channel<DownloadProgress>;
}): Promise<string> {
  const { mapName, writePath, opId, onProgress } = opts;
  const target = norm(mapName);
  const errors: string[] = [];

  const attempt = async (source: MapSource): Promise<string | null> => {
    switch (source) {
      case "springfiles": {
        if (!writePath) return null;
        const { results } = await dlSpringfilesList({ category: "map" });
        const hit = results.find(
          (f) => norm(f.springname) === target || norm(f.name) === target,
        );
        const url = hit?.mirrors?.[0];
        if (!hit || !url) return null;
        await dlDownloadFileRaw({
          url,
          destDir: `${writePath}/maps`,
          filename: hit.filename,
          opId,
          onProgress,
        });
        return "springfiles mirror";
      }
      case "hakora": {
        if (!writePath) return null;
        const { maps } = await dlHakoraMaps(undefined);
        const hit = maps.find((m) => norm(m.filename) === target);
        if (!hit) return null;
        await dlDownloadFileRaw({
          url: hit.url,
          destDir: `${writePath}/maps`,
          filename: hit.filename,
          opId,
          onProgress,
        });
        return "hakora";
      }
      // rapid: try both search URLs before giving up on this step.
      case "rapid": {
        for (const searchUrl of [undefined, BAR_SEARCH_URL]) {
          const label = searchUrl ? "BAR" : "springfiles (pr-downloader)";
          try {
            await dlDownloadMapRaw({
              springName: mapName,
              searchUrl,
              writePath,
              opId,
              onProgress,
            });
            return label;
          } catch (e) {
            errors.push(`${label}: ${msg(e)}`);
          }
        }
        return null;
      }
    }
  };

  const order = mapSourceOrder({ hasWritePath: !!writePath });
  for (const source of order) {
    try {
      const result = await attempt(source);
      if (result) return result;
    } catch (e) {
      errors.push(`${source}: ${msg(e)}`);
    }
  }

  throw new Error(`No source could provide "${mapName}". ${errors.join("; ")}`);
}

export const downloadMapAnySource = withDownloadNotify(
  downloadMapAnySourceImpl,
  (o) => o.mapName,
);
