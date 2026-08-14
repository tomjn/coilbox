import { buildJoinLink, buildRoomLink } from "@/deeplink/build";
import { splitHostPort } from "./lan";
import { LOOPBACK_HOST } from "./room";

/**
 * The link that gets somebody else into the battle this client is in, or null
 * when there is none worth handing out. Pure.
 *
 * A server and a room are passed on differently, and the wrong one is worse than
 * none. A `join` link only acts for a recipient already connected to the server
 * it names, which on a room is nobody: a room is one machine holding one battle,
 * and the recipient has never dialled it, so they are told they are not
 * connected and that is the end of it (issue #1617).
 *
 * A room is therefore passed on as the address to dial, which is what
 * `coilbox://room` carries. The address used is the one this client is connected
 * on, and for a joiner that is the whole of what they know: they typed it or
 * took it off a beacon, and it reached the room from where they are, so it
 * reaches it for somebody standing beside them.
 *
 * A host's own connection is the exception, because it is over loopback and
 * reaches nobody else. It gets no link here at all. The addresses worth giving
 * out are on the host's own room line, which offers every one of them rather
 * than guessing at which the joiner is behind (issue #1615).
 */
export function inviteLink(
  /** The `host:port` this client is connected on. */
  address: string | null | undefined,
  /** Whether that is a room somebody is hosting rather than a lobby server. */
  room: boolean,
  /** The battle to join, which only a server needs: a room holds exactly one. */
  battleId: string,
): string | null {
  if (!address) return null;
  if (!room) return buildJoinLink(address, battleId);
  const dialled = splitHostPort(address);
  if (!dialled.port || dialled.address === LOOPBACK_HOST) return null;
  return buildRoomLink(dialled.address, Number(dialled.port));
}
