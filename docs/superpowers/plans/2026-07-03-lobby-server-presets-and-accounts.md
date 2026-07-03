# Lobby Server Presets + Server/Account Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the well-known lobby servers as a built-in catalog and split the settings model into servers (connection targets) and accounts (logins), so users pick a preset server and add logins instead of typing hosts from memory.

**Architecture:** A static `BUILTIN_SERVERS` catalog in code plus two persisted settings keys (`lobbyServers.servers` for custom servers, `lobbyServers.accounts` for logins). Passwords stay in the OS keychain keyed by `{serverId, username}` (unchanged Rust plugin). A one-time best-effort migration converts the old conflated `lobbyServers.directory` rows into servers + accounts, re-keying keychain secrets for catalog-matched rows. The multiplayer store's `connect`/`serverKeyFor` become account-aware by taking `(server, username)`.

**Tech Stack:** React + TypeScript, picoframe frame settings store (`useSetting`), Tauri command bindings, Vitest, Biome, shadcn `Select` (via `@picoframe` registry).

**Design reference:** `docs/superpowers/specs/2026-07-03-lobby-server-presets-and-accounts-design.md`

---

## File structure

- `src/lobby-servers/config.ts` — MODIFY. New `LobbyServer` (no `username`, adds `builtin?`), `BUILTIN_SERVERS`, `allServers`/`resolveServer`, `CustomServersConfig`+`useCustomServers`, `LobbyAccount`+`AccountsConfig`+`useLobbyAccounts`. Legacy `useLobbyServers`/`LobbyServerDir` removed by Task 4.
- `src/lobby-servers/config.test.ts` — CREATE. Unit tests for `allServers`/`resolveServer`.
- `src/lobby-servers/migration.ts` — CREATE. `LegacyLobbyServer(Dir)` types + pure `planMigration`.
- `src/lobby-servers/migration.test.ts` — CREATE. Unit tests for `planMigration`.
- `src/lobby-servers/pages/components/OptionSelect.tsx` — CREATE. Thin `Select` wrapper (copy of the per-plugin pattern) for the account server picker.
- `src/lobby-servers/pages/SettingsSection.tsx` — MODIFY (full rewrite). Accounts list + Servers list (built-in read-only + custom editable).
- `src/lobby-servers/LobbyServersProvider.tsx` — CREATE. Runs the one-time migration; rendered app-wide via the plugin's `Provider`.
- `src/lobby-servers/index.ts` — MODIFY. Register `Provider: LobbyServersProvider`.
- `src/multiplayer/store.tsx` — MODIFY. `serverKeyFor(server, username)` and `connect(server, username)`.
- `src/multiplayer/LobbyStatusButton.tsx` — MODIFY. Read accounts; login panel lists accounts and connects `(server, username)`.

---

## Task 1: New data model in config.ts (additive)

**Files:**
- Modify: `src/lobby-servers/config.ts`
- Test: `src/lobby-servers/config.test.ts` (create)

This task is **additive** — it adds the new catalog/account symbols while leaving the legacy `LobbyServer.username?`, `useLobbyServers`, `LobbyServerDir`, `defaultLobbyServerDir` in place so existing consumers keep compiling. Task 4 removes the legacy parts.

- [ ] **Step 1: Write `config.ts` with the new model alongside the legacy exports**

Replace the entire file with:

```ts
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
  /** @deprecated legacy field, removed once the account split lands (Task 4). */
  username?: string;
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
  return [
    ...BUILTIN_SERVERS.map((s) => ({ ...s, builtin: true })),
    ...custom,
  ];
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

// --- Legacy (removed in Task 4 once consumers migrate) ---------------------

export interface LobbyServerDir {
  servers: LobbyServer[];
}
export const defaultLobbyServerDir: LobbyServerDir = { servers: [] };

/** @deprecated the old conflated server+username directory. */
export function useLobbyServers() {
  return useSetting<LobbyServerDir>(
    "lobbyServers.directory",
    defaultLobbyServerDir,
  );
}
```

- [ ] **Step 2: Write the failing test**

Create `src/lobby-servers/config.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  allServers,
  BUILTIN_SERVERS,
  type LobbyServer,
  resolveServer,
} from "./config";

const custom: LobbyServer = {
  id: "custom-1",
  name: "LAN",
  host: "192.168.1.10",
  port: 8200,
  tls: false,
  allowSelfSigned: false,
};

describe("allServers", () => {
  it("puts built-ins first, tagged builtin, then custom servers", () => {
    const all = allServers([custom]);
    expect(all).toHaveLength(BUILTIN_SERVERS.length + 1);
    expect(all.slice(0, BUILTIN_SERVERS.length).every((s) => s.builtin)).toBe(
      true,
    );
    expect(all[all.length - 1]).toMatchObject({ id: "custom-1" });
  });

  it("does not mutate BUILTIN_SERVERS with the builtin flag", () => {
    allServers([]);
    expect(BUILTIN_SERVERS.every((s) => s.builtin === undefined)).toBe(true);
  });
});

describe("resolveServer", () => {
  it("finds a built-in by id", () => {
    expect(resolveServer("bar-ssl", [])?.port).toBe(8201);
  });
  it("finds a custom server by id", () => {
    expect(resolveServer("custom-1", [custom])?.host).toBe("192.168.1.10");
  });
  it("returns undefined for an unknown id", () => {
    expect(resolveServer("nope", [custom])).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run the tests**

Run: `bun run test src/lobby-servers/config.test.ts`
Expected: PASS (5 tests). If `allServers` mutation test fails, the map is spreading correctly — recheck `{ ...s, builtin: true }`.

- [ ] **Step 4: Typecheck**

Run: `bun run typecheck`
Expected: PASS (legacy exports still satisfy existing consumers).

- [ ] **Step 5: Commit**

```bash
git add src/lobby-servers/config.ts src/lobby-servers/config.test.ts
git commit -m "feat(lobby): add server catalog + account config types"
```

---

## Task 2: Migration planner (pure)

**Files:**
- Create: `src/lobby-servers/migration.ts`
- Test: `src/lobby-servers/migration.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lobby-servers/migration.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { type LegacyLobbyServer, planMigration } from "./migration";

const row = (p: Partial<LegacyLobbyServer>): LegacyLobbyServer => ({
  id: "row-uuid",
  name: "",
  host: "example.org",
  port: 8200,
  tls: false,
  allowSelfSigned: false,
  ...p,
});

// Deterministic id generator for assertions.
const ids = () => {
  let n = 0;
  return () => `acc-${++n}`;
};

describe("planMigration", () => {
  it("maps a catalog-matched row to a built-in account and re-keys its secret", () => {
    const plan = planMigration(
      { servers: [row({ host: "server4.beyondallreason.info", port: 8200, username: "alice" })] },
      ids(),
    );
    expect(plan.customServers).toEqual([]);
    expect(plan.accounts).toEqual([{ id: "acc-1", serverId: "bar", username: "alice" }]);
    expect(plan.reKey).toEqual([
      { from: { serverId: "row-uuid", username: "alice" }, to: { serverId: "bar", username: "alice" } },
    ]);
  });

  it("keeps an unknown server as custom (reusing its id) with no re-key", () => {
    const plan = planMigration(
      { servers: [row({ id: "lan-1", host: "10.0.0.5", port: 8200, name: "LAN", username: "bob" })] },
      ids(),
    );
    expect(plan.customServers).toEqual([
      { id: "lan-1", name: "LAN", host: "10.0.0.5", port: 8200, tls: false, allowSelfSigned: false },
    ]);
    expect(plan.accounts).toEqual([{ id: "acc-1", serverId: "lan-1", username: "bob" }]);
    expect(plan.reKey).toEqual([]);
  });

  it("matches BAR SSL by port 8201", () => {
    const plan = planMigration(
      { servers: [row({ host: "server4.beyondallreason.info", port: 8201, tls: true, username: "carol" })] },
      ids(),
    );
    expect(plan.accounts[0].serverId).toBe("bar-ssl");
  });

  it("emits a server but no account when the row has no username", () => {
    const plan = planMigration(
      { servers: [row({ id: "lan-2", host: "10.0.0.6" })] },
      ids(),
    );
    expect(plan.customServers).toHaveLength(1);
    expect(plan.accounts).toEqual([]);
    expect(plan.reKey).toEqual([]);
  });

  it("emits nothing for a catalog-matched row with no username", () => {
    const plan = planMigration(
      { servers: [row({ host: "lobby.springrts.com", port: 8200 })] },
      ids(),
    );
    expect(plan).toEqual({ customServers: [], accounts: [], reKey: [] });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run test src/lobby-servers/migration.test.ts`
Expected: FAIL — cannot find module `./migration`.

- [ ] **Step 3: Write `migration.ts`**

Create `src/lobby-servers/migration.ts`:

```ts
import { BUILTIN_SERVERS, type LobbyAccount, type LobbyServer } from "./config";

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
 * Per row: a host+port match against `BUILTIN_SERVERS` points the account at the
 * built-in id (and re-keys the secret from the old row id to the built-in id).
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
      (b) => b.host === row.host && b.port === row.port,
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun run test src/lobby-servers/migration.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lobby-servers/migration.ts src/lobby-servers/migration.test.ts
git commit -m "feat(lobby): pure migration planner for server/account split"
```

---

## Task 3: Server-picker OptionSelect wrapper

**Files:**
- Create: `src/lobby-servers/pages/components/OptionSelect.tsx`

- [ ] **Step 1: Create the wrapper**

This mirrors the existing per-plugin `OptionSelect` (e.g. `src/uberstress/pages/components/OptionSelect.tsx`). Create `src/lobby-servers/pages/components/OptionSelect.tsx`:

```tsx
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

/**
 * Thin wrapper over the shadcn `Select` (from the `@picoframe` registry) for the
 * "pick one option" case — used by the account row's server picker. Composes the
 * registry primitive rather than re-implementing it.
 */
export function OptionSelect({
  value,
  onValueChange,
  options,
  placeholder,
  disabled,
  className,
  size,
}: {
  value: string;
  onValueChange: (value: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  size?: "sm" | "default";
}) {
  return (
    <Select value={value} onValueChange={onValueChange} disabled={disabled}>
      <SelectTrigger size={size} className={cn("w-full", className)}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/lobby-servers/pages/components/OptionSelect.tsx
git commit -m "feat(lobby): add server-picker OptionSelect wrapper"
```

---

## Task 4: Account-based connect + settings/topbar rewrite (atomic)

This is one commit: removing `username` from `LobbyServer` and changing `connect`/`serverKeyFor` are type-driven changes that break every consumer at once, so the store, both consumers, and the config cleanup must land together to keep `typecheck` green.

**Files:**
- Modify: `src/lobby-servers/config.ts` (remove legacy exports + `username`)
- Modify: `src/multiplayer/store.tsx`
- Modify: `src/multiplayer/LobbyStatusButton.tsx`
- Modify: `src/lobby-servers/pages/SettingsSection.tsx` (full rewrite)

- [ ] **Step 1: Remove the legacy config exports and the `username` field**

In `src/lobby-servers/config.ts`: delete the `username?` line from `LobbyServer`, and delete the entire "Legacy" block (`LobbyServerDir`, `defaultLobbyServerDir`, `useLobbyServers`). The `LobbyServer` interface's `builtin?` line stays. Result — the interface ends at:

```ts
  /** True for built-in catalog entries. Absent on user-defined custom servers. */
  builtin?: boolean;
}
```

and the file ends after `useLobbyAccounts` (no legacy block).

- [ ] **Step 2: Update `serverKeyFor` and `connect` in the store**

In `src/multiplayer/store.tsx`:

Change `serverKeyFor` (around line 33) to take an explicit username:

```ts
export function serverKeyFor(server: LobbyServer, username: string): string {
  return `${username}@${server.host}:${server.port}`;
}
```

Change the context type (around line 138) from:

```ts
  /** Open a connection to `server` (throws on missing username/password). */
  connect: (server: LobbyServer) => Promise<void>;
```

to:

```ts
  /** Open a connection as `username` to `server` (throws if no stored password). */
  connect: (server: LobbyServer, username: string) => Promise<void>;
```

Replace the `connect` implementation (around lines 283-326) with:

```ts
  const connect = useCallback(
    async (server: LobbyServer, username: string) => {
      setBusy(true);
      const serverKey = serverKeyFor(server, username);
      try {
        const cred = await lsGetCredential({ serverId: server.id, username });
        if (!cred.secret) {
          throw new Error(
            "No stored password for this login (set one in Settings).",
          );
        }

        const onEvent = openChannel(serverKey);

        dispatch({ type: "connecting" });
        await mpConnect({
          serverKey,
          host: server.host,
          port: server.port,
          tls: server.tls,
          allowSelfSigned: server.allowSelfSigned,
          username,
          password: cred.secret,
          compatFlags: ["u", "sp"],
          onEvent,
        });
        const snap = await mpSnapshot({ serverKey });
        dispatch({ type: "snapshot", state: snap.state });
        setActiveKey(serverKey);
        setLoginPopoverOpen(false);
      } finally {
        setBusy(false);
      }
    },
    [openChannel],
  );
```

- [ ] **Step 3: Rewrite `LobbyStatusButton.tsx` to accounts**

Replace `src/multiplayer/LobbyStatusButton.tsx` with:

```tsx
import { Button } from "@picoframe/frame";
import { Loader2, Plus, Users } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  type LobbyAccount,
  resolveServer,
  useCustomServers,
  useLobbyAccounts,
} from "../lobby-servers/config";
import { useMultiplayer } from "./store";

type DotStatus = "off" | "connecting" | "on" | "error";

const DOT_CLASS: Record<DotStatus, string> = {
  off: "bg-muted-foreground/50",
  connecting: "bg-amber-500 animate-pulse",
  on: "bg-green-500",
  error: "bg-destructive",
};

const LABEL: Record<DotStatus, string> = {
  off: "Multiplayer: log in",
  connecting: "Multiplayer: connecting",
  on: "Multiplayer: connected",
  error: "Multiplayer: connection error",
};

/**
 * topbar.right slot: an icon button that shows lobby connection status via a dot
 * and opens a popover to connect / view status / log out. Hidden entirely when no
 * login is configured and nothing is connected. The open state is controlled by
 * MultiplayerContext so not-connected CTAs elsewhere can open this same popover.
 */
export default function LobbyStatusButton() {
  const [accountsCfg] = useLobbyAccounts();
  const {
    mirror,
    activeKey,
    busy,
    loginPopoverOpen,
    openLoginPopover,
    closeLoginPopover,
  } = useMultiplayer();

  const hasAccounts = accountsCfg.accounts.length > 0;
  if (!hasAccounts && activeKey == null) return null;

  let status: DotStatus = "off";
  if (activeKey != null) {
    status = mirror.phase === "ready" ? "on" : "connecting";
  } else if (busy) {
    status = "connecting";
  } else if (mirror.error || mirror.phase === "denied") {
    status = "error";
  }

  return (
    <Popover
      open={loginPopoverOpen}
      onOpenChange={(o) => (o ? openLoginPopover() : closeLoginPopover())}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={LABEL[status]}
          className="relative flex size-8 items-center justify-center rounded-md hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
        >
          <Users className="size-4" />
          <span
            className={cn(
              "absolute right-1 top-1 size-2 rounded-full ring-2 ring-background",
              DOT_CLASS[status],
            )}
          />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72">
        <LoginPanel onNavigate={closeLoginPopover} />
      </PopoverContent>
    </Popover>
  );
}

export function LoginPanel({ onNavigate }: { onNavigate: () => void }) {
  const [accountsCfg] = useLobbyAccounts();
  const [customCfg] = useCustomServers();
  const accounts = accountsCfg.accounts;
  const { mirror, activeKey, revealed, busy, connect, disconnect } =
    useMultiplayer();

  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<LobbyAccount | null>(null);

  async function connectTo(account: LobbyAccount) {
    setError(null);
    setPending(account);
    try {
      const server = resolveServer(account.serverId, customCfg.servers);
      if (!server) {
        throw new Error("This login's server no longer exists (check Settings).");
      }
      await connect(server, account.username);
    } catch (e) {
      setError(String(e));
    } finally {
      setPending(null);
    }
  }

  async function onDisconnect() {
    setError(null);
    try {
      await disconnect();
    } catch (e) {
      setError(String(e));
    }
  }

  if (activeKey != null) {
    const username = mirror.state?.myUsername ?? "Connected";
    const ready = mirror.phase === "ready";
    return (
      <div className="flex flex-col gap-3">
        <div>
          <p className="text-sm font-medium">{username}</p>
          <p className="truncate text-xs text-muted-foreground">
            {ready ? activeKey : `Connecting… (${mirror.phase ?? "…"})`}
          </p>
        </div>
        <Link
          to="/chat"
          onClick={onNavigate}
          className="inline-flex h-8 items-center justify-center rounded-md border border-border text-sm font-medium hover:bg-muted"
        >
          Chat
        </Link>
        <Button onClick={onDisconnect} disabled={busy} className="h-8">
          Log out
        </Button>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    );
  }

  if (busy) {
    const label = pending?.username ?? "server";
    return (
      <div className="flex flex-col items-center gap-3 py-4">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
        <div className="text-center">
          <p className="text-sm font-medium">Connecting…</p>
          <p className="text-xs text-muted-foreground">{label}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <p className="px-2 pb-1 text-sm font-medium">
        {revealed ? "Reconnect to multiplayer" : "Connect to multiplayer"}
      </p>
      {accounts.map((a) => {
        const server = resolveServer(a.serverId, customCfg.servers);
        return (
          <button
            key={a.id}
            type="button"
            onClick={() => connectTo(a)}
            disabled={busy}
            className="flex flex-col items-start rounded-md px-2 py-1.5 text-left hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
          >
            <span className="text-base font-semibold leading-tight">
              {a.username || "(no username)"}
            </span>
            <span className="text-xs text-muted-foreground">
              {server?.name ?? "Unknown server"}
            </span>
          </button>
        );
      })}
      <Link
        to="/settings/lobby-servers"
        onClick={onNavigate}
        className="mt-1 flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <Plus className="size-4" />
        Add a login
      </Link>
      {error && <p className="px-2 pt-1 text-xs text-destructive">{error}</p>}
      {mirror.error && (
        <p className="px-2 pt-1 text-xs text-destructive">
          Disconnected: {mirror.error}
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Rewrite `SettingsSection.tsx` to Accounts + Servers**

Replace `src/lobby-servers/pages/SettingsSection.tsx` with:

```tsx
import { Button, cn, Input } from "@picoframe/frame";
import { Plus, Server, Terminal, Trash2, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { ConsoleDrawer } from "../../multiplayer/ConsoleDrawer";
import { serverKeyFor, useMultiplayer } from "../../multiplayer/store";
import {
  lsDeleteCredential,
  lsGetCredential,
  lsStoreCredential,
} from "../bindings";
import {
  allServers,
  type LobbyAccount,
  type LobbyServer,
  useCustomServers,
  useLobbyAccounts,
} from "../config";
import { CheckField, Field } from "./components/Field";
import { OptionSelect } from "./components/OptionSelect";

const H2_CLASS =
  "flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground";
const EMPTY_CLASS =
  "rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground";

/**
 * The lobby-servers settings section (`/settings/lobby-servers`). Splits into
 * Accounts (logins the user manages) and Servers (a read-only built-in catalog plus
 * editable custom servers). Directory fields persist immediately via the frame
 * settings store; passwords live only in the OS keychain (`ls_*_credential`).
 */
export default function LobbyServersSettings() {
  const [accountsCfg, setAccountsCfg] = useLobbyAccounts();
  const [customCfg, setCustomCfg] = useCustomServers();
  const [consoleOpen, setConsoleOpen] = useState(false);

  const servers = allServers(customCfg.servers);

  const addAccount = () =>
    setAccountsCfg({
      accounts: [
        ...accountsCfg.accounts,
        { id: crypto.randomUUID(), serverId: servers[0]?.id ?? "", username: "" },
      ],
    });

  const updateAccount = (id: string, patch: Partial<LobbyAccount>) =>
    setAccountsCfg({
      accounts: accountsCfg.accounts.map((a) =>
        a.id === id ? { ...a, ...patch } : a,
      ),
    });

  const removeAccount = (a: LobbyAccount) => {
    setAccountsCfg({
      accounts: accountsCfg.accounts.filter((x) => x.id !== a.id),
    });
    lsDeleteCredential({ serverId: a.serverId, username: a.username }).catch(
      () => {
        // best-effort cleanup; a leftover keychain entry is harmless
      },
    );
  };

  const addCustomServer = () =>
    setCustomCfg({
      servers: [
        ...customCfg.servers,
        {
          id: crypto.randomUUID(),
          name: "",
          host: "",
          port: 8200,
          tls: false,
          allowSelfSigned: false,
        },
      ],
    });

  const updateCustomServer = (id: string, patch: Partial<LobbyServer>) =>
    setCustomCfg({
      servers: customCfg.servers.map((s) =>
        s.id === id ? { ...s, ...patch } : s,
      ),
    });

  const removeCustomServer = (s: LobbyServer) => {
    // Drop accounts pointing at this server (and best-effort delete their secrets).
    for (const a of accountsCfg.accounts.filter((x) => x.serverId === s.id)) {
      lsDeleteCredential({ serverId: a.serverId, username: a.username }).catch(
        () => {},
      );
    }
    setAccountsCfg({
      accounts: accountsCfg.accounts.filter((a) => a.serverId !== s.id),
    });
    setCustomCfg({ servers: customCfg.servers.filter((x) => x.id !== s.id) });
  };

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className={H2_CLASS}>
            <Users size={15} /> Accounts
          </h2>
          <Button
            variant="outline"
            size="sm"
            onClick={addAccount}
            disabled={servers.length === 0}
          >
            <Plus /> Add login
          </Button>
        </div>
        {accountsCfg.accounts.length === 0 ? (
          <p className={EMPTY_CLASS}>
            No logins yet. Add one to connect to a lobby.
          </p>
        ) : (
          <ul className="space-y-4">
            {accountsCfg.accounts.map((a) => (
              <AccountRow
                key={a.id}
                account={a}
                servers={servers}
                onChange={(patch) => updateAccount(a.id, patch)}
                onRemove={() => removeAccount(a)}
                onOpenConsole={() => setConsoleOpen(true)}
              />
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className={H2_CLASS}>
            <Server size={15} /> Servers
          </h2>
          <Button variant="outline" size="sm" onClick={addCustomServer}>
            <Plus /> Add custom server
          </Button>
        </div>
        <ul className="space-y-2">
          {servers
            .filter((s) => s.builtin)
            .map((s) => (
              <BuiltinServerRow key={s.id} server={s} />
            ))}
        </ul>
        {customCfg.servers.length > 0 && (
          <ul className="space-y-4">
            {customCfg.servers.map((s) => (
              <CustomServerRow
                key={s.id}
                server={s}
                onChange={(patch) => updateCustomServer(s.id, patch)}
                onRemove={() => removeCustomServer(s)}
              />
            ))}
          </ul>
        )}
      </section>

      <ConsoleDrawer open={consoleOpen} onClose={() => setConsoleOpen(false)} />
    </div>
  );
}

/**
 * One login. `serverId`/`username` persist through the parent; the password lives in
 * local state and syncs to the keychain (keyed by `{serverId, username}`) on blur.
 */
function AccountRow({
  account: a,
  servers,
  onChange,
  onRemove,
  onOpenConsole,
}: {
  account: LobbyAccount;
  servers: LobbyServer[];
  onChange: (patch: Partial<LobbyAccount>) => void;
  onRemove: () => void;
  onOpenConsole: () => void;
}) {
  const [password, setPassword] = useState("");
  const [saved, setSaved] = useState<boolean | null>(null);
  const server = servers.find((s) => s.id === a.serverId);

  // At most one account is "connected" — the one whose key matches `activeKey`.
  const { mirror, activeKey } = useMultiplayer();
  const connected =
    mirror.connected &&
    server != null &&
    activeKey === serverKeyFor(server, a.username);
  const onlineCount = connected
    ? Object.keys(mirror.state?.users ?? {}).length
    : 0;

  // On mount / key change, reflect whether a secret exists (never show plaintext).
  useEffect(() => {
    lsGetCredential({ serverId: a.serverId, username: a.username })
      .then(({ secret }) => setSaved(secret != null))
      .catch(() => setSaved(null));
  }, [a.serverId, a.username]);

  const savePassword = () => {
    if (password === "") return;
    lsStoreCredential({
      serverId: a.serverId,
      username: a.username,
      secret: password,
    })
      .then(() => setSaved(true))
      .catch(() => setSaved(false));
  };

  return (
    <li className="space-y-3 rounded-md border border-border p-3">
      <div className="flex items-center gap-2">
        {connected && (
          <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <span className="size-2 rounded-full bg-emerald-500" aria-hidden />
            Connected · {onlineCount} online
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {connected && (
            <Button
              variant="outline"
              size="sm"
              onClick={onOpenConsole}
              aria-label="Open protocol console"
            >
              <Terminal />
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={onRemove}
            aria-label={`Remove ${a.username || "login"}`}
          >
            <Trash2 />
          </Button>
        </div>
      </div>
      <Field label="Server">
        <OptionSelect
          value={a.serverId}
          onValueChange={(v) => onChange({ serverId: v })}
          options={servers.map((s) => ({
            value: s.id,
            label: s.builtin ? s.name : `${s.name || s.host} (custom)`,
          }))}
          placeholder="Select a server"
        />
      </Field>
      <Field label="Username">
        <Input
          value={a.username}
          onChange={(e) => onChange({ username: e.target.value })}
        />
      </Field>
      <Field
        label="Password"
        hint={saved === null ? undefined : saved ? "Saved in keychain" : "Not set"}
      >
        <Input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onBlur={savePassword}
          placeholder={saved ? "•••••••• (saved)" : ""}
        />
      </Field>
    </li>
  );
}

/** A read-only built-in catalog entry. */
function BuiltinServerRow({ server: s }: { server: LobbyServer }) {
  const tag =
    "rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground";
  return (
    <li className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm">
      <span className="font-medium">{s.name}</span>
      <span className="font-mono text-xs text-muted-foreground">
        {s.host}:{s.port}
      </span>
      {s.tls && <span className={tag}>TLS</span>}
      <span className={cn("ml-auto", tag)}>Built-in</span>
    </li>
  );
}

/** An editable custom server (no username/password — those belong to accounts). */
function CustomServerRow({
  server: s,
  onChange,
  onRemove,
}: {
  server: LobbyServer;
  onChange: (patch: Partial<LobbyServer>) => void;
  onRemove: () => void;
}) {
  return (
    <li className="space-y-3 rounded-md border border-border p-3">
      <div className="flex items-center justify-end">
        <Button
          variant="outline"
          size="sm"
          onClick={onRemove}
          aria-label={`Remove ${s.name || s.host || "server"}`}
        >
          <Trash2 />
        </Button>
      </div>
      <Field label="Name">
        <Input
          value={s.name}
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder="My server"
        />
      </Field>
      <div className="grid grid-cols-3 gap-2">
        <Field label="Host" className="col-span-2">
          <Input
            value={s.host}
            onChange={(e) => onChange({ host: e.target.value })}
            placeholder="lobby.example.org"
            className="font-mono text-xs"
          />
        </Field>
        <Field label="Port">
          <Input
            type="number"
            value={s.port}
            onChange={(e) => onChange({ port: Number(e.target.value) })}
          />
        </Field>
      </div>
      <div className="flex flex-col gap-2">
        <CheckField
          label="Use TLS"
          checked={s.tls}
          onChange={(v) => onChange({ tls: v })}
        />
        <CheckField
          label="Allow self-signed certificate"
          hint="uberserver ships one; teiserver does not."
          checked={s.allowSelfSigned}
          onChange={(v) => onChange({ allowSelfSigned: v })}
        />
      </div>
    </li>
  );
}
```

- [ ] **Step 5: Typecheck + run all unit tests**

Run: `bun run typecheck`
Expected: PASS. If it reports `Property 'username' does not exist on type 'LobbyServer'`, a consumer still reads the removed field — fix that call site.

Run: `bun run test`
Expected: PASS (config + migration + existing multiplayer tests unaffected).

- [ ] **Step 6: Commit**

```bash
git add src/lobby-servers/config.ts src/multiplayer/store.tsx src/multiplayer/LobbyStatusButton.tsx src/lobby-servers/pages/SettingsSection.tsx
git commit -m "feat(lobby): split servers from accounts across store + settings UI"
```

---

## Task 5: One-time migration wiring

**Files:**
- Create: `src/lobby-servers/LobbyServersProvider.tsx`
- Modify: `src/lobby-servers/index.ts`

- [ ] **Step 1: Create the provider that runs the migration once**

Create `src/lobby-servers/LobbyServersProvider.tsx`:

```tsx
import { useSetting } from "@picoframe/frame";
import { type ReactNode, useEffect, useRef } from "react";
import {
  lsDeleteCredential,
  lsGetCredential,
  lsStoreCredential,
} from "./bindings";
import { useCustomServers, useLobbyAccounts } from "./config";
import { type LegacyLobbyServerDir, planMigration } from "./migration";

/**
 * App-level provider (registered via the plugin's `Provider`) that runs the one-time
 * migration from the old `lobbyServers.directory` into the server/account model,
 * guarded by a `lobbyServers.migratedV2` flag so it runs at most once.
 */
export function LobbyServersProvider({ children }: { children: ReactNode }) {
  useLobbyServersMigration();
  return <>{children}</>;
}

function useLobbyServersMigration() {
  const [migrated, setMigrated] = useSetting("lobbyServers.migratedV2", false);
  const [oldDir] = useSetting<LegacyLobbyServerDir>("lobbyServers.directory", {
    servers: [],
  });
  const [, setCustom] = useCustomServers();
  const [, setAccounts] = useLobbyAccounts();
  const ranRef = useRef(false);

  useEffect(() => {
    if (migrated || ranRef.current) return;
    ranRef.current = true;

    const plan = planMigration(oldDir, () => crypto.randomUUID());
    setCustom({ servers: plan.customServers });
    setAccounts({ accounts: plan.accounts });

    (async () => {
      // Best-effort: a failed keychain move just means that login needs its
      // password re-entered — it does not block the rest of the migration.
      for (const move of plan.reKey) {
        try {
          const { secret } = await lsGetCredential(move.from);
          if (secret != null) {
            await lsStoreCredential({ ...move.to, secret });
            await lsDeleteCredential(move.from);
          }
        } catch (e) {
          console.warn("lobby migration: keychain move failed", move, e);
        }
      }
      setMigrated(true);
    })();
  }, [migrated, oldDir, setCustom, setAccounts, setMigrated]);
}
```

- [ ] **Step 2: Register the provider in the plugin**

In `src/lobby-servers/index.ts`, import the provider and add it to the plugin object:

```tsx
import type { FramePlugin } from "@picoframe/plugin-sdk";
import { ServerCog } from "lucide-react";
import { LobbyServersProvider } from "./LobbyServersProvider";
import LobbyServersSettings from "./pages/SettingsSection";

/**
 * The lobby-servers plugin's frontend half: a settings section owning the server
 * catalog + accounts + keychain-backed credentials (`/settings/lobby-servers`), and
 * an app-level Provider that runs the one-time directory→accounts migration. Paired
 * with the `tauri-plugin-coilbox-lobby-servers` crate (ACL id `coilbox-lobby-servers`).
 */
const lobbyServersPlugin: FramePlugin = {
  id: "lobby-servers",
  version: "0.0.0",
  routes: [],
  Provider: LobbyServersProvider,
  settings: [
    {
      id: "lobby-servers",
      title: "Lobby servers",
      icon: ServerCog,
      Component: LobbyServersSettings,
    },
  ],
};

export default lobbyServersPlugin;
```

If `FramePlugin` has no `Provider` field (TS error), confirm the property name used by `src/multiplayer/index.ts:97` (`Provider: MultiplayerProvider`) and match it exactly.

- [ ] **Step 3: Typecheck**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/lobby-servers/LobbyServersProvider.tsx src/lobby-servers/index.ts
git commit -m "feat(lobby): one-time migration from directory to accounts"
```

---

## Task 6: Full verification + live smoke

**Files:** none (verification only)

- [ ] **Step 1: Frontend static checks (the exact commands CI runs)**

Run: `bun run typecheck`
Expected: PASS.

Run: `bunx biome ci .`
Expected: PASS. If it flags the `cn_ml_auto` helper or an unused import, resolve per the note in Task 4 Step 4.

Run: `bun run test`
Expected: PASS (all suites).

- [ ] **Step 2: Rust static checks (untouched, but CI runs both)**

Run: `cargo fmt --all --check`
Expected: PASS.

Run: `cargo clippy --all-targets --all-features -- -D warnings`
Expected: PASS. (Requires the unitsync sidecar per CLAUDE.md: `bun run sidecar:unitsync` first if clippy fails to build the app crate.)

- [ ] **Step 3: Live smoke — new UI + connect**

Run: `bun tauri dev`

Verify in Settings → Lobby servers:
- The **Servers** section lists the four built-ins (Spring Official, Tech Annihilation, Beyond All Reason, Beyond All Reason (SSL)) as read-only rows, with the SSL row showing a TLS tag.
- **Add custom server** appends an editable server row; fill host/port and confirm it appears in the account server picker.
- **Add login** appends an account row; pick a server, enter a username, type a password, blur → hint reads "Saved in keychain". Reopen the page → hint still "Saved in keychain" (secret persisted), password field blank.
- The topbar Users button appears once an account exists; its popover lists the account (username + server name). Clicking it connects; on success the account row shows the "Connected · N online" badge and the protocol-console button.

- [ ] **Step 4: Live smoke — migration (optional manual seed)**

Migration is covered by `migration.test.ts`; to spot-check end-to-end, before launching seed an old directory via the running app's devtools console (tauri-mcp `execute_js` or the webview devtools), writing a `lobbyServers.directory` value with one catalog-matching row (host `server4.beyondallreason.info`, port 8200, a username) and one custom row, plus clearing `lobbyServers.migratedV2`, then reload. Confirm the catalog row becomes a login on "Beyond All Reason", the custom row appears under Servers with its own login, and (if a secret was stored under the old id) the login shows "Saved in keychain". If seeding the store isn't practical, note that migration was verified by unit test only.

- [ ] **Step 5: Final commit (only if lint fixups were needed)**

Stage the specific files you changed (do not use `git add -A`/`-u` — repo hooks guard against it), e.g.:

```bash
git add src/lobby-servers/pages/SettingsSection.tsx
git commit -m "chore(lobby): lint/format fixups"
```

---

## Notes for the implementer

- **Keychain key is unchanged** (`{serverId, username}`), so no Rust edits and no new plugin-command permissions.
- **Editing an account's server/username orphans the old keychain secret** (harmless leftover), same as the pre-existing behavior when editing a username. Don't add cleanup for it — out of scope.
- **Deleting a custom server** cascades to its accounts + their secrets (handled in `removeCustomServer`). Built-in servers can't be deleted.
- **Do not** collapse BAR's two catalog entries into one TLS toggle — the two-entry form is intentional (matches SkyLobby and keeps each a distinct connection target).
