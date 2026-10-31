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
  | { kind: "server"; host: string; port: number }
  /** A saved login, opened for editing with the cursor in its password field. */
  | { kind: "password"; serverId: string; username: string };

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

/** The page the requests above are answered on. */
export const LOBBY_SERVERS_ROUTE = "/settings/lobby-servers";

let navigateTo: ((to: string) => void) | null = null;

/**
 * Let code outside the router, such as a notification button, take the player
 * to the lobby servers page. A component inside the router registers its
 * `navigate` here. Answers the way to stop.
 */
export function registerDrawerNavigator(
  navigate: (to: string) => void,
): () => void {
  navigateTo = navigate;
  return () => {
    if (navigateTo === navigate) navigateTo = null;
  };
}

/** Ask for a drawer and go to the page that opens it. */
export function openDrawerPage(request: DrawerRequest): void {
  requestDrawer(request);
  navigateTo?.(LOBBY_SERVERS_ROUTE);
}
