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
 * The timer runs only while there is a room to describe: with none, this is a
 * module holding a null and no clock at all.
 *
 * A module singleton rather than a context, so the notification watcher and the
 * two pages read the same thing without every consumer having to sit under one
 * provider.
 */

let room: DirectRoomStatus | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<(room: DirectRoomStatus | null) => void>();

/**
 * Bumped by every deliberate write. A poll started before one lands describes a
 * room that has since been stopped or answered, so it is dropped rather than
 * allowed to put the old reading back for one more tick.
 */
let generation = 0;

function publish(next: DirectRoomStatus | null): void {
  room = next;
  if (room && !timer) {
    timer = setInterval(() => {
      void readHostedRoom();
    }, ROOM_POLL_MS);
  }
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
    // reading standing and let the next tick settle it.
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
