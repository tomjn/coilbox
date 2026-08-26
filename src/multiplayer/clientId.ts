/**
 * The per-install ids coilbox sends when it logs in. Two servers want one, and
 * they want different things, so they are kept apart.
 *
 * # The TASServer one
 *
 * Sent as the `LOGIN` userID field.
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

/**
 * The settings key Zero-K's `InstallID` is kept under.
 *
 * Kept apart from {@link CLIENT_ID_KEY} rather than shared. They are values for
 * two different servers, and one install's TASServer id has no business being
 * what Zero-K's ban-evasion checks see.
 */
export const ZEROK_INSTALL_ID_KEY = "multiplayer.zerokInstallId";

/**
 * Generate a fresh Zero-K `InstallID`: a random UUID.
 *
 * Zero-K's server uses it for multi-account and ban-evasion checks, so it has to
 * be stable for as long as the install is. It is not identity: it authenticates
 * nothing, it is not tied to an account, and a fresh install is meant to get a
 * fresh one rather than carry the old one over.
 */
export function newZerokInstallId(): string {
  return crypto.randomUUID();
}
