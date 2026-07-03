import { useSetting } from "@picoframe/frame";

/**
 * A configured lobby server. Secrets are NOT stored here — only a `username`
 * reference; the password/token lives in the OS keychain keyed by `{id, username}`
 * (see `bindings.ts`). Shared across consumers (the multiplayer client and, later,
 * the uberstress load-tester).
 */
export interface LobbyServer {
  id: string;
  name: string;
  host: string;
  port: number;
  tls: boolean;
  /** Accept a self-signed server cert (uberserver ships one; teiserver does not). */
  allowSelfSigned: boolean;
  username?: string;
}

export interface LobbyServerDir {
  servers: LobbyServer[];
}

export const defaultLobbyServerDir: LobbyServerDir = { servers: [] };

/** The shared lobby server directory, persisted through the frame settings store. */
export function useLobbyServers() {
  return useSetting<LobbyServerDir>(
    "lobbyServers.directory",
    defaultLobbyServerDir,
  );
}
