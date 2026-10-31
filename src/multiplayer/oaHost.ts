import type { OaMap } from "../play/bindings";

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
    `CB${battleId}`,
    "--player-name",
    oaPlayerName(username),
    "--player-limit",
    String(Math.min(maxPlayers, OA_MAX_PLAYERS)),
  ];
  if (map) args.push("--map", map);
  return args;
}
