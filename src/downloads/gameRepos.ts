/**
 * Curated GitHub game sources: games distributed as `.sd7`/`.sdz` archives on a
 * repo's GitHub releases (not rapid or springfiles). Shared by the Downloads →
 * Games browse dropdown (keyed by `key`) and the battle auto-download fallback
 * (matched against a live game name by `nameKey`), so both agree on the list.
 *
 * Unified registry (issue #512). The branding catalog's `githubGameRepos` field
 * is now the live, updatable-without-a-build source of truth, read via
 * `useGithubGameRepos`/`loadGithubGameRepos` in `content/branding.ts`. The
 * `GAME_REPOS` constant below is the in-code fallback seed, used before the
 * catalog has loaded and for any key the catalog hasn't (yet) migrated.
 * `mergeGameRepos` combines the two. Every lookup function here takes the
 * resolved list as a parameter rather than reading `GAME_REPOS` directly, so it
 * stays pure and testable independent of where the list came from.
 */

/** Loose key for matching a game name to a curated entry: lowercased, extension
 * and separators stripped. Shared with `downloadGame.ts`'s source matching. */
export const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/\.(sd7|sdz)$/, "")
    .replace(/[\s_]+/g, "");

export interface GameRepo {
  /** Stable source id — the Downloads browse dropdown value. */
  key: string;
  /** Human label for the dropdown. */
  label: string;
  /** `owner/name` for `dlGithubReleaseArchives`. */
  repo: string;
  /** Normalised game-name prefix for auto-download matching (see {@link norm}).
   * Empty disables auto-download matching for this source (browse-only). */
  nameKey: string;
}

export const GAME_REPOS: GameRepo[] = [
  {
    key: "metal-factions",
    label: "Metal Factions",
    repo: "springraaar/metal_factions",
    nameKey: "metalfactions",
  },
  {
    key: "evolution-rts",
    label: "Evolution RTS",
    repo: "EvolutionRTS/Evolution-RTS",
    nameKey: "evolutionrts",
  },
  // Ambiguous game name; keep it browse-only rather than risk a false match.
  { key: "tap", label: "TAP", repo: "FluidPlay/TAP", nameKey: "" },
  {
    key: "balanced-annihilation",
    label: "Balanced Annihilation",
    repo: "Balanced-Annihilation/Balanced-Annihilation",
    nameKey: "balancedannihilation",
  },
  {
    key: "splinterfaction",
    label: "SplinterFaction",
    repo: "SplinterFaction/SplinterFaction",
    nameKey: "splinterfaction",
  },
];

/** The `owner/name` repo for a source key in `repos`, or undefined. */
export function repoForKey(repos: GameRepo[], key: string): string | undefined {
  return repos.find((g) => g.key === key)?.repo;
}

/**
 * Resolve a `github`-kind suggested download to a concrete `owner/name` repo: a
 * direct `repo` wins, else it's looked up in `repos` by `sourceKey`. Throws a
 * clear error instead of ever returning undefined, so a caller can pass the
 * result straight to `dlGithubReleaseArchives` without an invalid-args failure.
 */
export function resolveGithubRepo(
  repos: GameRepo[],
  dl: { repo?: string; sourceKey?: string },
): string {
  const repo = dl.repo ?? repoForKey(repos, dl.sourceKey ?? "");
  if (!repo) {
    throw new Error(
      `No GitHub repo declared for source "${dl.sourceKey ?? ""}".`,
    );
  }
  return repo;
}

/** The curated GitHub repo in `repos` whose game this name belongs to, or
 * undefined. Matches by normalised-name prefix so a versioned name (`Splinter
 * Faction 0.1.72`) still resolves. Sources with an empty `nameKey` are skipped. */
export function githubRepoForGame(
  repos: GameRepo[],
  gameName: string,
): string | undefined {
  const n = norm(gameName);
  return repos.find((g) => g.nameKey && n.startsWith(g.nameKey))?.repo;
}

/**
 * Merge the catalog's GitHub game-repo registry with the in-code fallback seed,
 * catalog entries first, deduped by `key` (first occurrence wins), mirroring
 * `mapLists.ts`'s `mergeMapLists`. A catalog update can thus override a seed
 * entry by reusing its key (e.g. a repo rename), and a game not yet migrated to
 * the catalog still resolves from the fallback rather than disappearing.
 */
export function mergeGameRepos(
  catalog: GameRepo[],
  fallback: GameRepo[],
): GameRepo[] {
  const seen = new Set<string>();
  const out: GameRepo[] = [];
  for (const g of [...catalog, ...fallback]) {
    if (seen.has(g.key)) continue;
    seen.add(g.key);
    out.push(g);
  }
  return out;
}
