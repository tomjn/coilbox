import type { GameRef } from "../conquest/model";
import {
  normalizeGameIdentity,
  sameGameFamily,
  stripVersionSuffix,
} from "../content/resolveContent";

/**
 * Compare two game version strings segment-wise (numeric segments compare as
 * numbers, the rest lexically), so "1.10" > "1.9" and "test-26575" >
 * "test-9999". Returns <0, 0 or >0.
 */
export function compareGameVersions(a: string, b: string): number {
  const split = (v: string) => v.split(/(\d+)/).filter((s) => s !== "");
  const as = split(a);
  const bs = split(b);
  for (let i = 0; i < Math.max(as.length, bs.length); i++) {
    const x = as[i] ?? "";
    const y = bs[i] ?? "";
    if (x === y) continue;
    const xn = /^\d+$/.test(x);
    const yn = /^\d+$/.test(y);
    if (xn && yn) return Number(x) - Number(y);
    return x < y ? -1 : 1;
  }
  return 0;
}

/** The minimal shape of an installed game this helper needs (structural
 * subset of `GameItem` from content bindings, to keep this module pure).
 * `shortname` and `version` are read from modinfo metadata. */
export interface InstalledGame {
  name: string;
  info: Record<string, string>;
  /** Dependencies no installed archive satisfies. Absent reads as none known. */
  missingDependencies?: string[];
}

// A game with no modinfo shortname is referred to by its name, as the setup
// forms write it.
const shortnameOf = (g: InstalledGame) =>
  (g.info.shortname ?? g.name).trim().toLowerCase();

const newestFirst = <T extends InstalledGame>(a: T, b: T) =>
  compareGameVersions(b.info.version ?? "", a.info.version ?? "");

/**
 * The installed games a {@link GameRef} can mean, newest version first. A game
 * must share the ref's shortname. When the ref pins a name, it must also be the
 * same game as that name (`sameGameFamily`), so another archive that happens to
 * share the shortname, such as "Zero-K Benchmark v3" beside "Zero-K v1.14.10.1",
 * is never a version of it (issue #3465).
 */
export function candidateGames<T extends InstalledGame>(
  game: GameRef,
  installed: T[],
): T[] {
  const want = game.shortname.trim().toLowerCase();
  const pinned = game.pinnedName;
  return installed
    .filter(
      (g) =>
        shortnameOf(g) === want && (!pinned || sameGameFamily(g.name, pinned)),
    )
    .sort(newestFirst);
}

/**
 * Resolve a {@link GameRef} against the installed games, for display and for
 * reading a game's data. An exact `pinnedName` match wins, then the newest
 * installed version of the same game. A ref with no pinned name does not say
 * which game it means, so when the candidates are different games this returns
 * `undefined` rather than guess. Launching goes through {@link decideLaunchGame}.
 */
export function resolveGameByShortname<T extends InstalledGame>(
  game: GameRef,
  installed: T[],
): T | undefined {
  if (game.pinnedName) {
    const pinned = installed.find((g) => g.name === game.pinnedName);
    if (pinned) return pinned;
  }
  const candidates = candidateGames(game, installed);
  if (!game.pinnedName) {
    const families = new Set(
      candidates.map((g) => normalizeGameIdentity(stripVersionSuffix(g.name))),
    );
    if (families.size > 1) return undefined;
  }
  return candidates[0];
}

/** What a battle does about the game its run or galaxy names. */
export type LaunchGameDecision<T extends InstalledGame> =
  /** Launch `game`. `pin` is set when the run named no game and exactly one
   *  was installed, so the caller stores that name. */
  | { kind: "ready"; game: T; pin?: string }
  /** The run names no game and several could be meant. Ask, newest first. */
  | { kind: "choose"; candidates: T[] }
  /** The pinned game is gone but another version of it is installed. */
  | { kind: "continue"; pinnedName: string; newer: T }
  /** The pinned game is installed and a newer version of it has appeared. */
  | { kind: "upgrade"; current: T; newer: T }
  /** Nothing installed matches. `name` is what the gate says is missing. */
  | { kind: "missing"; name: string };

/**
 * Which installed game a battle launches, without ever changing the game a run
 * uses unasked (issue #3465). Only a pinned name that is installed, or the sole
 * candidate of an unpinned run, launches straight away. `declinedUpdate` is the
 * newer version the player already said no to.
 */
export function decideLaunchGame<T extends InstalledGame>(
  game: GameRef,
  installed: T[],
  declinedUpdate?: string,
): LaunchGameDecision<T> {
  const candidates = candidateGames(game, installed);
  if (game.pinnedName) {
    const current = installed.find((g) => g.name === game.pinnedName);
    if (current) {
      const newer = candidates.find(
        (g) =>
          g.name !== current.name &&
          compareGameVersions(
            g.info.version ?? "",
            current.info.version ?? "",
          ) > 0,
      );
      return newer && newer.name !== declinedUpdate
        ? { kind: "upgrade", current, newer }
        : { kind: "ready", game: current };
    }
    return candidates.length > 0
      ? { kind: "continue", pinnedName: game.pinnedName, newer: candidates[0] }
      : { kind: "missing", name: game.pinnedName };
  }
  if (candidates.length === 0) return { kind: "missing", name: game.shortname };
  if (candidates.length === 1) {
    return { kind: "ready", game: candidates[0], pin: candidates[0].name };
  }
  return { kind: "choose", candidates };
}

/** A question the player answers before a battle can launch, about which
 * installed game the run uses (issue #3465). */
export type GameOffer<T extends InstalledGame = InstalledGame> = Extract<
  LaunchGameDecision<T>,
  { kind: "choose" | "continue" | "upgrade" }
>;

/** What the player answered, for the caller to store on the run. */
export interface GameChoice {
  /** The full name of the game the run now uses. */
  pinnedName?: string;
  /** The newer version the player said no to, so it is not offered again. */
  declinedUpdate?: string;
}
