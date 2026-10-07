import { useSyncExternalStore } from "react";

/** The friend being followed. Friends are per server, so it is both. */
export interface Follow {
  serverKey: string;
  name: string;
}

/**
 * Who the player is following, if anyone (issue #3696). One friend at a time.
 * Held in memory and not in settings, so a follow ends with the app and is not
 * picked up again by the next launch.
 */
let current: Follow | null = null;
const listeners = new Set<() => void>();

export function getFollow(): Follow | null {
  return current;
}

/** Follow somebody, replacing whoever was followed, or stop with null. */
export function setFollow(next: Follow | null): void {
  current = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useFollow(): Follow | null {
  return useSyncExternalStore(subscribe, getFollow);
}

export function isFollowing(
  follow: Follow | null,
  serverKey: string,
  name: string,
): boolean {
  return follow?.serverKey === serverKey && follow.name === name;
}

/** Follow `name`, or stop if they are the one being followed. */
export function toggleFollow(serverKey: string, name: string): void {
  setFollow(isFollowing(current, serverKey, name) ? null : { serverKey, name });
}
