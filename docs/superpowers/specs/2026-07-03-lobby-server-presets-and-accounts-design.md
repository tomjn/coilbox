# Lobby server presets + server/account separation

Date: 2026-07-03 Status: Design approved, pending spec review

## Problem

The Lobby servers settings conflate two concepts in one row: a connection target (host/port/tls) and a single login (`LobbyServer.username?` + a keychain password). Two consequences:

1. There are no presets, so a user must type the known public servers (Spring Official, BAR, etc.) from memory.
2. Running multiple accounts on one server means duplicating the whole server row, once per username.

## Goal

Ship the well-known servers as a built-in catalog, and split the model into **servers** (connection targets) and **accounts** (logins that reference a server). Users focus on adding logins; the servers are mostly pre-provided, with an escape hatch for custom ones.

## Source of presets

Taken from SkyLobby's `default-servers` (`graal/clj/skylobby/util.clj`):

| name | host | port | tls |
|---|---|---|---|
| Spring Official | `lobby.springrts.com` | 8200 | no |
| Tech Annihilation | `lobby.techa-rts.com` | 8200 | no |
| Beyond All Reason | `server4.beyondallreason.info` | 8200 | no |
| Beyond All Reason (SSL) | `server4.beyondallreason.info` | 8201 | yes |

BAR's two rows (plain 8200 / SSL 8201) are kept as two distinct catalog entries, mirroring SkyLobby, rather than collapsed into one entry with a TLS toggle. `allowSelfSigned` is `false` for all four (none of the plain-8200 presets use TLS, and BAR's teiserver ships a proper cert).

## Decisions

- **Catalog + custom servers.** The four presets are built-in and read-only. Users can additionally add/edit custom servers (LAN, self-hosted, new servers). Accounts can target any server.
- **Best-effort migration.** Existing `LobbyServer` rows and their keychain secrets are migrated once into the new model. A keychain move that fails costs one login its saved password (re-entered), not correctness; it is logged, not fatal.
- **Static catalog (not seeded into the store).** Presets live in code so they can be corrected/extended in a release without a data migration, and can't be accidentally broken by the user.

## Data model

`src/lobby-servers/config.ts`:

```ts
export interface LobbyServer {
  id: string;                 // stable slug for built-ins; uuid for custom
  name: string;
  host: string;
  port: number;
  tls: boolean;
  allowSelfSigned: boolean;
  builtin?: boolean;          // set true when merging the catalog; absent on custom
}

export const BUILTIN_SERVERS: LobbyServer[] = [
  { id: "spring-official", name: "Spring Official",           host: "lobby.springrts.com",           port: 8200, tls: false, allowSelfSigned: false },
  { id: "techa",           name: "Tech Annihilation",         host: "lobby.techa-rts.com",           port: 8200, tls: false, allowSelfSigned: false },
  { id: "bar",             name: "Beyond All Reason",         host: "server4.beyondallreason.info",  port: 8200, tls: false, allowSelfSigned: false },
  { id: "bar-ssl",         name: "Beyond All Reason (SSL)",   host: "server4.beyondallreason.info",  port: 8201, tls: true,  allowSelfSigned: false },
];

// persisted: "lobbyServers.servers" — custom servers only
export interface CustomServersConfig { servers: LobbyServer[] }        // default { servers: [] }

// persisted: "lobbyServers.accounts"
export interface LobbyAccount { id: string; serverId: string; username: string } // password -> keychain
export interface AccountsConfig { accounts: LobbyAccount[] }           // default { accounts: [] }

// merged view for pickers / resolution
export function allServers(custom: LobbyServer[]): LobbyServer[]       // [...BUILTIN (builtin:true), ...custom]
export function resolveServer(id: string, custom: LobbyServer[]): LobbyServer | undefined
```

Hooks (following the existing `useLobbyServers` / `useSetting` pattern):

```ts
export function useCustomServers(): [CustomServersConfig, (c: CustomServersConfig) => void]
export function useLobbyAccounts(): [AccountsConfig, (c: AccountsConfig) => void]
```

**Keychain key stays `{serverId}:{username}`.** `serverId` now points at a catalog or custom id; `(serverId, username)` is the natural uniqueness `serverKeyFor` already implies. No Rust changes: the `ls_store/get/delete` commands and their ACL are unchanged.

## Migration

Pure planner (unit-tested, no keychain I/O inside):

```ts
interface OldRow { id: string; name: string; host: string; port: number;
                   tls: boolean; allowSelfSigned: boolean; username?: string }

interface MigrationPlan {
  customServers: LobbyServer[];
  accounts: LobbyAccount[];
  reKey: Array<{ from: { serverId: string; username: string };
                 to:   { serverId: string; username: string } }>;
}

function planMigration(old: { servers: OldRow[] }): MigrationPlan
```

Per old row:
- **Catalog match** (same host + port as a `BUILTIN_SERVERS` entry): the account's `serverId` is the built-in id. If the row had a username, emit a `reKey` from `{ oldRowId, username }` to `{ builtinId, username }`.
- **No match**: create a custom server that reuses the old row's `id` (so its keychain secret needs no move) and its name/host/port/tls/allowSelfSigned.
- If `username` is present, emit an account `{ id: uuid(), serverId, username }`.

Driver (in the settings/provider mount, guarded by a `lobbyServers.migratedV2` boolean setting so it runs once):

1. Read old `lobbyServers.directory`.
2. `planMigration(old)`.
3. Write `lobbyServers.servers` and `lobbyServers.accounts`.
4. Apply each `reKey`: `lsGetCredential(from)` -> `lsStoreCredential(to)` -> `lsDeleteCredential(from)`. Failures are logged and skipped (best-effort).
5. Set `lobbyServers.migratedV2 = true`. (Leave `lobbyServers.directory` in place, unread, for safety.)

## UI

`/settings/lobby-servers` keeps its route; the section splits into two lists.

### Accounts (primary, top)

- Header "Accounts" + "Add login" button; dashed empty state.
- `AccountRow`:
  - **Server picker**: `OptionSelect` (registry `Select`) over
    `allServers(custom)`, built-ins grouped/tagged.
  - **Username** input.
  - **Password**: local React state, keychain blur-save + "Saved in keychain" /
    "Not set" hint on mount, keyed by `(account.serverId, account.username)` -
    the exact pattern the current `ServerRow` uses.
  - **Connected badge** (`● Connected · N online`) + protocol-console button,
    moved here since "connected" is now per-account. Match is
    `activeKey === serverKeyFor(server, account.username)`.
  - Remove button: drops the account and best-effort deletes its secret.

### Servers (below)

- Header "Servers" + "Add custom server" button.
- **Built-in rows**: read-only display (name, `host:port`, TLS badge, "Built-in" tag) - no edit, no delete.
- **Custom rows**: editable (name/host/port/tls/allowSelfSigned) + remove - a trimmed `ServerRow` with the username/password fields removed.

## Connect flow

`src/multiplayer/store.tsx`:

```ts
serverKeyFor(server: LobbyServer, username: string): string   // `${username}@${host}:${port}`
connect(account: LobbyAccount): Promise<void>                 // resolve server, read keychain, mpConnect
```

Removing `username` from `LobbyServer` turns every stale call site into a compile error - that typechecker output is the authoritative caller list to migrate. Before editing, enumerate call sites of `connect` and `serverKeyFor` (the account row badge, and any Connect button on the lobby/battle screens) and switch them to the account-based signatures. The Rust `mpConnect` binding is unchanged (it still receives host/port/tls/username/password).

## Testing

- **Unit**: `planMigration` - catalog match vs custom, account emission, `reKey` plan (built-in match rekeys, custom match does not), row with no username emits a server but no account.
- **Static**: `bun run typecheck` and `bunx biome ci .`; also `cargo fmt --all --check` and `cargo clippy --all-targets --all-features -D warnings` per project rule (Rust is untouched but CI runs both).
- **Live smoke** (`bun tauri dev`): seed an old-style `lobbyServers.directory`, launch, confirm it migrates into a built-in-matched account + a custom server; add a login on a built-in and on a custom server; confirm connect and the per-account connected badge.

## Out of scope

- Editing built-in presets.
- Any change to the Rust keychain plugin or lobby protocol.
- Account-level extras (display name, auto-connect, remembered client flags).
