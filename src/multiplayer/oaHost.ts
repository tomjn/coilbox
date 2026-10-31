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

/** The longest room password OA takes. It refuses a longer one and exits. */
export const OA_PASSWORD_MAX = 10;

/** What OA's status stream calls the screen of its battle room. */
export const OA_BATTLE_ROOM_SCREEN = "mp_battleroom";

/** What an OA port range carries. */
export type OaPortKind = "discovery" | "stream" | "datagram";

/** A run of ports OA's room listens on, `first` to `last` inclusive. */
export interface OaPortRange {
  kind: OaPortKind;
  transport: "tcp" | "udp";
  first: number;
  last: number;
}

/**
 * The ports an OA host forwards on their router: session discovery, stream
 * messages and datagrams. A joiner's connections are outbound, so only the host
 * needs these open (issue #4950). They are named and not opened through UPnP:
 * the ranges are over a hundred mappings, where a Recoil battle asks for one.
 */
export const OA_PORTS: readonly OaPortRange[] = [
  { kind: "discovery", transport: "udp", first: 47624, last: 47624 },
  { kind: "stream", transport: "tcp", first: 2300, last: 2400 },
  { kind: "datagram", transport: "udp", first: 2350, last: 2400 },
];

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

/** Whether OA would refuse this password, counted as the host form sends it. */
export function oaPasswordTooLong(typed: string): boolean {
  return [...typed.trim()].length > OA_PASSWORD_MAX;
}

/**
 * The arguments that start OA hosting this battle: its own room named after
 * the battle, with the host's size and the lobby battle's password. Not
 * `--dplay-guid` or `--dplay-port`, which are for a game found on the local
 * network.
 */
export function oaHostArguments({
  battleId,
  username,
  map,
  maxPlayers,
  password,
}: {
  battleId: number;
  username: string;
  map: string | null;
  maxPlayers: number;
  password: string | null;
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
  if (password) args.push("--game-password", password);
  return args;
}

/**
 * The arguments that start OA joining the room the host of this battle opened.
 * `hostIp` is the address the lobby gave for the battle, as it gave it.
 * `password` is the key the player typed to join. One OA would refuse cannot be
 * the room's password, as no OA room can have it, so it is left out.
 */
export function oaJoinArguments({
  battleId,
  username,
  hostIp,
  password,
}: {
  battleId: number;
  username: string;
  hostIp: string;
  password: string | null;
}): string[] {
  const args = [
    "--join",
    hostIp,
    "--player-name",
    oaPlayerName(username),
    "--game-name",
    oaGameName(battleId),
  ];
  if (password && !oaPasswordTooLong(password)) {
    args.push("--game-password", password);
  }
  return args;
}

/** Whether a battle is hosted on Open Annihilation, by the engine name it sends. */
export function isOaBattle(battle: Pick<Battle, "engine">): boolean {
  return (
    otherEngineName(battle)?.toLowerCase() === OA_ENGINE_NAME.toLowerCase()
  );
}
