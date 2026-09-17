import type { Connections } from "./connections";

/** What the top bar's multiplayer dot shows. */
export type DotStatus = "off" | "connecting" | "on" | "away" | "error";

/**
 * The top bar dot across every connection (issue #2848). Pure.
 *
 * Connected when any connection is logged in, and away only when every one that
 * is logged in is away. Connecting while a connect is in flight or a live
 * connection is still logging in. An error only when every connection left has
 * failed, so one dropped server beside a working one does not turn the dot red.
 */
export function lobbyDotStatus(
  connections: Connections,
  /** Whether any connection has a connect or command in flight. */
  busy: boolean,
): DotStatus {
  const entries = Object.values(connections);
  const ready = entries.filter((c) => c.live && c.mirror.phase === "ready");
  if (ready.length > 0) {
    return ready.every((c) => c.status.away) ? "away" : "on";
  }
  if (busy || entries.some((c) => c.live)) return "connecting";
  const failed = (c: (typeof entries)[number]) =>
    c.mirror.error != null || c.mirror.phase === "denied";
  if (entries.length > 0 && entries.every(failed)) return "error";
  return "off";
}
