/**
 * The key each connection last joined a battle with, so an auto-rejoin after a
 * dropped connection can send it again (issue #1584). Without it a rejoin goes
 * out with no key and a passworded battle refuses it.
 *
 * In memory only, like the Open Annihilation password in `oaPassword.ts`: it is
 * never written to settings or logs. The wire line is redacted by
 * `redact.rs` before the protocol console shows it. There is one entry per
 * connection, replaced by every join on it and removed when the connection is
 * closed.
 */

interface Remembered {
  battleId: number;
  key: string;
}

const remembered = new Map<string, Remembered>();

/**
 * Record the key a join on `serverKey` is sent with. A join with no key clears
 * the entry, so a later battle never inherits the previous battle's key.
 */
export function rememberJoinKey(
  serverKey: string,
  battleId: number,
  key: string | null | undefined,
) {
  if (key) remembered.set(serverKey, { battleId, key });
  else remembered.delete(serverKey);
}

/**
 * The key the join of `battleId` on `serverKey` was sent with, or null. Only
 * meaningful for a battle the player was in when the connection dropped, so a
 * refused join's key is never read.
 */
export function joinKeyFor(serverKey: string, battleId: number): string | null {
  const entry = remembered.get(serverKey);
  return entry && entry.battleId === battleId ? entry.key : null;
}

export function forgetJoinKey(serverKey: string) {
  remembered.delete(serverKey);
}
