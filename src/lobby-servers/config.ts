import { useSetting } from "@picoframe/frame";
import type { ProfileLobby } from "../profile/profile";
import { getProfile } from "../profile/profile";

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
  /** The distribution's preferred server (profile `lobby.official`): badged + first. */
  official?: boolean;
}

/** The id assigned to an inline profile-defined official server (no natural id). */
export const OFFICIAL_ID = "profile-official";

/**
 * The well-known public lobby servers, taken from SkyLobby's `default-servers`
 * (graal/clj/skylobby/util.clj). Read-only; users add logins against these. BAR's
 * plain (8200) and SSL (8201) endpoints are kept as two entries, mirroring SkyLobby.
 */
export const BUILTIN_SERVERS: LobbyServer[] = [
  {
    id: "recoil-official",
    name: "Recoil Official",
    host: "lobby.recoilengine.org",
    port: 8200,
    // The official Recoil lobby is TLS with a self-signed cert (like uberserver).
    tls: true,
    allowSelfSigned: true,
  },
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

/** The official server + preset allow-list a profile's `lobby` block resolves to. */
export interface ProfileServerRules {
  /** The normalized official server, or undefined when the profile sets none. */
  official?: LobbyServer;
  /** Built-in ids to keep; undefined keeps them all (see {@link ProfileLobby.presets}). */
  presets?: string[];
}

/**
 * Resolve a profile `lobby` block into an official server + preset allow-list. Pure
 * (takes the block, not the singleton) so it's unit-testable. A string `official`
 * promotes a built-in by id; an object defines an inline server (id {@link OFFICIAL_ID},
 * host required, ports/flags defaulted). An unknown built-in id or a hostless object
 * yields no official server (the block is otherwise still honoured).
 */
export function resolveProfileServerRules(
  lobby: ProfileLobby | undefined,
): ProfileServerRules {
  if (!lobby) return {};
  let official: LobbyServer | undefined;
  if (typeof lobby.official === "string") {
    const b = BUILTIN_SERVERS.find((s) => s.id === lobby.official);
    if (b) official = { ...b, official: true };
  } else if (lobby.official?.host) {
    const o = lobby.official;
    official = {
      id: OFFICIAL_ID,
      name: o.name || o.host,
      host: o.host,
      port: o.port ?? 8200,
      tls: o.tls ?? false,
      allowSelfSigned: o.allowSelfSigned ?? false,
      official: true,
    };
  }
  return { official, presets: lobby.presets };
}

/**
 * Build the visible catalog from the profile rules + the user's custom servers. Pure
 * and order-stable: the official server first, then the (narrowed) built-ins, then
 * custom servers. A built-in promoted to official appears only once — as the official
 * entry, not also as a plain preset.
 */
export function buildCatalog(
  custom: LobbyServer[],
  rules: ProfileServerRules,
): LobbyServer[] {
  const officialId = rules.official?.id;
  const builtins = BUILTIN_SERVERS.filter(
    (s) =>
      s.id !== officialId &&
      (rules.presets == null || rules.presets.includes(s.id)),
  ).map((s) => ({ ...s, builtin: true }));
  const list: LobbyServer[] = [];
  if (rules.official) list.push({ ...rules.official, builtin: true });
  list.push(...builtins, ...custom);
  return list;
}

/**
 * The merged server list: the profile's official server (if any) first, the built-ins
 * it allows next, then the user's custom servers. Reads the load-once profile
 * singleton, so it's constant for the session (same pattern as `getProfile()`).
 */
export function allServers(custom: LobbyServer[]): LobbyServer[] {
  return buildCatalog(custom, resolveProfileServerRules(getProfile().lobby));
}

/** The profile's official server (normalized), or undefined when none is configured. */
export function profileOfficialServer(): LobbyServer | undefined {
  return resolveProfileServerRules(getProfile().lobby).official;
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

/**
 * The account last connected with (by `{serverId, username}`, not the account id so
 * it survives an account being re-created). Written on every successful connect;
 * read at startup by the opt-in auto-connect and by the login popover's one-click
 * reconnect. `null` until the first-ever successful connect.
 */
export interface LastLogin {
  serverId: string;
  username: string;
}

/** The last-used login, persisted under `lobbyServers.lastLogin` (null until first connect). */
export function useLastLogin() {
  return useSetting<LastLogin | null>("lobbyServers.lastLogin", null);
}

/**
 * Resolve a {@link LastLogin} to the account + server it names, or null. Pure. Returns
 * null when there is no last login, the account no longer exists, or its server isn't
 * in `servers` — which is how the distribution profile is respected: pass the
 * profile-filtered catalog (`allServers`) as `servers` and a profile-disallowed
 * server simply won't match, so it's never auto-connected.
 */
export function resolveLastLogin(
  lastLogin: LastLogin | null,
  accounts: LobbyAccount[],
  servers: LobbyServer[],
): { account: LobbyAccount; server: LobbyServer } | null {
  if (!lastLogin) return null;
  const account = accounts.find(
    (a) =>
      a.serverId === lastLogin.serverId && a.username === lastLogin.username,
  );
  if (!account) return null;
  const server = servers.find((s) => s.id === account.serverId);
  if (!server) return null;
  return { account, server };
}

/**
 * The account to auto-connect at startup, or null when auto-connect is off or the
 * last login can't be resolved (see {@link resolveLastLogin}). Pure so the boot-seed
 * decision is unit-testable without a live store.
 */
export function autoConnectTarget(
  enabled: boolean,
  lastLogin: LastLogin | null,
  accounts: LobbyAccount[],
  servers: LobbyServer[],
): { account: LobbyAccount; server: LobbyServer } | null {
  return enabled ? resolveLastLogin(lastLogin, accounts, servers) : null;
}
