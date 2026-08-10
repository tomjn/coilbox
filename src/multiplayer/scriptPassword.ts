/**
 * The per-join script password: the secret the host's engine checks when we
 * connect to the running game. The server echoes it back in `JOINEDBATTLE`, which
 * is where the launch config picks it up again as `myPasswd`.
 *
 * Every join sends one, even for an open battle. uberserver accepts a bare
 * `JOINBATTLE <id>`, but teiserver's handler only matches the three-field form and
 * answers "No incomming match for JOINBATTLE" without it.
 */
export function newScriptPassword(): string {
  return crypto.randomUUID();
}
