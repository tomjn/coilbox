import { MapPin } from "lucide-react";
import { useHostedRoom, useRoomMovedFrom } from "./hostedRoom";
import { roomMovedNotice } from "./room";

/**
 * Tells a host in their battle room that the room they are running has moved
 * onto a different address (issue #2122).
 *
 * Starting a room takes the host straight here and leaves them here while people
 * arrive and the game is set up. Since issue #2116 a room with no address of the
 * host's own choosing follows the machine, so a VPN coming up or a new lease
 * moves the address the room hands out, and until now the only place that was
 * said was the Battles page the host had already walked away from.
 *
 * # Why the move and not the whole line
 *
 * The Battles page draws the address whether or not it has changed, because a
 * host reading that page is reading about their room. Here they are reading
 * about a game. An address that has not changed is a fact they can go and look
 * up in one click, and drawing it permanently would put a line about a LAN room
 * on a page that is mostly battles on a server. The move is the half that
 * arrives without being asked for, and the sentence names the new address
 * anyway, so a host who needs the number gets it exactly when it matters.
 *
 * # Why this is not a notification
 *
 * Issue #2118 turned one down because a pending join is a question waiting on an
 * answer and a move is not, and because an ordinary Wi-Fi to Ethernet swap would
 * fire one while everything still works. That still holds, and there is a second
 * reason now: `movedFrom` is held for as long as the room runs, so this strip is
 * still here when a host who wandered off to Content comes back. A notification
 * would be an interruption to deliver something that was going to wait for them.
 *
 * # What it does not say
 *
 * Whether anybody can reach the new address. Nothing here knows that, the
 * reachability panel on the Battles page is what asks, and a strip that guessed
 * would be wrong on every harmless move.
 *
 * Muted rather than amber, unlike the strips around it. Those mean somebody is
 * blocked or something failed. A move is neither: most of them break nothing,
 * and a full-width strip under the header is hard to miss without being coloured
 * like a fault. `role="status"` for the reason issue #2118 made its line one,
 * which is that this arrives while the host is reading something else.
 *
 * Reads the shared room source directly rather than taking props, because there
 * is no action to wire up and nothing on this page to hand it down from. The
 * source is null unless this client is running a room, so a battle on a real
 * server draws nothing.
 */
export function RoomMovedPanel() {
  const room = useHostedRoom();
  const movedFrom = useRoomMovedFrom();
  if (!room || !movedFrom) return null;
  return (
    <p
      role="status"
      className="flex items-center gap-2 border-b border-border bg-muted/40 px-4 py-2 text-sm text-muted-foreground"
    >
      <MapPin className="size-4 shrink-0" />
      {roomMovedNotice(room.ip, movedFrom)}
    </p>
  );
}
