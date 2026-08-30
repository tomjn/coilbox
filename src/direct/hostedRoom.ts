import { useSyncExternalStore } from "react";
import { type DirectRoomStatus, directRoomStatus } from "./bindings";
import { hotCarrier } from "./hotCarrier";
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

/** Everything this module remembers. See {@link state}. */
interface HostedRoom {
  /** The room this client hosts, or null when it is not hosting. */
  room: DirectRoomStatus | null;
  /** The poll, while there is a reason to be asking. */
  timer: ReturnType<typeof setInterval> | null;
  /**
   * The address the room was handing out before its current one, or null while
   * it has not moved.
   *
   * A room that works its own address out moves onto a new one by itself (issue
   * #2116), and the reading that carries the move is gone by the next tick. Held
   * here rather than in whatever is drawing it because a host is usually in
   * their battle room when a VPN comes up, and a component that was not mounted
   * at the time would have nothing to say when they came back.
   *
   * Only ever the previous reading, so it says the room moved and never claims
   * to know the address it started on. This client may not have been watching
   * then.
   */
  movedFrom: string | null;
  /**
   * Bumped by every deliberate write. A poll started before one lands describes
   * a room that has since been stopped or answered, so it is dropped rather than
   * allowed to put the old reading back for one more tick.
   */
  generation: number;
  /** Everybody listening for a reading. */
  listeners: Set<(room: DirectRoomStatus | null) => void>;
}

/**
 * One object rather than five module variables, so that a development-only copy
 * of this module inherits what the copy before it knew.
 *
 * In a build there is one copy of this module and this is an ordinary singleton.
 * Under the dev server, editing anything this module imports makes Vite build a
 * fresh copy and hand it to the components, which React Refresh re-renders. The
 * only thing that asks for a first reading is a mount effect with an empty
 * dependency list, and a hot update does not re-run it, so the fresh copy sat on
 * a null with no clock: a host watched their running room turn back into a "Host
 * on LAN" button and stay that way until they reloaded the window, while the
 * copy being replaced kept polling for the rest of the session (issue #2126).
 *
 * Sharing the object rather than copying its fields out means the replacement
 * has nothing to reconstruct and nothing can be missed when a field is added.
 * The listeners come with it, which matters because the notification watcher
 * subscribes from that same effect and would otherwise go deaf.
 */
const carried = hotCarrier?.hostedRoom as HostedRoom | undefined;
const state: HostedRoom = carried ?? {
  room: null,
  timer: null,
  movedFrom: null,
  generation: 0,
  listeners: new Set(),
};
if (hotCarrier) hotCarrier.hostedRoom = state;

/** Keep asking, on the cadence everything else here runs on. Does nothing when
 *  the clock is already running, so it is safe to call on every reading. */
function startClock(): void {
  if (state.timer) return;
  state.timer = setInterval(() => {
    void readHostedRoom();
  }, ROOM_POLL_MS);
}

// Take the clock off the copy this one replaces. Its callback is this file as it
// was before the edit, so leaving it would mean editing the poll and watching
// the old poll carry on. The carrier is the guard rather than the timer because
// it is the one a build can see through: with no carrier this whole statement is
// dropped, and nothing about hot updates reaches a release.
if (hotCarrier && state.timer) {
  clearInterval(state.timer);
  state.timer = null;
  startClock();
}

function publish(next: DirectRoomStatus | null): void {
  if (!next) state.movedFrom = null;
  else if (state.room && state.room.ip !== next.ip)
    state.movedFrom = state.room.ip;
  state.room = next;
  if (state.room) startClock();
  if (!state.room && state.timer) {
    clearInterval(state.timer);
    state.timer = null;
  }
  for (const listener of state.listeners) listener(state.room);
}

/**
 * Ask the room what it holds, and publish the answer.
 *
 * Never throws: nothing that reads this can do anything about a failed IPC
 * call, and the next tick asks again.
 */
export async function readHostedRoom(): Promise<DirectRoomStatus | null> {
  const asked = state.generation;
  try {
    const { room: latest } = await directRoomStatus({});
    if (asked === state.generation) publish(latest);
  } catch {
    // A room that cannot be read is not a room that has gone. Leave the last
    // reading standing, and make sure there is a next tick to settle it: the
    // first reading of all is made once from a mount effect, so a failure there
    // used to leave a host running a room described nowhere for the rest of the
    // session, with nothing on screen to suggest restarting was the cure
    // (issue #2124). A reading a deliberate write has overtaken is not ours to
    // start a clock for, the same as one that succeeds.
    if (asked === state.generation) startClock();
  }
  return state.room;
}

/**
 * Say what the room is without asking it, for the two moments the caller knows
 * better than a poll: a room that has just started, and one that has just been
 * stopped or had a join answered.
 */
export function setHostedRoom(next: DirectRoomStatus | null): void {
  state.generation += 1;
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
  state.listeners.add(listener);
  return () => {
    state.listeners.delete(listener);
  };
}

/**
 * The address the hosted room was handing out before its current one, or null
 * while it has not moved. See {@link HostedRoom.movedFrom}.
 */
export function useRoomMovedFrom(): string | null {
  return useSyncExternalStore(
    (onChange) => subscribeHostedRoom(onChange),
    () => state.movedFrom,
    () => state.movedFrom,
  );
}

/** The room this client hosts, or null when it is not hosting. */
export function useHostedRoom(): DirectRoomStatus | null {
  return useSyncExternalStore(
    (onChange) => subscribeHostedRoom(onChange),
    () => state.room,
    // Nothing hosts a room during a server render, and the store is a module
    // variable either way.
    () => state.room,
  );
}
