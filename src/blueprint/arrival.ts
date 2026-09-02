/**
 * What a shared layout means on the machine it arrives at (issues #1439, #1444).
 *
 * A blueprint names units by their internal name, so it belongs to a game, and
 * the library it lands in holds layouts for every game at once. Taking one is
 * therefore always allowed and never silent: nothing here blocks an import, and
 * everything here is said before the layout is kept rather than discovered
 * afterwards, when the first sign of trouble would be a base full of buildings
 * that cannot be placed.
 *
 * The container carries one thing a game's own blueprint file does not: the game
 * it was exported for. That is what lets a mismatch be named. A layout out of
 * `LuaUI/Config/blueprints.json` can only be found not to fit this game
 * (`./units.ts`, issue #1436), while a shared one can say which game it is for
 * and whether you have it.
 *
 * A layout can also arrive somewhere narrower than the library: a mission, which
 * is for one game (issue #1327). That is the same question with a different
 * yardstick, so it is `into` on the input rather than a second set of sentences.
 *
 * Pure, and takes the answers rather than fetching them: the installed games and
 * the unit dataset are both React state on the surface that uses this.
 * Substitution stays out of scope and is
 * https://github.com/tomjn/coilbox/issues/1314. Nothing here changes a name.
 */

import type {
  GameIdentity,
  InstalledGameInfo,
} from "../container/gameIdentity";
import { uniqueLayoutName } from "./library";
import type { BlueprintPayload } from "./payload";
import {
  type KnownUnits,
  unknownBuildings,
  unknownUnitsWarning,
} from "./units";

/** Where the game a layout was drawn for stands with this machine. */
export type ArrivingGame =
  /** The layout names no game, so there is nothing to check it against. */
  | { state: "unnamed" }
  /** The installed games have not been read yet, so this is not an answer. */
  | { state: "unread"; wanted: string }
  /** The exact build it was exported for is here. */
  | { state: "installed"; here: string }
  /** A different build of the same game is here, matched by modinfo shortname. */
  | { state: "other-version"; wanted: string; here: string }
  /** Nothing on this machine is that game. */
  | { state: "missing"; wanted: string };

/** What to call the game a layout claims, preferring the build it pins over the
 *  shortname, because that is what a person would go and install. */
function claimed(game: GameIdentity): string {
  return game.name ?? game.shortname ?? "";
}

/**
 * Match a layout's game against this machine's, exactly first and then by
 * shortname.
 *
 * The shortname match is the useful half. A layout exported from last week's
 * build of a game pins that build's archive name, which nobody has any more, and
 * treating that as "you have not got this game" would be wrong about every
 * layout anybody shares of a game that updates weekly.
 *
 * `installed` is null while the content scan is still running, which is its own
 * answer: "not installed" and "not looked yet" read identically to a person and
 * only one of them is worth acting on.
 */
export function arrivingGame(
  game: GameIdentity | undefined,
  installed: readonly InstalledGameInfo[] | null,
): ArrivingGame {
  if (!game) return { state: "unnamed" };
  const wanted = claimed(game);
  if (!wanted) return { state: "unnamed" };
  if (!installed) return { state: "unread", wanted };

  const exact = installed.find((one) => one.name === wanted);
  if (exact) return { state: "installed", here: exact.name };

  const sameGame =
    game.shortname &&
    installed.find((one) => one.info?.shortname === game.shortname);
  if (sameGame) {
    return { state: "other-version", wanted, here: sameGame.name };
  }
  return { state: "missing", wanted };
}

/** The archive name whose units this layout should be checked against, or empty
 *  when there is nothing here to check it against. */
export function gameToCheckAgainst(game: ArrivingGame): string {
  return game.state === "installed" || game.state === "other-version"
    ? game.here
    : "";
}

/** How loudly one thing about an arriving layout needs saying. */
export type ArrivalTone = "note" | "warn";

export interface ArrivalNote {
  tone: ArrivalTone;
  text: string;
}

export interface BlueprintArrival {
  /** What the layout will be kept as. */
  name: string;
  /** The name it arrived with, when the library already had that one. */
  wasCalled?: string;
  game: ArrivingGame;
  /** Every building of it names a unit this game has not got, so taking it gets
   *  you a base you cannot place. Still allowed, and worth saying differently. */
  foreign: boolean;
  /** Worst first, so the reason not to take this is the first line read. */
  notes: ArrivalNote[];
}

export interface ArrivalInput {
  payload: BlueprintPayload;
  /** The names already where this is going, so a second "Opening solars" is
   *  kept as "Opening solars 2" rather than as a twin. */
  taken: Iterable<string>;
  /** This machine's games, or null while they are still being read. */
  installed: readonly InstalledGameInfo[] | null;
  /** The units of {@link gameToCheckAgainst}'s game, once they have been read.
   *  Absent means not checked, which is not the same as nothing being wrong. */
  known?: KnownUnits;
  /**
   * The archive name of the game a mission is for, when the layout is going
   * into that mission rather than into the library (issue #1327).
   *
   * The library holds every game's layouts at once, so what it wants to know is
   * whether this machine has the layout's game. A mission is for exactly one
   * game, so the question is a different one: a layout for another game is
   * wrong for this mission even when the machine has both installed, and "not
   * installed here" would be false about it.
   */
  into?: string;
}

/**
 * The one game a mission is for, as the list {@link arrivingGame} matches
 * against, so a layout is checked against the mission and not against
 * everything on the machine.
 *
 * Taken from the installed list where it is there, because that is where the
 * modinfo shortname is, and that shortname is what recognises a layout drawn
 * for last week's build of the mission's own game.
 */
function missionGame(
  into: string,
  installed: readonly InstalledGameInfo[] | null,
): readonly InstalledGameInfo[] {
  return [installed?.find((one) => one.name === into) ?? { name: into }];
}

/** What the person taking this layout needs to know before they take it. */
export function blueprintArrival(input: ArrivalInput): BlueprintArrival {
  const { payload, taken, installed, known, into } = input;
  const game = arrivingGame(
    payload.game,
    into === undefined ? installed : missionGame(into, installed),
  );
  const notes: ArrivalNote[] = [];

  const unknown = unknownBuildings(payload.buildings, known);
  const foreign =
    unknown.length > 0 && unknown.length >= payload.buildings.length;

  switch (game.state) {
    case "unnamed":
      notes.push({
        tone: "note",
        text: "This blueprint does not say which game it is for, so its unit names have not been checked against anything.",
      });
      break;
    case "unread":
      notes.push({
        tone: "note",
        text: `This blueprint is for ${game.wanted}. Coilbox is still reading your games, so it does not know yet whether you have it.`,
      });
      break;
    case "missing":
      notes.push({
        tone: "warn",
        text: into
          ? `This blueprint is for ${game.wanted}, and this mission is for ${into}.`
          : `This blueprint is for ${game.wanted}, which is not installed here. It will be kept exactly as it is, and its buildings can be checked once you have that game.`,
      });
      break;
    case "other-version":
      notes.push({
        tone: "note",
        text: `This blueprint is for ${game.wanted}. ${into ? `This mission is for ${game.here}` : `You have ${game.here}`}, which is the same game at another version, so a unit it names may have moved since.`,
      });
      break;
    case "installed":
      break;
  }

  // Only where there is a game here to have checked against. Saying "not
  // checked" about a game nobody has adds nothing to having just said nobody
  // has it.
  //
  // A mission is always something to check against, whatever game the layout
  // claims, because the mission's game is the yardstick and the units handed in
  // are its own. That is the difference that matters for a layout from another
  // game: the library can only say you have not got it, and a mission can say
  // which of its buildings will not be there.
  if (into ? into !== "" : gameToCheckAgainst(game) !== "") {
    const missing = unknownUnitsWarning(unknown, payload.buildings.length);
    if (missing) {
      notes.unshift({ tone: "warn", text: missing });
    } else if (!known) {
      notes.push({
        tone: "note",
        text: "Coilbox has not read that game's units yet, so this blueprint has not been checked against them.",
      });
    }
  }

  const name = uniqueLayoutName(payload.name, taken);
  const wasCalled = name === payload.name ? undefined : payload.name;
  if (wasCalled) {
    notes.push({
      tone: "note",
      text: `A blueprint ${into ? "in this scenario" : "in your library"} is already called "${wasCalled}", so this one is kept as "${name}".`,
    });
  }

  return {
    name,
    ...(wasCalled ? { wasCalled } : {}),
    game,
    foreign,
    notes,
  };
}
