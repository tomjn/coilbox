import { useEffect, useMemo, useState } from "react";
import {
  useBrandingCatalog,
  useGithubGameRepos,
  useSuggestedGames,
} from "../content/branding";
import { dlGithubReleaseArchives } from "../downloads/bindings";
import {
  GAME_REPOS,
  mergeGameRepos,
  resolveGithubRepo,
} from "../downloads/gameRepos";
import type { GameCatalog } from "./gameOffer";

/** Newest release archive per repo, kept for the session. A failed read is not
 *  kept, so the next mount asks again. */
const newestByRepo = new Map<string, string>();

/**
 * The lookup `resolveGameDownload` reads, with the newest GitHub release of
 * every suggested GitHub game fetched in the background. Until a release has
 * been read, the game it names has no download, so an offer appears when the
 * read lands and not before.
 */
export function useGameCatalog(): GameCatalog {
  const entries = useBrandingCatalog();
  const suggested = useSuggestedGames();
  const catalogRepos = useGithubGameRepos();
  const repos = useMemo(
    () => mergeGameRepos(catalogRepos, GAME_REPOS),
    [catalogRepos],
  );
  const [archives, setArchives] =
    useState<ReadonlyMap<string, string>>(newestByRepo);

  useEffect(() => {
    let cancelled = false;
    for (const s of suggested) {
      if (s.download.kind !== "github") continue;
      let repo: string;
      try {
        repo = resolveGithubRepo(repos, s.download);
      } catch {
        continue;
      }
      if (newestByRepo.has(repo)) continue;
      dlGithubReleaseArchives({ repo })
        .then(({ archives: found }) => {
          const newest = found[0]?.filename;
          if (!newest) return;
          newestByRepo.set(repo, newest);
          if (!cancelled) setArchives(new Map(newestByRepo));
        })
        .catch(() => {});
    }
    return () => {
      cancelled = true;
    };
  }, [suggested, repos]);

  return useMemo(
    () => ({
      entries,
      suggested,
      repos,
      newestArchive: (repo: string) => archives.get(repo),
    }),
    [entries, suggested, repos, archives],
  );
}
