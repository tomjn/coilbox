/**
 * The keys each connection has joined battles with, so an auto-rejoin after a
 * dropped connection can send the key again (issue #1584). Without it a rejoin
 * goes out with no key and a passworded battle refuses it.
 *
 * In memory only, like the Open Annihilation password in `oaPassword.ts`: it is
 * never written to settings or logs. The wire line is redacted by
 * `redact.rs` before the protocol console shows it. Keys are held per battle, so
 * a refused join of one battle does not displace the key of the battle the
 * player is in. They are dropped when the connection is closed or its drop ends
 * the session with no reconnect left to use them.
 */

const remembered = new Map<string, Map<number, string>>();

/**
 * Record the key a join of `battleId` on `serverKey` is sent with. A join with
 * no key clears that battle's entry, so it never replays an older key.
 */
export function rememberJoinKey(
  serverKey: string,
  battleId: number,
  key: string | null | undefined,
) {
  let keys = remembered.get(serverKey);
  if (!key) {
    keys?.delete(battleId);
    return;
  }
  if (!keys) {
    keys = new Map();
    remembered.set(serverKey, keys);
  }
  keys.set(battleId, key);
}

/**
 * The key the last join of `battleId` on `serverKey` was sent with, or null.
 * Only read for the battle the player is in when the connection drops, so the
 * key of a join the lobby refused is never replayed.
 */
export function joinKeyFor(serverKey: string, battleId: number): string | null {
  return remembered.get(serverKey)?.get(battleId) ?? null;
}

export function forgetJoinKey(serverKey: string) {
  remembered.delete(serverKey);
}
