import type { OaMap } from "../play/bindings";
import { otherEngineName } from "./battles/battleFilters";
import type { Battle } from "./bindings";

/**
 * Hosting an Open Annihilation (OA) battle on a lobby server (issue #4946). The
 * lobby only advertises the battle. OA's own room does the rest, so everything
 * the host form and the battle room need to know about it is here.
 */

/** The engine name an OA host sends. `otherEngineName` reads it back. */
export const OA_ENGINE_NAME = "Open Annihilation";

/** The game name an OA host sends, since OA plays the original Total Annihilation. */
export const OA_MODNAME = "Total Annihilation";

/** The lobby's map field when the host has not picked one: OA's room decides. */
export const OA_UNPICKED_MAP = "Host chooses in OA";

/**
 * The value of the host form's engine choice that means OA. A version string
 * from an installed engine is never this.
 */
export const OA_ENGINE_CHOICE = "open-annihilation";

/**
 * Both content hashes of an OA battle. Nobody on the OA path reads them, but
 * uberserver refuses zero, so they are one fixed value every client agrees on.
 */
export const OA_HASH = 1;

/** OA's player limit, which is as large as a battle's max players may be. */
export const OA_MAX_PLAYERS = 10;

/** The longest player name OA takes. It refuses a longer one. */
export const OA_PLAYER_NAME_MAX = 16;

/** What OA's status stream calls the screen of its battle room. */
export const OA_BATTLE_ROOM_SCREEN = "mp_battleroom";

const TITLE_PREFIX = "[OA]";

/** The lobby title of an OA battle: the host's title marked as OA's. */
export function oaBattleTitle(title: string, fallback: string): string {
  return `${TITLE_PREFIX} ${title.trim() || fallback}`;
}

/** The lobby username cut to what OA takes, by characters rather than bytes. */
export function oaPlayerName(username: string): string {
  return [...username].slice(0, OA_PLAYER_NAME_MAX).join("");
}

/**
 * The name of the OA room that belongs to a lobby battle. A joiner passes it
 * too, so the right session is picked when several on the network answer.
 */
export function oaGameName(battleId: number): string {
  return `CB${battleId}`;
}

/**
 * The map `--map` takes for the lobby's map field, or null when the host
 * picked none. A name `maps` does not list is passed as it stands, because OA
 * reads the lobby's own word for it.
 */
export function oaMapArgument(
  lobbyMap: string,
  maps: readonly OaMap[],
): string | null {
  if (lobbyMap === OA_UNPICKED_MAP) return null;
  return maps.find((m) => m.shownName === lobbyMap)?.key ?? lobbyMap;
}

/**
 * The arguments that start OA hosting this battle: its own room named after
 * the battle, with the host's size. The password stays on the lobby: the room
 * does not know it, and OA is never given one. Not `--dplay-guid` or
 * `--dplay-port`, which are for a game found on the local network.
 */
export function oaHostArguments({
  battleId,
  username,
  map,
  maxPlayers,
}: {
  battleId: number;
  username: string;
  map: string | null;
  maxPlayers: number;
}): string[] {
  const args = [
    "--host",
    "--game-name",
    oaGameName(battleId),
    "--player-name",
    oaPlayerName(username),
    "--player-limit",
    String(Math.min(maxPlayers, OA_MAX_PLAYERS)),
  ];
  if (map) args.push("--map", map);
  return args;
}

/**
 * The arguments that start OA joining the room the host of this battle opened.
 * `hostIp` is the address the lobby gave for the battle, as it gave it.
 */
export function oaJoinArguments({
  battleId,
  username,
  hostIp,
}: {
  battleId: number;
  username: string;
  hostIp: string;
}): string[] {
  return [
    "--join",
    hostIp,
    "--player-name",
    oaPlayerName(username),
    "--game-name",
    oaGameName(battleId),
  ];
}

/** Whether a battle is hosted on Open Annihilation, by the engine name it sends. */
export function isOaBattle(battle: Pick<Battle, "engine">): boolean {
  return (
    otherEngineName(battle)?.toLowerCase() === OA_ENGINE_NAME.toLowerCase()
  );
}
