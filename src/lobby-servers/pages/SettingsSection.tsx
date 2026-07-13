import { Button, cn, Input, useSetting } from "@picoframe/frame";
import {
  Plus,
  RefreshCw,
  Server,
  Terminal,
  Trash2,
  UserPlus,
  Users,
} from "lucide-react";
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
import { RegisterForm } from "../RegisterForm";
import { AutojoinChannels } from "./components/AutojoinChannels";
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
  const [registerOpen, setRegisterOpen] = useState(false);
  const [autoRejoin, setAutoRejoin] = useSetting<boolean>(
    "multiplayer.autoRejoin",
    true,
  );

  const servers = allServers(customCfg.servers);

  const addAccount = () =>
    setAccountsCfg({
      accounts: [
        ...accountsCfg.accounts,
        {
          id: crypto.randomUUID(),
          serverId: servers[0]?.id ?? "",
          username: "",
        },
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
        <h2 className={H2_CLASS}>
          <RefreshCw size={15} /> Connection
        </h2>
        <div className="rounded-md border border-border p-3">
          <CheckField
            label="Reconnect automatically"
            hint="If the server drops the connection, rejoin your channels and last battle automatically."
            checked={autoRejoin}
            onChange={setAutoRejoin}
          />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className={H2_CLASS}>
          <Users size={15} /> Accounts
        </h2>
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
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setRegisterOpen((o) => !o)}
            disabled={servers.length === 0}
          >
            <UserPlus /> Register
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={addAccount}
            disabled={servers.length === 0}
          >
            <Plus /> Add login
          </Button>
        </div>
        {registerOpen && (
          <div className="space-y-3 rounded-md border border-border p-3">
            <p className="text-sm font-medium">Create a new account</p>
            <RegisterForm
              servers={servers}
              onSuccess={() => setRegisterOpen(false)}
              onCancel={() => setRegisterOpen(false)}
            />
          </div>
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
        hint={
          saved === null ? undefined : saved ? "Saved in keychain" : "Not set"
        }
      >
        <Input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onBlur={savePassword}
          placeholder={saved ? "•••••••• (saved)" : ""}
        />
      </Field>
      {server && a.username.trim() !== "" && (
        <AutojoinChannels serverKey={serverKeyFor(server, a.username)} />
      )}
    </li>
  );
}

/**
 * A read-only catalog entry: a built-in preset or the profile's official server. Both
 * are non-removable (no trash button); the official one is badged and listed first
 * (see `buildCatalog`).
 */
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
      {s.official ? (
        <span
          className={cn(
            "ml-auto rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary",
          )}
        >
          Official
        </span>
      ) : (
        <span className={cn("ml-auto", tag)}>Built-in</span>
      )}
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
