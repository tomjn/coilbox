import {
  BUILTIN_SERVERS,
  type LastLogin,
  type LobbyAccount,
  type LobbyServer,
  serverProtocol,
} from "./config";

/** The retired plaintext BAR built-in, and the TLS entry that replaced it. */
const RETIRED_BAR_ID = "bar";
const BAR_TLS_ID = "bar-ssl";

/**
 * Endpoints that were built-ins once and are not offered any more, mapped to the
 * entry that replaced them. BAR's plaintext 8200 is here because the same server
 * answers on 8201 with TLS, so a row pointing at the plain port is moved across
 * rather than kept as a custom server that sends its password in the clear.
 */
const RETIRED_ENDPOINTS: { host: string; port: number; id: string }[] = [
  { host: "server4.beyondallreason.info", port: 8200, id: BAR_TLS_ID },
];

/** The old conflated server+username row, stored under `lobbyServers.directory`. */
export interface LegacyLobbyServer {
  id: string;
  name: string;
  host: string;
  port: number;
  tls: boolean;
  allowSelfSigned: boolean;
  username?: string;
}
export interface LegacyLobbyServerDir {
  servers: LegacyLobbyServer[];
}

/** A keychain secret move: read `from`, store under `to`, delete `from`. */
export interface KeychainMove {
  from: { serverId: string; username: string };
  to: { serverId: string; username: string };
}

export interface MigrationPlan {
  customServers: LobbyServer[];
  accounts: LobbyAccount[];
  reKey: KeychainMove[];
}

/**
 * Convert the old directory into the server/account model. Pure: keychain I/O is
 * described in `reKey` for the driver to apply, not performed here. `newId` supplies
 * account ids (injected so tests are deterministic).
 *
 * Per row: a host+port match against the TASServer entries in `BUILTIN_SERVERS`
 * points the account at the built-in id (and re-keys the secret from the old row id
 * to the built-in id), with {@link RETIRED_ENDPOINTS} redirecting an endpoint we no
 * longer offer onto its replacement. Tachyon entries are never matched, because the
 * old directory only ever held TASServer connections.
 * Otherwise a custom server is created reusing the row's id, so its keychain secret
 * needs no move. Rows without a username produce no account.
 */
export function planMigration(
  old: LegacyLobbyServerDir,
  newId: () => string,
): MigrationPlan {
  const customServers: LobbyServer[] = [];
  const accounts: LobbyAccount[] = [];
  const reKey: KeychainMove[] = [];

  for (const row of old.servers ?? []) {
    const retired = RETIRED_ENDPOINTS.find(
      (e) => e.host === row.host && e.port === row.port,
    );
    const match = BUILTIN_SERVERS.find((b) =>
      retired
        ? b.id === retired.id
        : serverProtocol(b) === "tasserver" &&
          b.host === row.host &&
          b.port === row.port,
    );
    let serverId: string;
    if (match) {
      serverId = match.id;
      if (row.username) {
        reKey.push({
          from: { serverId: row.id, username: row.username },
          to: { serverId: match.id, username: row.username },
        });
      }
    } else {
      serverId = row.id;
      if (!customServers.some((s) => s.id === row.id)) {
        customServers.push({
          id: row.id,
          name: row.name,
          host: row.host,
          port: row.port,
          tls: row.tls,
          allowSelfSigned: row.allowSelfSigned,
        });
      }
    }
    if (row.username) {
      accounts.push({ id: newId(), serverId, username: row.username });
    }
  }

  return { customServers, accounts, reKey };
}

export interface BarTlsRemap {
  accounts: LobbyAccount[];
  lastLogin: LastLogin | null;
  reKey: KeychainMove[];
  /** Nothing pointed at the retired entry, so the caller can skip writing. */
  changed: boolean;
}

/**
 * Move logins off the retired plaintext BAR entry onto the SSL one. Pure: keychain
 * I/O is described in `reKey` for the driver to apply. It is the same server and the
 * same account database on either port, so a login carries over untouched.
 *
 * A login that already exists on the SSL entry under the same name absorbs the
 * plaintext one rather than becoming a duplicate row, and keeps its own stored
 * password, which leaves the plaintext login's secret behind in the keychain,
 * unreferenced and harmless.
 */
export function planBarTlsRemap(
  accounts: LobbyAccount[],
  lastLogin: LastLogin | null,
): BarTlsRemap {
  const onBar = accounts.filter((a) => a.serverId === RETIRED_BAR_ID);
  const staying = lastLogin?.serverId === RETIRED_BAR_ID;
  if (onBar.length === 0 && !staying) {
    return { accounts, lastLogin, reKey: [], changed: false };
  }

  const alreadyOnTls = new Set(
    accounts
      .filter((a) => a.serverId === BAR_TLS_ID)
      .map((a) => a.username.toLowerCase()),
  );

  const reKey: KeychainMove[] = [];
  const next: LobbyAccount[] = [];
  for (const a of accounts) {
    if (a.serverId !== RETIRED_BAR_ID) {
      next.push(a);
      continue;
    }
    if (alreadyOnTls.has(a.username.toLowerCase())) continue;
    next.push({ ...a, serverId: BAR_TLS_ID });
    reKey.push({
      from: { serverId: RETIRED_BAR_ID, username: a.username },
      to: { serverId: BAR_TLS_ID, username: a.username },
    });
  }

  return {
    accounts: next,
    lastLogin: staying
      ? { ...(lastLogin as LastLogin), serverId: BAR_TLS_ID }
      : lastLogin,
    reKey,
    changed: true,
  };
}
