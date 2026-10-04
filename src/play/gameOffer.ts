import type { GameRef } from "../conquest/model";
import { resolveBranding, type SuggestedGame } from "../content/branding";
import type { ContentRequirement } from "../content/resolveContent";
import { type GameRepo, resolveGithubRepo } from "../downloads/gameRepos";
import { getGameMatcher } from "../profile/profile";
import { resolveGameByShortname } from "./installedGames";

/**
 * Turning the game a galaxy names into something the download queue can fetch
 * (issue #3368).
 *
 * A galaxy records a modinfo shortname and, only when its author pinned one, an
 * exact archive name. A shortname carries no version, and no source can fetch by
 * shortname: the queue's game download matches a GitHub release by exact
 * filename, a springfiles entry by name and rapid by tag. So the name comes from
 * the curated catalog (`catalog.json`), the one place coilbox keeps a
 * shortname's download:
 *
 * - a pinned build downloads by its exact name
 * - a catalog entry matching the shortname, with a suggested game, names a rapid
 *   tag or a GitHub repo whose newest release archive is the name
 * - anything else has no name, so nothing is offered
 */

export interface GameDownload {
  /** What the drawer calls the game. */
  label: string;
  /** The name the download queue fetches. */
  downloadKey: string;
}

/** What a shortname is looked up in. */
export interface GameCatalog {
  /** The branding entries, as `useBrandingCatalog` returns them. */
  entries: Parameters<typeof resolveBranding>[0];
  suggested: SuggestedGame[];
  /** The merged GitHub game-repo registry, to turn a source key into a repo. */
  repos: GameRepo[];
  /** The filename of a repo's newest release archive, or undefined when it has
   *  not been read, or the repo lists none. */
  newestArchive: (repo: string) => string | undefined;
}

const ARCHIVE_EXTENSION = /\.(sd7|sdz)$/i;

/** The download for a galaxy's game, or null when it cannot be named exactly. */
export function resolveGameDownload(
  game: GameRef,
  catalog: GameCatalog,
): GameDownload | null {
  if (game.pinnedName) {
    return { label: game.pinnedName, downloadKey: game.pinnedName };
  }
  const entry = resolveBranding(catalog.entries, {
    name: game.shortname,
    info: { shortname: game.shortname },
  });
  if (!entry) return null;
  const suggestion = catalog.suggested.find((s) => s.entryId === entry.id);
  if (!suggestion) return null;
  const dl = suggestion.download;
  if (dl.kind === "rapid") {
    return { label: suggestion.title, downloadKey: dl.tag };
  }
  if (dl.kind === "github") {
    let repo: string;
    try {
      repo = resolveGithubRepo(catalog.repos, dl);
    } catch {
      return null;
    }
    const archive = catalog.newestArchive(repo);
    if (!archive) return null;
    return {
      label: suggestion.title,
      downloadKey: archive.replace(ARCHIVE_EXTENSION, ""),
    };
  }
  return null;
}

const gameKey = (g: GameRef) =>
  `${g.shortname.trim().toLowerCase()}|${g.pinnedName ?? ""}`;

/** One entry per game, first one kept. */
export function distinctGames(games: GameRef[]): GameRef[] {
  const seen = new Set<string>();
  return games.filter((g) => {
    const key = gameKey(g);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** The distinct games a download can be named for, each with that download. */
export function offerableGames(
  games: GameRef[],
  catalog: GameCatalog,
): { game: GameRef; download: GameDownload }[] {
  const out: { game: GameRef; download: GameDownload }[] = [];
  for (const game of distinctGames(games)) {
    const download = resolveGameDownload(game, catalog);
    if (download) out.push({ game, download });
  }
  return out;
}

/**
 * The requirement the launch check takes for a galaxy's game. It is met by any
 * installed version of the shortname, which is how a battle later resolves the
 * game (`resolveGameByShortname`), and downloads by `download`.
 */
export function gameRequirement(
  game: GameRef,
  download?: GameDownload,
): ContentRequirement {
  return {
    kind: "game",
    label: download?.label ?? game.pinnedName ?? game.shortname,
    downloadKey: download?.downloadKey ?? game.shortname,
    isInstalled: (installed) => {
      const matcher = getGameMatcher();
      const games = installed.games.filter((g) => !matcher || matcher(g.name));
      return (
        resolveGameByShortname(
          game,
          games.map((g) => ({
            name: g.name,
            info: { shortname: g.shortname ?? "", version: g.version ?? "" },
          })),
        ) !== undefined
      );
    },
  };
}
