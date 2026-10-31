import type { Connections } from "./connections";
import { isPasswordRefusal } from "./loginRefused";

/** What the top bar's multiplayer dot shows. */
export type DotStatus =
  | "off"
  | "connecting"
  | "on"
  | "away"
  | "error"
  | "refused";

/**
 * The server's reason when it refused this login's password, else null. A
 * connection that is up was not refused, whatever an earlier attempt said.
 */
export function refusedReason(
  c: Pick<Connections[string], "live" | "mirror">,
): string | null {
  if (c.live) return null;
  if (c.mirror.loginError != null) return c.mirror.loginError;
  return c.mirror.phase === "denied" ? "" : null;
}

/**
 * The top bar dot across every lobby login (issue #2848, and #2904 for rooms).
 * Pure.
 *
 * Connected when any login is logged in, and away only when every one that is
 * logged in is away. Connecting while a connect is in flight or a live login
 * is still logging in. An error only when every login left has failed, so one
 * dropped server beside a working one does not turn the dot red, and neither
 * does a refused password beside a working login: the refusal has its own
 * notification and its own mark in the popover. When every login left was
 * refused for its password the dot says so ("refused") rather than "error", so
 * a wrong password is not read as a network problem. A refusal for another
 * reason, such as being logged in already, stays "error". A room
 * (`direct`) is not a login and is left out, so a LAN or direct-address room
 * open with no lobby login does not turn the dot on.
 */
export function lobbyDotStatus(
  connections: Connections,
  /** Whether any connection has a connect or command in flight. */
  busy: boolean,
): DotStatus {
  const entries = Object.values(connections).filter((c) => !c.direct);
  const ready = entries.filter((c) => c.live && c.mirror.phase === "ready");
  if (ready.length > 0) {
    return ready.every((c) => c.status.away) ? "away" : "on";
  }
  if (busy || entries.some((c) => c.live)) return "connecting";
  const failed = (c: (typeof entries)[number]) =>
    c.mirror.error != null || refusedReason(c) != null;
  if (entries.length > 0 && entries.every(failed)) {
    return entries.every((c) => isPasswordRefusal(refusedReason(c)))
      ? "refused"
      : "error";
  }
  return "off";
}
