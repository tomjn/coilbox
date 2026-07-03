import type { Channel } from "@tauri-apps/api/core";
import {
  type DownloadProgress,
  dlDownload,
  dlDownloadFile,
  dlSpringfilesList,
} from "@/downloads/bindings";

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Loose key for matching a catalog entry to a battle's game name. */
const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/\.(sd7|sdz)$/, "")
    .replace(/[\s_]+/g, "");

/**
 * Download a battle's game, trying each source in turn and resolving with the
 * name of the first that succeeds. The game analogue of `downloadMapAnySource`:
 *   1. rapid via pr-downloader — `--download-game <name>` resolves the long name
 *      to a tag against the master index (this is how BAR ships), so we pass the
 *      battle's `modname` straight through.
 *   2. springfiles catalog → direct mirror download, for non-rapid community
 *      games (what the Downloads → Games page uses).
 * Step 2 needs a write root; if none is configured it's skipped. Throws with
 * every source's error when all fail.
 */
export async function downloadGameAnySource(opts: {
  gameName: string;
  writePath?: string;
  onProgress: Channel<DownloadProgress>;
}): Promise<string> {
  const { gameName, writePath, onProgress } = opts;
  const errors: string[] = [];

  // 1) rapid: pr-downloader resolves the long name to a tag via the master index.
  try {
    await dlDownload({ tag: gameName, writePath, onProgress });
    return "rapid";
  } catch (e) {
    errors.push(`rapid: ${msg(e)}`);
  }

  // 2) springfiles catalog: match by springname/name, fetch the first mirror.
  if (writePath) {
    try {
      const target = norm(gameName);
      const { results } = await dlSpringfilesList({ category: "game" });
      const hit = results.find(
        (f) => norm(f.springname) === target || norm(f.name) === target,
      );
      const url = hit?.mirrors?.[0];
      if (hit && url) {
        await dlDownloadFile({
          url,
          destDir: `${writePath}/games`,
          filename: hit.filename,
          onProgress,
        });
        return "springfiles mirror";
      }
    } catch (e) {
      errors.push(`springfiles catalog: ${msg(e)}`);
    }
  }

  throw new Error(
    `No source could provide "${gameName}". ${errors.join("; ")}`,
  );
}
