import {
  compareGameVersions,
  type InstalledGame,
} from "../play/installedGames";

/**
 * One way of naming a game across the stores the career page reads. Each store
 * keys it differently:
 *
 * - Conquest unlocks: the shortname, lower case (`ba`).
 * - A galaxy and a Warpath run: a `GameRef`, a shortname plus an optional pinned
 *   archive name (`Balanced Annihilation V15.9.8`).
 * - A campaign: no game of its own. Each mission's setup names an archive.
 * - A replay record: the archive the match was played on, version and all.
 *
 * A game is identified by a lower case key. An installed game gives its
 * shortname (or its name without the version when it has none), so an archive
 * name and a shortname meet at the installed game. With no installed game to
 * go through, a name is cut back to what precedes its version and lower cased,
 * so the archives of one game still meet each other, and a shortname that
 * equals that name still meets them.
 */

/** The key and title a name or shortname resolves to. */
export interface GameId {
  key: string;
  title: string;
  /**
   * Whether an installed game stands behind it. `null` when the installed games
   * are not known, which is not the same as "none installed".
   */
  installed: boolean | null;
  /** How good the title is: an installed name, a name, a bare shortname. */
  rank: number;
}

export const UNKNOWN_GAME_KEY = "unknown";

const RANK_INSTALLED = 3;
const RANK_NAME = 2;
const RANK_SHORTNAME = 1;

/**
 * A word that is a version: `v2.58`, `0.1.78`, `V15.9.8-coilbox3do`,
 * `test-30018-d71d659`, or the unexpanded `$VERSION` a game in development
 * leaves in its name. A bare whole number is not one, so `Spring 1944` keeps
 * its year.
 */
const VERSION_WORD = /^(v\d|\d+\.\d|test-\d|\$version$)/i;

/**
 * The game's name without its version. Everything from the first word that
 * looks like a version is dropped, and a name with no such word is unchanged.
 * The first word is never dropped, so a name is never cut to nothing.
 */
export function stripVersion(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const at = words.findIndex((w, i) => i > 0 && VERSION_WORD.test(w));
  return (at === -1 ? words : words.slice(0, at)).join(" ");
}

interface InstalledEntry {
  key: string;
  base: string;
  baseLc: string;
  shortname: string;
  version: string;
}

function entryFor(game: InstalledGame): InstalledEntry {
  const version = (game.info.version ?? "").trim();
  const shortname = (game.info.shortname ?? "").trim().toLowerCase();
  const base =
    version && game.name.endsWith(version)
      ? game.name.slice(0, game.name.length - version.length).trim()
      : stripVersion(game.name);
  return {
    key: shortname || base.toLowerCase(),
    base,
    baseLc: base.toLowerCase(),
    shortname,
    version,
  };
}

export interface GameResolver {
  /** An archive name, such as a replay's `gameType` or a mission's `gameName`. */
  byName(name: string | undefined): GameId;
  /** A `GameRef`: a shortname, and the archive it was pinned to when it has one. */
  byShortname(shortname: string, pinnedName?: string): GameId;
}

/**
 * Build the resolver. `installed` is the games a content scan found, or `null`
 * when there is no answer (the scan failed or has not run), in which case
 * nothing is claimed about what is installed.
 */
export function createGameResolver(
  installed: readonly InstalledGame[] | null,
): GameResolver {
  const known = installed !== null;
  const exact = new Map<string, InstalledEntry>();
  const installedByShortname = new Map<string, InstalledEntry>();
  const byKey = new Map<string, InstalledEntry>();
  const entries: InstalledEntry[] = [];

  for (const game of installed ?? []) {
    const entry = entryFor(game);
    exact.set(game.name, entry);
    entries.push(entry);
    // Newest version names the game.
    const newest = byKey.get(entry.key);
    if (!newest || compareGameVersions(entry.version, newest.version) > 0) {
      byKey.set(entry.key, entry);
    }
    if (entry.shortname && !installedByShortname.has(entry.shortname)) {
      installedByShortname.set(entry.shortname, entry);
    }
  }
  // Longest base first, so "Balanced Annihilation Remix" wins over a game
  // called "Balanced Annihilation" when both are installed.
  entries.sort((a, b) => b.baseLc.length - a.baseLc.length);

  const fromInstalled = (entry: InstalledEntry): GameId => ({
    key: entry.key,
    title: (byKey.get(entry.key) ?? entry).base,
    installed: true,
    rank: RANK_INSTALLED,
  });

  const byName = (name: string | undefined): GameId => {
    const trimmed = (name ?? "").trim();
    if (!trimmed) {
      return {
        key: UNKNOWN_GAME_KEY,
        title: "Game not named",
        installed: null,
        rank: 0,
      };
    }
    const hit = exact.get(trimmed);
    if (hit) return fromInstalled(hit);

    const lc = trimmed.toLowerCase();
    for (const entry of entries) {
      if (!lc.startsWith(entry.baseLc)) continue;
      const rest = lc.slice(entry.baseLc.length);
      // A version, or nothing, follows. "Remix" after the base is another game.
      if (rest === "" || (rest[0] === " " && VERSION_WORD.test(rest.trim()))) {
        return fromInstalled(entry);
      }
    }
    const title = stripVersion(trimmed);
    return {
      key: title.toLowerCase(),
      title,
      installed: known ? false : null,
      rank: RANK_NAME,
    };
  };

  const byShortname = (shortname: string, pinnedName?: string): GameId => {
    const lc = shortname.trim().toLowerCase();
    const hit = installedByShortname.get(lc);
    if (hit) return fromInstalled(hit);
    if (pinnedName?.trim()) return byName(pinnedName);
    if (!lc) return byName(undefined);
    return {
      key: lc,
      title: shortname.trim(),
      installed: known ? false : null,
      rank: RANK_SHORTNAME,
    };
  };

  return { byName, byShortname };
}
