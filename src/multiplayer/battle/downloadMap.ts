import type { Channel } from "@tauri-apps/api/core";
import {
  type DownloadProgress,
  dlDownloadFileRaw,
  dlDownloadMapRaw,
  dlHakoraMaps,
  dlSpringfilesList,
} from "@/downloads/bindings";
import { withDownloadNotify } from "@/downloads/downloadNotify";

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
 * Download a battle's map, trying each source in turn and resolving with the name
 * of the first that succeeds. A joined battle's map might live on any of these
 * (BAR-only maps aren't on springfiles, some maps are only on the hakora mirror),
 * so rather than make the user pick a source we fall through them:
 *   1. pr-downloader via springfiles (the default search)
 *   2. pr-downloader via BAR's files-cdn
 *   3. springfiles catalog → direct mirror download
 *   4. the hakora.xyz mirror → direct download
 * Steps 3-4 need a write root; if none is configured they're skipped. Throws with
 * every source's error when all fail.
 */
async function downloadMapAnySourceImpl(opts: {
  mapName: string;
  writePath?: string;
  onProgress: Channel<DownloadProgress>;
}): Promise<string> {
  const { mapName, writePath, onProgress } = opts;
  const target = norm(mapName);
  const errors: string[] = [];

  // 1-2) pr-downloader resolves the springname itself via the search URL.
  for (const searchUrl of [undefined, BAR_SEARCH_URL]) {
    const label = searchUrl ? "BAR" : "springfiles";
    try {
      await dlDownloadMapRaw({
        springName: mapName,
        searchUrl,
        writePath,
        onProgress,
      });
      return label;
    } catch (e) {
      errors.push(`${label}: ${msg(e)}`);
    }
  }

  // Direct-download fallbacks need a destination root.
  if (writePath) {
    const destDir = `${writePath}/maps`;

    // 3) springfiles catalog: match by springname/name, fetch the first mirror.
    try {
      const { results } = await dlSpringfilesList({ category: "map" });
      const hit = results.find(
        (f) => norm(f.springname) === target || norm(f.name) === target,
      );
      const url = hit?.mirrors?.[0];
      if (hit && url) {
        await dlDownloadFileRaw({
          url,
          destDir,
          filename: hit.filename,
          onProgress,
        });
        return "springfiles mirror";
      }
    } catch (e) {
      errors.push(`springfiles catalog: ${msg(e)}`);
    }

    // 4) hakora mirror: match by filename (it carries no springname).
    try {
      const { maps } = await dlHakoraMaps(undefined);
      const hit = maps.find((m) => norm(m.filename) === target);
      if (hit) {
        await dlDownloadFileRaw({
          url: hit.url,
          destDir,
          filename: hit.filename,
          onProgress,
        });
        return "hakora";
      }
    } catch (e) {
      errors.push(`hakora: ${msg(e)}`);
    }
  }

  throw new Error(`No source could provide "${mapName}". ${errors.join("; ")}`);
}

export const downloadMapAnySource = withDownloadNotify(
  downloadMapAnySourceImpl,
  (o) => o.mapName,
);
