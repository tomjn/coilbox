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

/**
 * `name` without a trailing `version`, with or without the `v` either one puts
 * before it, and without the space, `_` or `-` that joined them, so
 * `UltimateAI_GEOFlip_5.5` at `v5.5` is `UltimateAI_GEOFlip`. Null when the
 * name does not end in the version, or is nothing but the version.
 */
function cutVersion(name: string, version: string): string | null {
  const bare = version.replace(/^v(?=\d)/i, "").toLowerCase();
  if (!bare || !name.toLowerCase().endsWith(bare)) return null;
  const cut = name
    .slice(0, name.length - bare.length)
    .replace(/(^|[\s_-])v$/i, "$1")
    .replace(/[\s_-]+$/, "");
  return cut || null;
}

function entryFor(game: InstalledGame): Omit<InstalledEntry, "key"> {
  const version = (game.info.version ?? "").trim();
  const rawShortname = (game.info.shortname ?? "").trim().toLowerCase();
  // A shortname that carries the release after a separator, as some small
  // games' do, is still the same game's. One without a separator is left
  // alone, so `s44` at version 4 stays `s44`.
  const cutShort = cutVersion(rawShortname, version);
  const shortname =
    cutShort && /^[\s_-]/.test(rawShortname.slice(cutShort.length))
      ? cutShort
      : rawShortname;
  const base = cutVersion(game.name.trim(), version) ?? stripVersion(game.name);
  return { base, baseLc: base.toLowerCase(), shortname, version };
}

/**
 * The key for each entry: its shortname, or its name without the version when
 * it has none. Games that share a shortname but not a name are told apart.
 * Zero-K Benchmark ships as `ZK` like Zero-K. The shortest name keeps the bare
 * shortname, as the game the others are built on, and each other name gets the
 * shortname plus its own.
 */
function keyEntries(
  entries: readonly Omit<InstalledEntry, "key">[],
): InstalledEntry[] {
  const primary = new Map<string, string>();
  for (const e of entries) {
    if (!e.shortname) continue;
    const have = primary.get(e.shortname);
    if (have === undefined || e.baseLc.length < have.length) {
      primary.set(e.shortname, e.baseLc);
    }
  }
  return entries.map((e) => ({
    ...e,
    key: !e.shortname
      ? e.baseLc
      : primary.get(e.shortname) === e.baseLc
        ? e.shortname
        : `${e.shortname}:${e.baseLc}`,
  }));
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

  const games = installed ?? [];
  const keyed = keyEntries(games.map(entryFor));
  games.forEach((game, i) => {
    const entry = keyed[i];
    exact.set(game.name, entry);
    entries.push(entry);
    // Newest version names the game.
    const newest = byKey.get(entry.key);
    if (!newest || compareGameVersions(entry.version, newest.version) > 0) {
      byKey.set(entry.key, entry);
    }
    // A bare shortname means the game that keeps it, not one built on it.
    if (entry.key === entry.shortname && !installedByShortname.has(entry.key)) {
      installedByShortname.set(entry.key, entry);
    }
  });
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
