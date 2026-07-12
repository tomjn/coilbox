import type { Channel } from "@tauri-apps/api/core";
import {
  type DownloadProgress,
  dlDownloadFileRaw,
  dlDownloadRaw,
  dlGithubReleaseArchives,
  dlSpringfilesList,
} from "@/downloads/bindings";
import { withDownloadNotify } from "@/downloads/downloadNotify";
import { githubRepoForGame, norm } from "@/downloads/gameRepos";

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

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
async function downloadGameAnySourceImpl(opts: {
  gameName: string;
  writePath?: string;
  onProgress: Channel<DownloadProgress>;
}): Promise<string> {
  const { gameName, writePath, onProgress } = opts;
  const errors: string[] = [];

  // 1) rapid: pr-downloader resolves the long name to a tag via the master index.
  try {
    await dlDownloadRaw({ tag: gameName, writePath, onProgress });
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
        await dlDownloadFileRaw({
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

  // 3) curated GitHub releases: some games (e.g. SplinterFaction) ship only via
  // GitHub release archives, not rapid or springfiles. Resolve a known repo from
  // the game name and fetch its matching (or newest) release archive.
  if (writePath) {
    try {
      const repo = githubRepoForGame(gameName);
      if (repo) {
        const { archives } = await dlGithubReleaseArchives({ repo });
        const target = norm(gameName);
        const hit =
          archives.find((a) => norm(a.filename) === target) ?? archives[0];
        if (hit) {
          await dlDownloadFileRaw({
            url: hit.url,
            destDir: `${writePath}/games`,
            filename: hit.filename,
            onProgress,
          });
          return "github release";
        }
      }
    } catch (e) {
      errors.push(`github releases: ${msg(e)}`);
    }
  }

  throw new Error(
    `No source could provide "${gameName}". ${errors.join("; ")}`,
  );
}

export const downloadGameAnySource = withDownloadNotify(
  downloadGameAnySourceImpl,
  (o) => o.gameName,
);
