import { useEffect, useMemo, useState } from "react";
import {
  useBrandingCatalog,
  useGithubGameRepos,
  useSuggestedGames,
} from "../content/branding";
import {
  GAME_REPOS,
  mergeGameRepos,
  resolveGithubRepo,
} from "../downloads/gameRepos";
import {
  heldGithubReleases,
  loadGithubReleases,
} from "../downloads/githubReleases";
import type { GameCatalog } from "./gameOffer";

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
  const [archives, setArchives] = useState<ReadonlyMap<string, string>>(
    new Map(),
  );

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
      loadGithubReleases(repo)
        .then((found) => {
          const newest = found[0]?.filename;
          if (!newest || cancelled) return;
          setArchives((prev) => new Map(prev).set(repo, newest));
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
      newestArchive: (repo: string) =>
        archives.get(repo) ?? heldGithubReleases(repo)?.[0]?.filename,
    }),
    [entries, suggested, repos, archives],
  );
}
