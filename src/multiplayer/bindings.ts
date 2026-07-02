import { defineCommand } from "@picoframe/plugin-sdk";

/**
 * Typed bindings to the `coilbox-multiplayer` plugin. The connection is long-lived:
 * `mp_connect` opens the socket and streams `LobbyEvent`s over a `Channel` until
 * disconnect; the frontend keeps a mirror of the authoritative Rust state seeded by
 * `mp_snapshot`. Expanded during implementation.
 */

/** Identifies one lobby connection (username + server url). */
export interface ServerKey {
  user: string;
  url: string;
}

export const mpDisconnect = defineCommand<
  { serverKey: ServerKey },
  Record<string, never>
>("coilbox-multiplayer", "mp_disconnect");
