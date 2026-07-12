/**
 * Curated GitHub game sources: games distributed as `.sd7`/`.sdz` archives on a
 * repo's GitHub releases (not rapid or springfiles). Shared by the Downloads →
 * Games browse dropdown (keyed by `key`) and the battle auto-download fallback
 * (matched against a live game name by `nameKey`), so both agree on the list.
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

/** The `owner/name` repo for a source key, or undefined. */
export function repoForKey(key: string): string | undefined {
  return GAME_REPOS.find((g) => g.key === key)?.repo;
}

/** The curated GitHub repo whose game this name belongs to, or undefined. Matches
 * by normalised-name prefix so a versioned name (`Splinter Faction 0.1.72`) still
 * resolves. Sources with an empty `nameKey` are skipped. */
export function githubRepoForGame(gameName: string): string | undefined {
  const n = norm(gameName);
  return GAME_REPOS.find((g) => g.nameKey && n.startsWith(g.nameKey))?.repo;
}
