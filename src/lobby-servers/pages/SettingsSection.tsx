import { Button, cn, Input, useSetting } from "@picoframe/frame";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  ExternalLink,
  Plus,
  RefreshCw,
  Server,
  ServerCog,
  Terminal,
  Trash2,
  TriangleAlert,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  AUTO_AWAY_ENABLED_KEY,
  AUTO_AWAY_MINUTES_KEY,
  clampAwayMinutes,
  DEFAULT_AUTO_AWAY_MINUTES,
  MAX_AUTO_AWAY_MINUTES,
  MIN_AUTO_AWAY_MINUTES,
} from "../../multiplayer/awayStatus";
import { mpTachyonSignOut } from "../../multiplayer/bindings";
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
  serverProtocol,
  type TlsStyle,
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
 * uberserver: the lobby server behind lobby.recoilengine.org. This fork rather than
 * `spring/uberserver` upstream, because its readme is a start-to-finish deployment
 * guide (Docker Compose, MariaDB, systemd) rather than a bare install list.
 */
const UBERSERVER_URL = "https://github.com/ScarylePoo/uberserver";

/**
 * The lobby-servers settings section (`/settings/lobby-servers`). Splits into
 * Accounts (logins the user manages) and Servers (one list of built-ins and the
 * user's own, the latter editable through a drawer). Fields persist immediately via
 * the frame settings store. Passwords live only in the OS keychain
 * (`ls_*_credential`).
 */
export default function LobbyServersSettings() {
  const [accountsCfg, setAccountsCfg] = useLobbyAccounts();
  const [customCfg, setCustomCfg] = useCustomServers();
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [registerOpen, setRegisterOpen] = useState(false);
  // The account whose editor drawer is open (null = closed).
  const [editingId, setEditingId] = useState<string | null>(null);
  // The custom server whose editor drawer is open (null = closed). Built-ins never
  // open one, so this only ever holds a custom server's id.
  const [editingServerId, setEditingServerId] = useState<string | null>(null);
  const [autoRejoin, setAutoRejoin] = useSetting<boolean>(
    "multiplayer.autoRejoin",
    true,
  );
  const [autoConnect, setAutoConnect] = useSetting<boolean>(
    "multiplayer.autoConnect",
    false,
  );
  const [autoAway, setAutoAway] = useSetting<boolean>(
    AUTO_AWAY_ENABLED_KEY,
    true,
  );
  const [awayMinutes, setAwayMinutes] = useSetting<number>(
    AUTO_AWAY_MINUTES_KEY,
    DEFAULT_AUTO_AWAY_MINUTES,
  );

  const servers = allServers(customCfg.servers);

  const addAccount = () => {
    const id = crypto.randomUUID();
    setAccountsCfg({
      accounts: [
        ...accountsCfg.accounts,
        {
          id,
          serverId: servers[0]?.id ?? "",
          username: "",
          hasSecret: false,
        },
      ],
    });
    // A blank login is only editable through its drawer, so open it straight away.
    setEditingId(id);
  };

  const updateAccount = (id: string, patch: Partial<LobbyAccount>) =>
    setAccountsCfg({
      accounts: accountsCfg.accounts.map((a) =>
        a.id === id ? { ...a, ...patch } : a,
      ),
    });

  const removeAccount = (a: LobbyAccount) => {
    if (editingId === a.id) setEditingId(null);
    setAccountsCfg({
      accounts: accountsCfg.accounts.filter((x) => x.id !== a.id),
    });
    lsDeleteCredential({ serverId: a.serverId, username: a.username }).catch(
      () => {
        // best-effort cleanup; a leftover keychain entry is harmless
      },
    );
  };

  const addCustomServer = () => {
    const id = crypto.randomUUID();
    setCustomCfg({
      servers: [
        ...customCfg.servers,
        {
          id,
          name: "",
          host: "",
          port: 8200,
          tls: false,
          allowSelfSigned: false,
        },
      ],
    });
    // A blank server is only editable through its drawer, so open it straight away.
    setEditingServerId(id);
  };

  const updateCustomServer = (id: string, patch: Partial<LobbyServer>) =>
    setCustomCfg({
      servers: customCfg.servers.map((s) =>
        s.id === id ? { ...s, ...patch } : s,
      ),
    });

  const removeCustomServer = (s: LobbyServer) => {
    if (editingServerId === s.id) setEditingServerId(null);
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
    // `pb-8` so the last section clears the bottom of the scroll area rather than
    // ending flush against it.
    <div className="space-y-8 pb-8">
      <section className="space-y-3">
        <h2 className={H2_CLASS}>
          <RefreshCw size={15} /> Connection
        </h2>
        <div className="space-y-3 rounded-md border border-border p-3">
          <CheckField
            label="Connect automatically on startup"
            hint="When Coilbox starts, log in to your last-used account without opening the topbar."
            checked={autoConnect}
            onChange={setAutoConnect}
          />
          <CheckField
            label="Reconnect automatically"
            hint="If the server drops the connection, rejoin your channels and last battle automatically."
            checked={autoRejoin}
            onChange={setAutoRejoin}
          />
          <CheckField
            label="Set me away when idle"
            hint="Show as away to everyone else after a spell without input. Using Coilbox again clears it. Away you set by hand stays until you clear it."
            checked={autoAway}
            onChange={setAutoAway}
          />
          {autoAway && (
            <Field
              label="Minutes before away"
              // The cap belongs on the input, not the field: on the field it also
              // caps the label and hint, which wraps them at 10rem.
              className="pl-6"
              hint={`${MIN_AUTO_AWAY_MINUTES} to ${MAX_AUTO_AWAY_MINUTES}.`}
            >
              <Input
                className="max-w-40"
                type="number"
                min={MIN_AUTO_AWAY_MINUTES}
                max={MAX_AUTO_AWAY_MINUTES}
                value={awayMinutes}
                onChange={(e) => setAwayMinutes(Number(e.target.value))}
                // Half-typed values are usable while typing and corrected on the
                // way out, so the field can never be left showing what it isn't.
                onBlur={() => setAwayMinutes(clampAwayMinutes(awayMinutes))}
              />
            </Field>
          )}
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
          <ul className="space-y-2">
            {accountsCfg.accounts.map((a) => (
              <AccountListRow
                key={a.id}
                account={a}
                servers={servers}
                onOpen={() => setEditingId(a.id)}
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
        {/* One list: `allServers` already returns the built-ins first, then the
            user's own, so custom entries need no separate section. Only they get
            an `onOpen`, which is what makes their row a button. */}
        <ul className="space-y-2">
          {servers.map((s) => (
            <ServerListRow
              key={s.id}
              server={s}
              onOpen={s.builtin ? undefined : () => setEditingServerId(s.id)}
            />
          ))}
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className={H2_CLASS}>
          <ServerCog size={15} /> Host your own server
        </h2>
        <div className="space-y-3 rounded-md border border-dashed border-border p-3">
          <p className="text-xs leading-snug text-muted-foreground">
            Coilbox connects to any TASServer-compatible lobby, including one
            you run yourself. lobby.recoilengine.org runs uberserver, which
            ships a start-to-finish deployment guide using Docker and MariaDB.
            Add yours as a custom server above once it is running.
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => openUrl(UBERSERVER_URL).catch(() => {})}
          >
            <ExternalLink /> Uberserver
          </Button>
        </div>
      </section>

      <RegisterDrawer
        open={registerOpen}
        servers={servers}
        onClose={() => setRegisterOpen(false)}
      />
      <AccountDrawer
        account={accountsCfg.accounts.find((a) => a.id === editingId) ?? null}
        servers={servers}
        onChange={(id, patch) => updateAccount(id, patch)}
        onRemove={removeAccount}
        onOpenConsole={() => setConsoleOpen(true)}
        onClose={() => setEditingId(null)}
      />
      <ServerDrawer
        server={customCfg.servers.find((s) => s.id === editingServerId) ?? null}
        onChange={updateCustomServer}
        onRemove={removeCustomServer}
        onClose={() => setEditingServerId(null)}
      />
      <ConsoleDrawer open={consoleOpen} onClose={() => setConsoleOpen(false)} />
    </div>
  );
}

/** Whether an account is the live connection, and how many users it sees. */
function useAccountConnection(
  a: LobbyAccount,
  server: LobbyServer | undefined,
) {
  const { mirror, activeKey } = useMultiplayer();
  const connected =
    mirror.connected &&
    server != null &&
    activeKey === serverKeyFor(server, a.username);
  const onlineCount = connected
    ? Object.keys(mirror.state?.users ?? {}).length
    : 0;
  return { connected, onlineCount };
}

/**
 * One login in the accounts list: a compact row (username + server, like the login
 * popover) that opens the editor drawer. Editing lives entirely in the drawer.
 */
function AccountListRow({
  account: a,
  servers,
  onOpen,
}: {
  account: LobbyAccount;
  servers: LobbyServer[];
  onOpen: () => void;
}) {
  const server = servers.find((s) => s.id === a.serverId);
  const { connected, onlineCount } = useAccountConnection(a, server);

  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full items-center gap-2 rounded-md border border-border px-3 py-2 text-left hover:bg-accent"
      >
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-semibold leading-tight">
            {a.username || "(no username)"}
          </span>
          <span className="truncate text-xs text-muted-foreground">
            {server?.name ?? "Unknown server"}
          </span>
        </span>
        {connected && (
          <span className="ml-auto flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <span className="size-2 rounded-full bg-emerald-500" aria-hidden />
            Connected · {onlineCount} online
          </span>
        )}
      </button>
    </li>
  );
}

/**
 * The editor drawer for one login (opened by clicking its list row). Same
 * viewport-anchored slide-in as `ConsoleDrawer`. Because opening it is a user
 * action, it's the one place that reads the keychain to verify a secret exists —
 * an OS prompt here is expected, unlike the old always-on per-row check — and it
 * heals the account's persisted `hasSecret` flag with the answer. The password
 * itself lives in local state and syncs to the keychain on blur.
 */
function AccountDrawer({
  account,
  servers,
  onChange,
  onRemove,
  onOpenConsole,
  onClose,
}: {
  account: LobbyAccount | null;
  servers: LobbyServer[];
  onChange: (id: string, patch: Partial<LobbyAccount>) => void;
  onRemove: (a: LobbyAccount) => void;
  onOpenConsole: () => void;
  onClose: () => void;
}) {
  return (
    <SlideDrawer
      open={account != null}
      title={account?.username.trim() ? account.username : "New login"}
      onClose={onClose}
    >
      {account && (
        <AccountForm
          key={account.id}
          account={account}
          servers={servers}
          onChange={(patch) => onChange(account.id, patch)}
          onRemove={() => onRemove(account)}
          onOpenConsole={onOpenConsole}
        />
      )}
    </SlideDrawer>
  );
}

/**
 * Shared shell for this page's slide-in editors (login editor, registration):
 * the same viewport-anchored right drawer as `ConsoleDrawer`, with a titled
 * header and a click-away backdrop. Children mount only while open, so each
 * visit starts fresh. Portalled to `<body>` so `fixed inset-y-0` really means
 * the viewport — a transformed/filtered ancestor would otherwise become the
 * positioning box and cut the drawer short of the window bottom.
 */
function SlideDrawer({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return createPortal(
    <>
      {open && (
        <button
          type="button"
          aria-label={`Close ${title}`}
          className="fixed inset-0 z-40 bg-black/20"
          onClick={onClose}
        />
      )}
      <aside
        className={`fixed inset-y-0 right-0 z-50 flex w-96 max-w-full flex-col border-l border-border bg-background shadow-lg transition-transform motion-reduce:transition-none ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
        inert={!open}
      >
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">{title}</h2>
          <Button className="h-7 px-2" onClick={onClose} aria-label="Close">
            <X className="size-4" />
          </Button>
        </header>
        {open && children}
      </aside>
    </>,
    document.body,
  );
}

/**
 * Account registration in the same slide-in drawer as the login editor, so the
 * whole Accounts section edits through drawers.
 */
function RegisterDrawer({
  open,
  servers,
  onClose,
}: {
  open: boolean;
  servers: LobbyServer[];
  onClose: () => void;
}) {
  return (
    <SlideDrawer open={open} title="Create a new account" onClose={onClose}>
      <div className="flex-1 overflow-y-auto p-4">
        <RegisterForm
          servers={servers}
          onSuccess={onClose}
          onCancel={onClose}
        />
      </div>
    </SlideDrawer>
  );
}

/** The drawer's body: server/username/password fields + channels + actions. */
function AccountForm({
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
  // Seed from the persisted flag for an instant render, then verify against the
  // keychain — a user opened this drawer, so the (macOS) prompt is expected.
  const [saved, setSaved] = useState<boolean | undefined>(a.hasSecret);
  const server = servers.find((s) => s.id === a.serverId);
  const { connected, onlineCount } = useAccountConnection(a, server);

  // Latest patcher behind a ref so the probe effect keys only on the identity
  // fields (a fresh `onChange` closure each render must not re-fire the probe).
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const { serverId, username, hasSecret } = a;
  // biome-ignore lint/correctness/useExhaustiveDependencies: `hasSecret` is the probe's answer, not a trigger — keying on it would re-fire after the heal.
  useEffect(() => {
    lsGetCredential({ serverId, username })
      .then(({ secret }) => {
        const exists = secret != null;
        setSaved(exists);
        if (hasSecret !== exists) onChangeRef.current({ hasSecret: exists });
      })
      .catch(() => {});
  }, [serverId, username]);

  const savePassword = () => {
    if (password === "") return;
    lsStoreCredential({
      serverId: a.serverId,
      username: a.username,
      secret: password,
    })
      .then(() => {
        setSaved(true);
        onChange({ hasSecret: true });
      })
      .catch(() => {
        setSaved(false);
        onChange({ hasSecret: false });
      });
  };

  return (
    <div className="flex-1 space-y-3 overflow-y-auto p-4">
      {connected && (
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <span className="size-2 rounded-full bg-emerald-500" aria-hidden />
            Connected · {onlineCount} online
          </span>
          <Button
            variant="outline"
            size="sm"
            className="ml-auto"
            onClick={onOpenConsole}
            aria-label="Open protocol console"
          >
            <Terminal />
          </Button>
        </div>
      )}
      <Field label="Server">
        <OptionSelect
          value={a.serverId}
          onValueChange={(v) => onChange({ serverId: v })}
          options={servers.map((s) => ({
            value: s.id,
            label: `${s.builtin ? s.name : `${s.name || s.host} (custom)`}${
              s.alpha ? " (alpha)" : ""
            }`,
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
      {serverProtocol(server ?? {}) === "tachyon" ? (
        <TachyonSignIn
          account={a}
          server={server}
          signedIn={saved}
          onChanged={(exists) => {
            setSaved(exists);
            onChange({ hasSecret: exists });
          }}
        />
      ) : (
        <Field
          label="Password"
          hint={
            saved == null ? undefined : saved ? "Saved in keychain" : "Not set"
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
      )}
      {/* A Tachyon server has no named channels, so there is nothing to auto-join
          (see `docs/tachyon-protocol.md`). */}
      {server &&
        serverProtocol(server) !== "tachyon" &&
        a.username.trim() !== "" && (
          <AutojoinChannels serverKey={serverKeyFor(server, a.username)} />
        )}
      <div className="border-t border-border pt-3">
        <Button
          variant="outline"
          size="sm"
          onClick={onRemove}
          aria-label={`Remove ${a.username || "login"}`}
        >
          <Trash2 /> Remove login
        </Button>
      </div>
    </div>
  );
}

/**
 * The Tachyon half of the login editor, in place of the password field.
 *
 * There is nothing to type. The user signs in on the server's own page in their
 * browser and Coilbox keeps what comes back, so the username here is a label for
 * the login rather than a credential, and it has to be set before signing in
 * because it is half the key the token is stored under.
 *
 * Signing out forgets the stored token. That is all a client can do, because the
 * server offers no revocation endpoint (see `docs/tachyon-protocol.md`).
 */
function TachyonSignIn({
  account: a,
  server,
  signedIn,
  onChanged,
}: {
  account: LobbyAccount;
  server: LobbyServer | undefined;
  /** Whether a sign-in is stored, or undefined while that is still unknown. */
  signedIn: boolean | undefined;
  onChanged: (signedIn: boolean) => void;
}) {
  const { signIn, busy } = useMultiplayer();
  const [error, setError] = useState<string | null>(null);
  const named = a.username.trim() !== "";

  const run = async (action: Promise<unknown>, outcome: boolean) => {
    setError(null);
    try {
      await action;
      onChanged(outcome);
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <div className="flex flex-col gap-1.5 text-sm">
      <span className="font-medium leading-none">Sign-in</span>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={busy || server == null || !named}
          onClick={() => {
            if (server) void run(signIn(server, a.username), true);
          }}
        >
          <ExternalLink />
          {signedIn ? "Sign in again" : "Sign in with your browser"}
        </Button>
        {signedIn && (
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() =>
              void run(
                mpTachyonSignOut({
                  serverId: a.serverId,
                  username: a.username,
                }),
                false,
              )
            }
          >
            Sign out
          </Button>
        )}
      </div>
      <span className="text-xs leading-snug text-muted-foreground">
        {!named
          ? "Give this login a username first, so the sign-in has something to belong to."
          : signedIn == null
            ? "Checking whether you are signed in."
            : signedIn
              ? "Signed in. Coilbox holds a token for this login, not a password."
              : "This server has no password. Signing in opens its own page in your browser."}
      </span>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  );
}

/**
 * One row in the server list, for every kind of entry. A custom server passes
 * `onOpen` and so renders as a button into its editor drawer. A built-in and the
 * profile's official server pass nothing and are inert, because changing either
 * takes a code or `profile.json` change rather than a click.
 */
function ServerListRow({
  server: s,
  onOpen,
}: {
  server: LobbyServer;
  onOpen?: () => void;
}) {
  // `shrink-0` matters: without it a long server name squeezes the badges until
  // their own text wraps mid-word.
  const tag =
    "shrink-0 whitespace-nowrap rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground";
  const body = (
    <>
      <div className="flex items-center gap-2">
        <span className="min-w-0 truncate font-medium">
          {s.name || s.host || "New server"}
        </span>
        {s.tls && <span className={tag}>TLS</span>}
        {s.alpha && (
          // Deliberately not the muted `tag` the neighbours use: this one is a
          // warning, so it reads the same here as in the login list.
          <span
            className={cn(
              tag,
              "border border-destructive/40 bg-destructive/15 text-destructive",
            )}
          >
            Alpha
          </span>
        )}
        {s.official ? (
          <span
            className={cn(
              tag,
              "ml-auto bg-primary/15 font-medium text-primary",
            )}
          >
            Official
          </span>
        ) : (
          <span className={cn(tag, "ml-auto")}>
            {s.builtin ? "Built-in" : "Custom"}
          </span>
        )}
      </div>
      <div className="truncate font-mono text-xs text-muted-foreground">
        {s.host ? `${s.host}:${s.port}` : "No address yet"}
      </div>
      {s.notice && (
        <p className="mt-1 flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-400">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {s.notice}
        </p>
      )}
    </>
  );

  const shell = "rounded-md border border-border px-3 py-2 text-sm";
  return (
    <li>
      {onOpen ? (
        <button
          type="button"
          onClick={onOpen}
          className={cn(shell, "block w-full text-left hover:bg-accent")}
        >
          {body}
        </button>
      ) : (
        <div className={shell}>{body}</div>
      )}
    </li>
  );
}

/**
 * The editor drawer for one custom server, in the same slide-in as the login
 * editor. Built-ins never reach it.
 */
function ServerDrawer({
  server,
  onChange,
  onRemove,
  onClose,
}: {
  server: LobbyServer | null;
  onChange: (id: string, patch: Partial<LobbyServer>) => void;
  onRemove: (s: LobbyServer) => void;
  onClose: () => void;
}) {
  return (
    <SlideDrawer
      open={server != null}
      title={server?.name.trim() ? server.name : "New server"}
      onClose={onClose}
    >
      {server && (
        <CustomServerForm
          key={server.id}
          server={server}
          onChange={(patch) => onChange(server.id, patch)}
          onRemove={() => onRemove(server)}
        />
      )}
    </SlideDrawer>
  );
}

/** The drawer's body: one custom server's fields. Usernames and passwords belong to accounts, not here. */
function CustomServerForm({
  server: s,
  onChange,
  onRemove,
}: {
  server: LobbyServer;
  onChange: (patch: Partial<LobbyServer>) => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex-1 space-y-3 overflow-y-auto p-4">
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
        {s.tls && (
          <Field
            label="TLS mode"
            hint="uberserver upgrades in-band on its plain port. teiserver's 8201 is encrypted from the first byte."
          >
            <OptionSelect
              value={s.tlsStyle ?? "stls"}
              onValueChange={(v) => onChange({ tlsStyle: v as TlsStyle })}
              options={[
                { value: "stls", label: "Upgrade with STLS" },
                { value: "direct", label: "Direct (TLS from the first byte)" },
              ]}
            />
          </Field>
        )}
        <CheckField
          label="Allow self-signed certificate"
          hint="uberserver ships one; teiserver does not."
          checked={s.allowSelfSigned}
          onChange={(v) => onChange({ allowSelfSigned: v })}
        />
      </div>
      <div className="border-t border-border pt-3">
        <Button
          variant="outline"
          size="sm"
          onClick={onRemove}
          aria-label={`Remove ${s.name || s.host || "server"}`}
        >
          <Trash2 /> Remove server
        </Button>
      </div>
    </div>
  );
}
