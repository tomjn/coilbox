import { useSyncExternalStore } from "react";
import { type DirectRoomStatus, directRoomStatus } from "./bindings";
import { ROOM_POLL_MS } from "./room";

/**
 * One reading of the room this client hosts, shared by everything that needs it.
 *
 * There were two polls of `direct_room_status`, one on the Battles page for the
 * running-room line and one in the battle room for the joins waiting on the
 * host. Both asked the same command for the same struct, and neither outlived
 * its page, so a host who walked away from both heard nothing about somebody
 * waiting at the door (issue #1600). One source outlives every page and is
 * polled once.
 *
 * Polled rather than subscribed to because the direct plugin emits no events.
 * The timer runs while there is a room to describe, and while the last reading
 * failed and this module cannot say whether there is one. Once a reading lands
 * saying there is no room, this is a module holding a null and no clock at all.
 *
 * A module singleton rather than a context, so the notification watcher and the
 * two pages read the same thing without every consumer having to sit under one
 * provider.
 */

let room: DirectRoomStatus | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<(room: DirectRoomStatus | null) => void>();

/**
 * The address the room was handing out before its current one, or null while it
 * has not moved.
 *
 * A room that works its own address out moves onto a new one by itself (issue
 * #2116), and the reading that carries the move is gone by the next tick. Held
 * here rather than in whatever is drawing it because a host is usually in their
 * battle room when a VPN comes up, and a component that was not mounted at the
 * time would have nothing to say when they came back.
 *
 * Only ever the previous reading, so it says the room moved and never claims to
 * know the address it started on. This client may not have been watching then.
 */
let movedFrom: string | null = null;

/**
 * Bumped by every deliberate write. A poll started before one lands describes a
 * room that has since been stopped or answered, so it is dropped rather than
 * allowed to put the old reading back for one more tick.
 */
let generation = 0;

/** Keep asking, on the cadence everything else here runs on. Does nothing when
 *  the clock is already running, so it is safe to call on every reading. */
function startClock(): void {
  if (timer) return;
  timer = setInterval(() => {
    void readHostedRoom();
  }, ROOM_POLL_MS);
}

function publish(next: DirectRoomStatus | null): void {
  if (!next) movedFrom = null;
  else if (room && room.ip !== next.ip) movedFrom = room.ip;
  room = next;
  if (room) startClock();
  if (!room && timer) {
    clearInterval(timer);
    timer = null;
  }
  for (const listener of listeners) listener(room);
}

/**
 * Ask the room what it holds, and publish the answer.
 *
 * Never throws: nothing that reads this can do anything about a failed IPC
 * call, and the next tick asks again.
 */
export async function readHostedRoom(): Promise<DirectRoomStatus | null> {
  const asked = generation;
  try {
    const { room: latest } = await directRoomStatus({});
    if (asked === generation) publish(latest);
  } catch {
    // A room that cannot be read is not a room that has gone. Leave the last
    // reading standing, and make sure there is a next tick to settle it: the
    // first reading of all is made once from a mount effect, so a failure there
    // used to leave a host running a room described nowhere for the rest of the
    // session, with nothing on screen to suggest restarting was the cure
    // (issue #2124). A reading a deliberate write has overtaken is not ours to
    // start a clock for, the same as one that succeeds.
    if (asked === generation) startClock();
  }
  return room;
}

/**
 * Say what the room is without asking it, for the two moments the caller knows
 * better than a poll: a room that has just started, and one that has just been
 * stopped or had a join answered.
 */
export function setHostedRoom(next: DirectRoomStatus | null): void {
  generation += 1;
  publish(next);
}

/**
 * Hear every reading, without rendering anything. What the notification watcher
 * uses: it has nothing to draw, and re-rendering the app every two seconds to
 * compare two lists of names would be a poor trade.
 */
export function subscribeHostedRoom(
  listener: (room: DirectRoomStatus | null) => void,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * The address the hosted room was handing out before its current one, or null
 * while it has not moved. See {@link movedFrom}.
 */
export function useRoomMovedFrom(): string | null {
  return useSyncExternalStore(
    (onChange) => subscribeHostedRoom(onChange),
    () => movedFrom,
    () => movedFrom,
  );
}

/** The room this client hosts, or null when it is not hosting. */
export function useHostedRoom(): DirectRoomStatus | null {
  return useSyncExternalStore(
    (onChange) => subscribeHostedRoom(onChange),
    () => room,
    // Nothing hosts a room during a server render, and the store is a module
    // variable either way.
    () => room,
  );
}
