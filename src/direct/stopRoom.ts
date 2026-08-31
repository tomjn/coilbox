import { directStopRoom } from "./bindings";
import { readHostedRoom, setHostedRoom } from "./hostedRoom";
import { directClosePorts } from "./reachability";
import { roomStopReason } from "./room";

/**
 * End the room this client hosts, from wherever the host asked for it.
 *
 * Two buttons ask: "Stop room" on the Battles page, and "Close battle" in the
 * battle room, which used to leave the battle and leave the room running behind
 * it (issue #2057). Both are the same four steps, and the one that matters most
 * is the one easiest to leave out of a second copy: the ports the room asked a
 * router for are handed back here and nowhere else.
 *
 * Throws when the room would not stop, having put a fresh reading back so the
 * room that is still there is still described. The caller says why in whatever
 * words fit where it is standing.
 */
export async function stopHostedRoom(
  /** The host's name, for the words the joiners are dropped with. */
  host: string,
  /** The store's disconnect. Our own client goes first and on purpose, so its
   *  drop is not read as a server that fell over and does not start a reconnect
   *  loop against a port that is about to close. */
  disconnect: () => Promise<void>,
): Promise<void> {
  const reason = roomStopReason(host);
  try {
    await disconnect();
    await directStopRoom({ reason });
  } catch (e) {
    // The room is still there, so let a fresh reading speak for it again.
    void readHostedRoom();
    throw e;
  }
  // The room is what wanted the ports open, so the room ending is what hands
  // them back. Leaving a mapping on somebody's router after the thing that asked
  // for it has gone is rude, and the hour-long lease only limits the damage when
  // this never runs, which is a host whose machine was killed.
  await directClosePorts({}).catch(() => {});
  setHostedRoom(null);
}
