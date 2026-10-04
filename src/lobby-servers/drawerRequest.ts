/**
 * A request for the lobby servers settings page to open one of its add
 * drawers already filled in (issue #3382). An invite link to a server with no
 * saved login asks for the login drawer on that server, and one to a server
 * coilbox has no entry for asks for the server drawer on that address.
 *
 * Either drawer is a draft. Nothing is saved, and nothing connects, until the
 * player presses Add in it.
 *
 * One slot, in memory. The page takes the request when it mounts, or at once
 * if it is already on screen.
 */
export type DrawerRequest =
  | { kind: "login"; serverId: string }
  | { kind: "server"; host: string; port: number };

let pending: DrawerRequest | null = null;
const listeners = new Set<() => void>();

export function requestDrawer(request: DrawerRequest): void {
  pending = request;
  for (const listener of listeners) listener();
}

/** The waiting request, which is then no longer waiting. */
export function takeDrawerRequest(): DrawerRequest | null {
  const request = pending;
  pending = null;
  return request;
}

/** Be told when a request arrives. Answers the way to stop being told. */
export function onDrawerRequest(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
