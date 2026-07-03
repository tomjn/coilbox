import { useSetting } from "@picoframe/frame";

/**
 * A lobby server (connection target). Secrets are NOT stored here — passwords live
 * in the OS keychain keyed by `{serverId, username}` (see `bindings.ts`). Built-in
 * catalog entries carry `builtin: true` (set when merging); custom servers do not.
 */
export interface LobbyServer {
  id: string;
  name: string;
  host: string;
  port: number;
  tls: boolean;
  /** Accept a self-signed server cert (uberserver ships one; teiserver does not). */
  allowSelfSigned: boolean;
  /** True for built-in catalog entries. Absent on user-defined custom servers. */
  builtin?: boolean;
}

/**
 * The well-known public lobby servers, taken from SkyLobby's `default-servers`
 * (graal/clj/skylobby/util.clj). Read-only; users add logins against these. BAR's
 * plain (8200) and SSL (8201) endpoints are kept as two entries, mirroring SkyLobby.
 */
export const BUILTIN_SERVERS: LobbyServer[] = [
  {
    id: "spring-official",
    name: "Spring Official",
    host: "lobby.springrts.com",
    port: 8200,
    tls: false,
    allowSelfSigned: false,
  },
  {
    id: "techa",
    name: "Tech Annihilation",
    host: "lobby.techa-rts.com",
    port: 8200,
    tls: false,
    allowSelfSigned: false,
  },
  {
    id: "bar",
    name: "Beyond All Reason",
    host: "server4.beyondallreason.info",
    port: 8200,
    tls: false,
    allowSelfSigned: false,
  },
  {
    id: "bar-ssl",
    name: "Beyond All Reason (SSL)",
    host: "server4.beyondallreason.info",
    port: 8201,
    tls: true,
    allowSelfSigned: false,
  },
];

/** The merged server list: built-ins (tagged `builtin`) followed by custom servers. */
export function allServers(custom: LobbyServer[]): LobbyServer[] {
  return [...BUILTIN_SERVERS.map((s) => ({ ...s, builtin: true })), ...custom];
}

/** Resolve a server id against the built-in catalog + the given custom servers. */
export function resolveServer(
  id: string,
  custom: LobbyServer[],
): LobbyServer | undefined {
  return allServers(custom).find((s) => s.id === id);
}

/** User-defined custom servers, persisted under `lobbyServers.servers`. */
export interface CustomServersConfig {
  servers: LobbyServer[];
}
export const defaultCustomServers: CustomServersConfig = { servers: [] };

/** The user's custom servers (built-ins live in code, not here). */
export function useCustomServers() {
  return useSetting<CustomServersConfig>(
    "lobbyServers.servers",
    defaultCustomServers,
  );
}

/**
 * A login: references a server by id and carries a username. The password lives in
 * the keychain keyed by `{serverId, username}`. Many accounts can target one server.
 */
export interface LobbyAccount {
  id: string;
  serverId: string;
  username: string;
}
export interface AccountsConfig {
  accounts: LobbyAccount[];
}
export const defaultAccounts: AccountsConfig = { accounts: [] };

/** The user's saved logins, persisted under `lobbyServers.accounts`. */
export function useLobbyAccounts() {
  return useSetting<AccountsConfig>("lobbyServers.accounts", defaultAccounts);
}
