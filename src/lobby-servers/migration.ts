import {
  BUILTIN_SERVERS,
  type LobbyAccount,
  type LobbyServer,
  serverProtocol,
} from "./config";

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
 * to the built-in id). Tachyon entries are never matched, because the old directory
 * only ever held TASServer connections.
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
    const match = BUILTIN_SERVERS.find(
      (b) =>
        serverProtocol(b) === "tasserver" &&
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
