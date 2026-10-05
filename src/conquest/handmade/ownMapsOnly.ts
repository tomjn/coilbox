import {
  type InstalledGame,
  resolveGameByShortname,
} from "../../play/installedGames";
import { getProfile } from "../../profile/profile";
import type { HandmadeMapList, HandmadeMapSummary } from "./library";

/**
 * Whether the profile asks for hand-made maps only. Only a literal `true`
 * counts, so a wrong value in `profile.json` leaves the generated styles on.
 */
export function profileOnlyOwnMaps(): boolean {
  return getProfile().onlyOwnMaps === true;
}

/**
 * Whether a game is offered only its own maps, so the generated styles are
 * hidden for it. The one place the game archive flag and the profile switch
 * are combined: either is enough, and the profile switch covers every game.
 *
 * `maps` are the hand-made maps this game can be played on in the form that
 * asks. With none, the generated styles stay whatever the flags say, so the
 * player always has something to pick.
 */
export function hidesGeneratedStyles(
  game: { name: string },
  maps: readonly unknown[],
  list: Pick<HandmadeMapList, "onlyOwnMaps">,
  profileOnly: boolean,
): boolean {
  if (maps.length === 0) return false;
  return profileOnly || list.onlyOwnMaps.includes(game.name);
}

/** The hand-made maps made for a game, from any source. */
export function mapsForGame(
  game: InstalledGame,
  maps: readonly HandmadeMapSummary[],
): HandmadeMapSummary[] {
  return maps.filter((m) => resolveGameByShortname(m.game, [game]) === game);
}

/** The names of the games, out of `games`, that hide the generated styles. */
export function gamesHidingGeneratedStyles<G extends InstalledGame>(
  games: readonly G[],
  list: Pick<HandmadeMapList, "maps" | "onlyOwnMaps">,
  profileOnly: boolean,
): string[] {
  return games
    .filter((g) =>
      hidesGeneratedStyles(g, mapsForGame(g, list.maps), list, profileOnly),
    )
    .map((g) => g.name);
}
