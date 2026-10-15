import {
  loadRecoilEngines,
  loadSpringfilesEngines,
} from "../downloads/engineLists";
import {
  GAME_REPOS,
  mergeGameRepos,
  resolveGithubRepo,
} from "../downloads/gameRepos";
import { loadGithubReleases } from "../downloads/githubReleases";
import {
  loadEvolutionRtsMaps,
  loadHakoraMaps,
  loadSpringfilesList,
} from "../downloads/mirrorIndex";
import { loadHubGames } from "../hub/gameIcons";
import { isProfileHidden } from "../profile/hidden";
import { loadGithubGameRepos, loadSuggestedGames } from "./branding";

/** The newest release of every GitHub game `useGameCatalog` asks about. */
async function warmGameReleases(): Promise<void> {
  const [suggested, catalogRepos] = await Promise.all([
    loadSuggestedGames(),
    loadGithubGameRepos(),
  ]);
  const repos = mergeGameRepos(catalogRepos, GAME_REPOS);
  for (const s of suggested) {
    if (s.download.kind !== "github") continue;
    let repo: string;
    try {
      repo = resolveGithubRepo(repos, s.download);
    } catch {
      continue;
    }
    await settle(() => loadGithubReleases(repo));
  }
}

/** Run one fetch and drop its failure. The screen that needs it asks again. */
async function settle(fetch: () => Promise<unknown>): Promise<void> {
  try {
    await fetch();
  } catch {
    // Silent on purpose. The cache modules do not keep a rejection.
  }
}

/**
 * Fetch the lists the download and hub screens show, one after another, so each
 * screen finds its list held or joins the request already running. Nothing here
 * reads the keychain or the hub account.
 *
 * `hubUrl` is the trusted hub, or null when the profile hides the hub. A failure
 * of any fetch is dropped and does not stop the rest.
 */
export async function fetchListsInBackground({
  enabled,
  hubUrl,
}: {
  enabled: boolean;
  hubUrl: string | null;
}): Promise<void> {
  if (!enabled) return;
  const fetches: Array<() => Promise<unknown>> = [
    () => loadSpringfilesList("map"),
    () => loadHakoraMaps(),
    () => loadEvolutionRtsMaps(),
    () => loadRecoilEngines(),
    () => loadSpringfilesEngines(),
    warmGameReleases,
  ];
  if (!isProfileHidden("downloads.games")) {
    fetches.push(() => loadSpringfilesList("game"));
  }
  if (hubUrl) fetches.push(() => loadHubGames(hubUrl, false));
  for (const fetch of fetches) await settle(fetch);
}
