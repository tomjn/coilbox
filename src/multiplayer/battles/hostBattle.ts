/**
 * What to tell a host whose battle would not open. Pure.
 *
 * A refusal that never reaches the wire, such as a password the line cannot
 * carry, arrives as a rejected command and nothing else: there is no
 * `lastJoinError`, because the server never saw it, and no disconnect, because
 * the connection is fine. So this is the only thing the host has to read, and
 * dropping it left them pressing a button that did nothing (issue #1591).
 */
export function hostBattleFailure(error: unknown): string {
  const raw = (
    error instanceof Error ? error.message : String(error ?? "")
  ).trim();
  return raw
    ? `Could not host the battle: ${raw}`
    : "Could not host the battle.";
}
