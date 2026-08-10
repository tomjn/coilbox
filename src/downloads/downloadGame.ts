import type { Channel } from "@tauri-apps/api/core";
import { loadGithubGameRepos } from "../content/branding";
import {
  type DownloadProgress,
  dlDownloadFileRaw,
  dlDownloadRaw,
  dlGithubReleaseArchives,
  dlSpringfilesList,
} from "./bindings";
import { withDownloadNotify } from "./downloadNotify";
import {
  GAME_REPOS,
  githubRepoForGame,
  mergeGameRepos,
  norm,
} from "./gameRepos";
import { type GameSource, gameSourceOrder } from "./gameSources";
import { DEFAULT_RAPID_MASTERS } from "./rapidMasters";

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Download a game, trying each source in the order set by gameSourceOrder and
 * resolving with the name of the first that succeeds. Per project policy (issue
 * 500) that order is GitHub releases and known mirrors first, then pr-downloader
 * (rapid) as the last resort.
 *
 * 1. curated GitHub releases. Some games such as SplinterFaction ship only via
 *    GitHub release archives, which pr-downloader cannot reach at all.
 * 2. springfiles catalog mirror. A direct mirror download for non-rapid games.
 * 3. rapid via pr-downloader. The download-game flag resolves the long name to a
 *    tag against the master index (this is how BAR ships), so we pass the game
 *    modname straight through.
 *
 * Steps 1 and 2 need a write root. Without one only rapid is attempted. Throws
 * with every attempted source error when all fail.
 *
 * The GitHub repo per game comes from the unified registry (issue #512): the
 * branding catalog is authoritative, `GAME_REPOS` in `gameRepos.ts` is the
 * in-code fallback seed. See `mergeGameRepos`.
 */
async function downloadGameAnySourceImpl(opts: {
  gameName: string;
  writePath?: string;
  /** Pass a stable id to make the active download cancellable via dlCancel. */
  opId?: string;
  onProgress: Channel<DownloadProgress>;
}): Promise<string> {
  const { gameName, writePath, opId, onProgress } = opts;
  const target = norm(gameName);
  const errors: string[] = [];

  // The unified GitHub game-repo registry (issue #512): the catalog is
  // authoritative once loaded, the in-code GAME_REPOS list is the fallback seed.
  const repos = mergeGameRepos(await loadGithubGameRepos(), GAME_REPOS);

  const attempt = async (source: GameSource): Promise<string | null> => {
    switch (source) {
      // Curated GitHub releases: resolve a known repo from the game name and
      // fetch its matching (or newest) release archive.
      case "github": {
        const repo = githubRepoForGame(repos, gameName);
        if (!repo || !writePath) return null;
        const { archives } = await dlGithubReleaseArchives({ repo });
        const hit =
          archives.find((a) => norm(a.filename) === target) ?? archives[0];
        if (!hit) return null;
        await dlDownloadFileRaw({
          url: hit.url,
          destDir: `${writePath}/games`,
          filename: hit.filename,
          opId,
          onProgress,
        });
        return "github release";
      }
      // springfiles catalog: match by springname or name, fetch the first mirror.
      case "springfiles": {
        if (!writePath) return null;
        const { results } = await dlSpringfilesList({ category: "game" });
        const found = results.find(
          (f) => norm(f.springname) === target || norm(f.name) === target,
        );
        const url = found?.mirrors?.[0];
        if (!found || !url) return null;
        await dlDownloadFileRaw({
          url,
          destDir: `${writePath}/games`,
          filename: found.filename,
          opId,
          onProgress,
        });
        return "springfiles mirror";
      }
      // rapid: pr-downloader resolves the long name to a tag via the master
      // index. The last resort.
      //
      // Every configured master is tried, because pr-downloader only ever
      // searches the one it is given and games are spread across several. BAR
      // publishes its own (`repos-cdn.beyondallreason.dev`), so on the springrts
      // default every BAR game comes back as "no source could provide".
      case "rapid": {
        const rapidErrors: string[] = [];
        for (const master of DEFAULT_RAPID_MASTERS) {
          try {
            await dlDownloadRaw({
              tag: gameName,
              masterUrl: master.url,
              writePath,
              opId,
              onProgress,
            });
            return "rapid";
          } catch (e) {
            rapidErrors.push(`${master.name}: ${msg(e)}`);
          }
        }
        throw new Error(rapidErrors.join("; "));
      }
    }
  };

  const order = gameSourceOrder({
    hasGithubRepo: !!githubRepoForGame(repos, gameName),
    hasWritePath: !!writePath,
  });
  for (const source of order) {
    try {
      const result = await attempt(source);
      if (result) return result;
    } catch (e) {
      errors.push(`${source}: ${msg(e)}`);
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
