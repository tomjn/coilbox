import { useSetting } from "@picoframe/frame";
import type { ProfileLobby } from "../profile/profile";
import { getProfile } from "../profile/profile";

/**
 * The wire protocol a lobby server speaks. See `docs/tachyon-protocol.md`.
 *
 * `zerok` is Zero-K's own line protocol, which is neither of the other two: a
 * command name and a JSON object over plain TCP, defined by C# classes rather
 * than by a published schema. See `crates/coilbox-zerok-protocol`.
 */
export type LobbyProtocol = "tasserver" | "tachyon" | "zerok";

/**
 * How an encrypted TASServer connection starts, which the two server families do
 * differently and incompatibly.
 *
 * `stls` connects in plaintext and upgrades in-band with `STLS`, which is what
 * uberserver offers on 8200. `direct` is TLS from the first byte, which is what
 * teiserver offers on 8201. Trying one against the other fails: uberserver resets
 * a direct handshake, and teiserver's 8201 never sends the plaintext greeting the
 * `STLS` dance waits for.
 */
export type TlsStyle = "stls" | "direct";

/** What the Rust side is told: the style, or that there is no TLS at all. */
export type TlsMode = "none" | TlsStyle;

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
  /**
   * How TLS starts when `tls` is set. Absent means `stls`, so a server stored
   * before this field existed keeps its old behaviour with no migration. Read it
   * through {@link tlsModeFor} rather than reaching for it directly.
   */
  tlsStyle?: TlsStyle;
  /** Accept a self-signed server cert (uberserver ships one; teiserver does not). */
  allowSelfSigned: boolean;
  /**
   * The wire protocol. Absent means `tasserver`, so a server stored before this
   * field existed keeps working with no migration. Read it through
   * {@link serverProtocol} rather than reaching for it directly.
   */
  protocol?: LobbyProtocol;
  /** True for built-in catalog entries. Absent on user-defined custom servers. */
  builtin?: boolean;
  /** Our support for this server is alpha, which the UI badges wherever it lists it. */
  alpha?: boolean;
  /**
   * A caution shown under the entry in Settings, for something a player would
   * otherwise only discover by hitting it. Built-in entries only.
   */
  notice?: string;
  /** The distribution's preferred server (profile `lobby.official`): badged + first. */
  official?: boolean;
}

/**
 * How the Rust side should open this server's connection, reading an absent
 * `tlsStyle` as `stls` (what every entry did before the field existed). Pure.
 */
export function tlsModeFor(server: {
  tls: boolean;
  tlsStyle?: TlsStyle;
}): TlsMode {
  if (!server.tls) return "none";
  return server.tlsStyle ?? "stls";
}

/** The protocol a server speaks, reading an absent field as `tasserver`. Pure. */
export function serverProtocol(server: {
  protocol?: LobbyProtocol;
}): LobbyProtocol {
  return server.protocol ?? "tasserver";
}

/**
 * The origin a Tachyon server's OAuth discovery document sits under, which is what
 * the browser sign-in is started against. Pure.
 *
 * A server entry stores a host, a port and a TLS flag, because that is what the
 * line protocol needs and every consumer of `serverKey` already assumes, so the
 * origin is rebuilt from those three. The default port is left out so this matches
 * the origin the server names in its own discovery document. The Rust side rebuilds
 * the WebSocket URL the same way (`tachyon_conn::urls`).
 */
export function tachyonBaseUrl(server: {
  host: string;
  port: number;
  tls: boolean;
}): string {
  const authority =
    server.port === (server.tls ? 443 : 80)
      ? server.host
      : `${server.host}:${server.port}`;
  return `${server.tls ? "https" : "http"}://${authority}`;
}

/** The id assigned to an inline profile-defined official server (no natural id). */
export const OFFICIAL_ID = "profile-official";

/**
 * Built-in ids that no longer exist, mapped to the entry that replaced them. A
 * distribution's `profile.json` is not ours to migrate, so a profile still naming
 * a retired id keeps working instead of silently resolving to nothing.
 */
const RENAMED_BUILTIN_IDS: Record<string, string> = { bar: "bar-ssl" };

/**
 * The current id for a built-in, following {@link RENAMED_BUILTIN_IDS}. Unknown and
 * current ids pass through untouched. Pure.
 */
export function canonicalServerId(id: string): string {
  return RENAMED_BUILTIN_IDS[id] ?? id;
}

/**
 * The well-known public lobby servers, taken from SkyLobby's `default-servers`
 * (graal/clj/skylobby/util.clj). Read-only, and users add logins against these. Only
 * BAR's SSL endpoint (8201) is offered, not its plaintext 8200 one. It is the same
 * teiserver either way, so the plain port buys nothing and sends the password in the
 * clear. BAR's Tachyon endpoint is a separate entry, because the same server runs
 * both protocols and TASServer has no announced sunset.
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
    id: "techa",
    name: "Tech Annihilation",
    host: "lobby.techa-rts.com",
    port: 8200,
    tls: false,
    allowSelfSigned: false,
  },
  {
    id: "bar-ssl",
    name: "Beyond All Reason",
    host: "server4.beyondallreason.info",
    port: 8201,
    tls: true,
    // teiserver's SSL port is TLS from the first byte, unlike uberserver's in-band
    // STLS upgrade on 8200.
    tlsStyle: "direct",
    allowSelfSigned: false,
  },
  {
    id: "bar-tachyon",
    name: "Beyond All Reason (Tachyon)",
    host: "server4.beyondallreason.info",
    // The endpoint is wss://server4.beyondallreason.info/tachyon, so this server's
    // real identity is a URL origin, not a host and port. Storing the HTTPS port is
    // deliberate: it keeps the derived serverKey `${username}@${host}:${port}` unique
    // per entry, so no consumer of that key has to change. See docs/tachyon-protocol.md.
    port: 443,
    tls: true,
    allowSelfSigned: false,
    protocol: "tachyon",
    alpha: true,
    notice:
      "Our Tachyon support is incomplete. Use the Beyond All Reason entry instead.",
  },
  {
    id: "zero-k",
    name: "Zero-K",
    host: "zero-k.info",
    // The same number TASServer uses, and a different protocol entirely. Zero-K
    // offers no TLS on it, so nothing on this connection is private, including
    // the password hash.
    port: 8200,
    tls: false,
    allowSelfSigned: false,
    protocol: "zerok",
    alpha: true,
    notice:
      "Our Zero-K support is incomplete. You can log in, and little else yet.",
  },
  // Last on purpose: it is the least likely destination for a Recoil or BAR player,
  // and the one nobody can register a new account on.
  {
    id: "spring-official",
    name: "Spring Official",
    host: "lobby.springrts.com",
    port: 8200,
    tls: false,
    allowSelfSigned: false,
    notice:
      "You cannot register a new account here. This server's verification emails are not being delivered.",
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
    const wanted = canonicalServerId(lobby.official);
    const b = BUILTIN_SERVERS.find((s) => s.id === wanted);
    if (b) official = { ...b, official: true };
  } else if (lobby.official?.host) {
    const o = lobby.official;
    official = {
      id: OFFICIAL_ID,
      name: o.name || o.host,
      host: o.host,
      port: o.port ?? 8200,
      tls: o.tls ?? false,
      tlsStyle: o.tlsStyle,
      allowSelfSigned: o.allowSelfSigned ?? false,
      official: true,
    };
  }
  return { official, presets: lobby.presets?.map(canonicalServerId) };
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
  /** ms epoch of the last successful connect with this login. */
  lastUsedAt?: number;
  /**
   * A password is known to exist in the keychain (set on save/register/connect,
   * cleared on none). `undefined` means unknown — pre-existing logins from before
   * this flag; checking would require reading the secret, which prompts on macOS.
   */
  hasSecret?: boolean;
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

/** Whether an account is the one named by the last login. Pure. */
export function isLastLogin(
  account: LobbyAccount,
  lastLogin: LastLogin | null,
): boolean {
  return (
    lastLogin != null &&
    account.serverId === lastLogin.serverId &&
    account.username === lastLogin.username
  );
}

/**
 * Accounts ordered most-recently-used first. Pure and stable: sorts by
 * `lastUsedAt` (missing = never), except the {@link LastLogin} account always
 * ranks at least above never-used ones — pre-stamp logins have no timestamp, but
 * the last login is known to be the most recent of them. Ties keep saved order.
 */
export function sortAccountsByRecency(
  accounts: LobbyAccount[],
  lastLogin: LastLogin | null,
): LobbyAccount[] {
  const rank = (a: LobbyAccount) =>
    Math.max(a.lastUsedAt ?? 0, isLastLogin(a, lastLogin) ? Infinity : 0);
  return [...accounts].sort((x, y) => rank(y) - rank(x));
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
