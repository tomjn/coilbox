/**
 * The per-install id sent as the `LOGIN` userID field.
 *
 * teiserver keeps it as the account's lobby hash and refuses any login that leaves
 * it empty or `0` ("LobbyHash/UserID missing in login"), so it has to be a real
 * value. It also has to be stable: teiserver reads a changed hash as a different
 * machine, which is what its smurf detection watches. SkyLobby does the same thing
 * with a random 32-bit number kept in its settings.
 */

/** The settings key the generated id is kept under. */
export const CLIENT_ID_KEY = "multiplayer.clientId";

/**
 * Generate a fresh id: a random 32-bit number in decimal. Never `0`, because that
 * is the value teiserver rejects.
 */
export function newClientId(): string {
  const [n] = crypto.getRandomValues(new Uint32Array(1));
  return String(n === 0 ? 1 : n);
}
