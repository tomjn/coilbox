/**
 * Which game a unit is for, and whether two things are for the same game
 * (issue #3257).
 *
 * The game maker chooses it, and "No game" is a choice of its own: a unit of
 * parts needs no game, so nothing here treats it as unfinished. Every feature
 * that reads the game's own content asks {@link unitGame}, so the answer is the
 * same in every panel.
 *
 * Two units are for the same game when their games share a short name, the
 * modinfo name that stays put across versions, so 0.1.86 and 0.1.89 are one
 * game. A mutator counts as the game it builds on, so a mutator's record keeps
 * that game as `base` and the comparison uses it. A game whose modinfo has no
 * short name falls back to its exact archive, and so does an old record whose
 * short name was never read on this machine.
 */

import type { GameItem } from "@/content/bindings";
import { carriedShortname, rememberedShortname } from "../container/shortnames";
import { parkedPieces } from "./loadouts";
import type { LegoGameRef, LegoProject, LegoUnitGame } from "./model";

/** Enough of a game to compare it: a record, or an old import's game. */
export type GameLike = Pick<LegoGameRef, "name" | "archive"> &
  Partial<Pick<LegoUnitGame, "shortname" | "base">>;

/**
 * The game a unit is for, or null for no game.
 *
 * A unit saved before the choice existed has no `game`. One opened from a game
 * is that game's, as it always was. One built from parts is for no game. The
 * folder a unit was exported into does not count: it says where the files went,
 * and a loose `.sdd` can take any unit.
 */
export function unitGame(project: LegoProject): LegoUnitGame | null {
  if (project.game === null) return null;
  if (project.game) return project.game;
  const imported = project.imported?.game;
  return imported ? { name: imported.name, archive: imported.archive } : null;
}

function same(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

function ref(game: GameItem): LegoGameRef {
  const shortname = game.info?.shortname?.trim();
  const version = game.info?.version?.trim();
  return {
    name: game.name,
    archive: game.primaryArchive.name,
    ...(shortname ? { shortname } : {}),
    ...(version ? { version } : {}),
  };
}

/** The installed games a game depends on, in the order it names them. */
function gameDependencies(
  game: GameItem,
  installed: readonly GameItem[],
): GameItem[] {
  return (game.dependencyArchives ?? []).flatMap((dep) => {
    const found = installed.find(
      (other) => other !== game && same(other.primaryArchive.name, dep.name),
    );
    return found ? [found] : [];
  });
}

/**
 * The game a mutator builds on, or null when `game` is not a mutator.
 *
 * A mutator's modinfo depends on its base game, so the base is the installed
 * game it depends on. A mutator of a mutator is followed down to the game that
 * depends on no other game. An archive seen twice stops the walk.
 */
export function baseGameOf(
  game: GameItem,
  installed: readonly GameItem[],
): GameItem | null {
  const seen = new Set([game.primaryArchive.name.toLowerCase()]);
  let current = game;
  for (;;) {
    const next = gameDependencies(current, installed).find(
      (dep) => !seen.has(dep.primaryArchive.name.toLowerCase()),
    );
    if (!next) break;
    seen.add(next.primaryArchive.name.toLowerCase());
    current = next;
  }
  return current === game ? null : current;
}

/** What a unit records when the game maker chooses `game`. */
export function gameRecordFor(
  game: GameItem,
  installed: readonly GameItem[],
): LegoUnitGame {
  const base = baseGameOf(game, installed);
  return base ? { ...ref(game), base: ref(base) } : ref(game);
}

/** One game's own key, ignoring any game it builds on. */
function ownKey(game: Pick<LegoGameRef, "name" | "archive" | "shortname">) {
  const shortname =
    game.shortname ||
    rememberedShortname(game.name) ||
    carriedShortname(game.name);
  return shortname
    ? `short:${shortname.toLowerCase()}`
    : `archive:${game.archive.toLowerCase()}`;
}

/**
 * The key two games share when they are the same game. A record made before
 * this existed has no short name and no base, so the installed game with its
 * archive answers for it when there is one.
 */
export function gameKey(
  game: GameLike,
  installed: readonly GameItem[] = [],
): string {
  if (!game.shortname && !game.base) {
    const found = installed.find((g) =>
      same(g.primaryArchive.name, game.archive),
    );
    if (found) return gameKey(gameRecordFor(found, installed));
  }
  return ownKey(game.base ?? game);
}

/** Whether two games are the same game. No game is never any game. */
export function sameGame(
  a: GameLike | null | undefined,
  b: GameLike | null | undefined,
  installed: readonly GameItem[] = [],
): boolean {
  if (!a || !b) return false;
  return gameKey(a, installed) === gameKey(b, installed);
}

/**
 * The installed game to read for a unit's game: the exact build when it is
 * installed, else the newest installed version of the same game. A mutator of
 * it is only used when the game itself is not installed, since the mutator
 * changes what the game's own files say.
 */
export function installedGameFor(
  game: GameLike | null | undefined,
  installed: readonly GameItem[],
): GameItem | undefined {
  if (!game) return undefined;
  const exact = installed.find((g) =>
    same(g.primaryArchive.name, game.archive),
  );
  if (exact) return exact;
  const key = gameKey(game, installed);
  const family = installed.filter(
    (g) => gameKey(gameRecordFor(g, installed)) === key,
  );
  const plain = family.filter((g) => !baseGameOf(g, installed));
  const newest = (games: GameItem[]) =>
    [...games].sort((a, b) =>
      b.name.localeCompare(a.name, undefined, { numeric: true }),
    )[0];
  return newest(plain) ?? newest(family);
}

/**
 * The pieces in a unit that came out of its game: every mesh of a unit opened
 * from a game, and any piece lifted off one of the game's units (#3262), in
 * every loadout and not only the one on screen.
 */
export function liftedPieces(project: LegoProject): string[] {
  const opened = Boolean(project.imported?.game);
  return [...project.pieces, ...parkedPieces(project)]
    .filter((piece) => piece.lifted || (opened && piece.meshId))
    .map((piece) => piece.name);
}

/**
 * Why a unit cannot move to `next`, or null when it can.
 *
 * Another version of the same game is always fine. Any other change, "No game"
 * included, has to wait until the pieces from the current game are gone.
 */
export function gameChangeRefusal(
  project: LegoProject,
  next: LegoUnitGame | null,
  installed: readonly GameItem[] = [],
): string | null {
  const current = unitGame(project);
  if (!current || sameGame(current, next, installed)) return null;
  const lifted = liftedPieces(project);
  if (lifted.length === 0) return null;
  return `Remove the pieces from ${current.name} first: ${lifted.join(", ")}.`;
}

/**
 * Why a piece from `from` cannot go into this unit, or null when it can. A
 * piece that records no game is refused, so dropping the record cannot make a
 * piece that goes anywhere.
 */
export function liftRefusal(
  project: LegoProject,
  from: GameLike | null | undefined,
  installed: readonly GameItem[] = [],
): string | null {
  const own = unitGame(project);
  if (!own) return "This unit is for no game. Choose a game first.";
  if (!from) return "This piece does not say which game it is from.";
  if (sameGame(own, from, installed)) return null;
  return `This piece is from ${from.name}. This unit is for ${own.name}.`;
}
