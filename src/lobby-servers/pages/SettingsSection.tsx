import { Button, cn, Input, useSetting } from "@picoframe/frame";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  Check,
  ExternalLink,
  KeyRound,
  Plus,
  RefreshCw,
  Server,
  ServerCog,
  Terminal,
  Trash2,
  TriangleAlert,
  UserPlus,
  Users,
} from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { CheckField, Field } from "@/components/Field";
import { OptionSelect } from "@/components/OptionSelect";
import { SlideDrawer } from "@/components/SlideDrawer";
import { identifierFieldProps } from "@/lib/identifierField";
import { updateStoredSetting } from "@/lib/storedSetting";
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
import {
  serverKeyFor,
  useConnection,
  useMultiplayer,
} from "../../multiplayer/store";
import {
  lsDeleteCredential,
  lsGetCredential,
  lsStoreCredential,
} from "../bindings";
import {
  type AccountsConfig,
  allServers,
  CUSTOM_SERVERS_KEY,
  type CustomServersConfig,
  defaultAccounts,
  defaultCustomServers,
  LOBBY_ACCOUNTS_KEY,
  type LobbyAccount,
  type LobbyServer,
  resolveRecoveredAccount,
  serverProtocol,
  type TlsStyle,
  useCustomServers,
  useLobbyAccounts,
} from "../config";
import { PasswordRecoveryForm } from "../PasswordRecoveryForm";
import { RegisterForm } from "../RegisterForm";
import { AutojoinChannels } from "./components/AutojoinChannels";

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
 * What a login or server drawer is showing. Adding edits a `draft` that is only
 * written when the player presses Add, so closing it leaves nothing behind.
 * Editing saves as the player goes. `added` marks an entry the player has just
 * added, so the drawer can say so.
 */
type DrawerState<T> =
  | { mode: "add"; draft: T }
  | { mode: "edit"; id: string; added?: boolean };

/** What the save line at the foot of an edit drawer says. */
type SaveStatus =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved"; text: string }
  | { kind: "error"; text: string };

const IDLE: SaveStatus = { kind: "idle" };
const SAVED: SaveStatus = { kind: "saved", text: "Saved" };

/** The two halves of a keychain key. */
type LoginIdentity = Pick<LobbyAccount, "serverId" | "username">;

/**
 * Move a saved secret from one login's keychain key to another's. Resolves with
 * whether there was a secret to move, and rejects when the keychain refused a
 * read or a write. The old entry is removed last, and only best effort, so a
 * failure part way never loses the only copy.
 */
async function moveCredential(
  from: LoginIdentity,
  to: LoginIdentity,
): Promise<boolean> {
  const { secret } = await lsGetCredential(from);
  if (secret == null) return false;
  await lsStoreCredential({ ...to, secret });
  lsDeleteCredential(from).catch(() => {
    // a leftover keychain entry is harmless
  });
  return true;
}

/** Whether another saved login already uses this server and username. */
function loginTaken(
  accounts: LobbyAccount[],
  identity: LoginIdentity,
  exceptId?: string,
) {
  return accounts.some(
    (a) =>
      a.id !== exceptId &&
      a.serverId === identity.serverId &&
      a.username === identity.username,
  );
}

const validPort = (port: number) =>
  Number.isInteger(port) && port >= 1 && port <= 65535;

/**
 * The lobby-servers settings section (`/settings/lobby-servers`). Splits into
 * Accounts (logins the user manages) and Servers (one list of built-ins and the
 * user's own, the latter editable through a drawer). A new login or server is a
 * draft until the player presses Add. After that its fields persist as they
 * change, via the frame settings store. Passwords live only in the OS keychain
 * (`ls_*_credential`).
 */
export default function LobbyServersSettings() {
  const [accountsCfg, setAccountsCfg] = useLobbyAccounts();
  const [customCfg, setCustomCfg] = useCustomServers();
  const [consoleOpen, setConsoleOpen] = useState(false);
  // The connection whose row opened the console, so it defaults to that
  // account rather than whichever happens to be focused (issue #2847). The
  // drawer's own picker still lets the user switch once more than one
  // connection is live.
  const [consoleServerKey, setConsoleServerKey] = useState<string | null>(null);
  const [registerOpen, setRegisterOpen] = useState(false);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  // The login drawer: a draft being added, or a saved login (null = closed).
  const [accountDrawer, setAccountDrawer] =
    useState<DrawerState<LobbyAccount> | null>(null);
  // The custom server drawer, the same way. Built-ins never open one.
  const [serverDrawer, setServerDrawer] =
    useState<DrawerState<LobbyServer> | null>(null);
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

  // Writes fold over what is stored rather than this render's copy, because a
  // keychain move finishes renders later and must not undo what happened since.
  const writeAccounts = (change: (prev: LobbyAccount[]) => LobbyAccount[]) =>
    updateStoredSetting<AccountsConfig>(
      LOBBY_ACCOUNTS_KEY,
      defaultAccounts,
      setAccountsCfg,
      (prev) => ({ ...prev, accounts: change(prev.accounts) }),
    );
  const writeServers = (change: (prev: LobbyServer[]) => LobbyServer[]) =>
    updateStoredSetting<CustomServersConfig>(
      CUSTOM_SERVERS_KEY,
      defaultCustomServers,
      setCustomCfg,
      (prev) => ({ ...prev, servers: change(prev.servers) }),
    );

  const addAccount = () =>
    setAccountDrawer({
      mode: "add",
      draft: {
        id: crypto.randomUUID(),
        serverId: servers[0]?.id ?? "",
        username: "",
        hasSecret: false,
      },
    });

  // Recovery hands back a username, not a password (the server emailed that
  // straight to the user). An existing login opens for editing, so the player
  // can paste the emailed password in. Otherwise the add drawer opens with the
  // username filled in, and nothing is saved until the player adds it.
  const handleRecoverySignIn = (serverId: string, username: string) => {
    const result = resolveRecoveredAccount(
      accountsCfg.accounts,
      serverId,
      username,
    );
    setRecoveryOpen(false);
    const draft = result.accounts.find((a) => a.id === result.id);
    if (result.accounts === accountsCfg.accounts || !draft) {
      setAccountDrawer({ mode: "edit", id: result.id });
    } else {
      setAccountDrawer({ mode: "add", draft });
    }
  };

  const commitAccount = (a: LobbyAccount) => {
    writeAccounts((prev) => [...prev, a]);
    setAccountDrawer({ mode: "edit", id: a.id, added: true });
  };

  const updateAccount = (id: string, patch: Partial<LobbyAccount>) =>
    writeAccounts((prev) =>
      prev.map((a) => (a.id === id ? { ...a, ...patch } : a)),
    );

  const removeAccount = (a: LobbyAccount) => {
    setAccountDrawer(null);
    writeAccounts((prev) => prev.filter((x) => x.id !== a.id));
    // Best effort. A leftover keychain entry is harmless.
    lsDeleteCredential({ serverId: a.serverId, username: a.username }).catch(
      () => {},
    );
  };

  const addCustomServer = () =>
    setServerDrawer({
      mode: "add",
      draft: {
        id: crypto.randomUUID(),
        name: "",
        host: "",
        port: 8200,
        tls: false,
        allowSelfSigned: false,
      },
    });

  const commitCustomServer = (s: LobbyServer) => {
    writeServers((prev) => [...prev, s]);
    setServerDrawer({ mode: "edit", id: s.id, added: true });
  };

  const updateCustomServer = (id: string, patch: Partial<LobbyServer>) =>
    writeServers((prev) =>
      prev.map((s) => (s.id === id ? { ...s, ...patch } : s)),
    );

  const removeCustomServer = (s: LobbyServer) => {
    setServerDrawer(null);
    // Drop accounts pointing at this server (and best-effort delete their secrets).
    for (const a of accountsCfg.accounts.filter((x) => x.serverId === s.id)) {
      lsDeleteCredential({ serverId: a.serverId, username: a.username }).catch(
        () => {},
      );
    }
    writeAccounts((prev) => prev.filter((a) => a.serverId !== s.id));
    writeServers((prev) => prev.filter((x) => x.id !== s.id));
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
                onOpen={() => setAccountDrawer({ mode: "edit", id: a.id })}
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
          <Button
            variant="outline"
            size="sm"
            onClick={() => setRecoveryOpen((o) => !o)}
            disabled={servers.length === 0}
          >
            <KeyRound /> Forgot password
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
              onOpen={
                s.builtin
                  ? undefined
                  : () => setServerDrawer({ mode: "edit", id: s.id })
              }
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
      <RecoveryDrawer
        open={recoveryOpen}
        servers={servers}
        onClose={() => setRecoveryOpen(false)}
        onSignIn={handleRecoverySignIn}
      />
      <AccountDrawer
        state={accountDrawer}
        accounts={accountsCfg.accounts}
        servers={servers}
        onAdd={commitAccount}
        onChange={updateAccount}
        onRemove={removeAccount}
        onOpenConsole={(serverKey) => {
          setConsoleServerKey(serverKey);
          setConsoleOpen(true);
        }}
        onClose={() => setAccountDrawer(null)}
      />
      <ServerDrawer
        state={serverDrawer}
        servers={customCfg.servers}
        onAdd={commitCustomServer}
        onChange={updateCustomServer}
        onRemove={removeCustomServer}
        onClose={() => setServerDrawer(null)}
      />
      <ConsoleDrawer
        open={consoleOpen}
        serverKey={consoleServerKey}
        onClose={() => setConsoleOpen(false)}
      />
    </div>
  );
}

/**
 * Whether an account has a live connection, and how many users it sees. Reads
 * that account's own connection rather than the app's one focused connection,
 * so every connected login is marked, not only the focused one (issue #2846).
 */
function useAccountConnection(
  a: LobbyAccount,
  server: LobbyServer | undefined,
) {
  const key = server ? serverKeyFor(server, a.username) : null;
  const conn = useConnection(key);
  const connected = conn?.live ?? false;
  const onlineCount = connected
    ? Object.keys(conn?.mirror.state?.users ?? {}).length
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
 * The login drawer. Adding shows {@link AddAccountForm}, which writes nothing
 * until the player presses Add. Editing a saved login (opened by clicking its
 * list row) shows {@link AccountForm}, which saves as the player goes. Same
 * viewport-anchored slide-in as `ConsoleDrawer`.
 */
function AccountDrawer({
  state,
  accounts,
  servers,
  onAdd,
  onChange,
  onRemove,
  onOpenConsole,
  onClose,
}: {
  state: DrawerState<LobbyAccount> | null;
  accounts: LobbyAccount[];
  servers: LobbyServer[];
  onAdd: (a: LobbyAccount) => void;
  onChange: (id: string, patch: Partial<LobbyAccount>) => void;
  onRemove: (a: LobbyAccount) => void;
  onOpenConsole: (serverKey: string) => void;
  onClose: () => void;
}) {
  const account =
    state?.mode === "edit"
      ? (accounts.find((a) => a.id === state.id) ?? null)
      : null;
  const adding = state?.mode === "add";
  let title = "New login";
  if (account) title = account.username.trim() || "Unnamed login";
  return (
    <SlideDrawer
      open={adding || account != null}
      title={title}
      onClose={onClose}
    >
      {state?.mode === "add" && (
        <AddAccountForm
          key={state.draft.id}
          draft={state.draft}
          accounts={accounts}
          servers={servers}
          onAdd={onAdd}
          onCancel={onClose}
        />
      )}
      {account && (
        <AccountForm
          key={account.id}
          account={account}
          accounts={accounts}
          servers={servers}
          added={state?.mode === "edit" && state.added === true}
          onChange={(patch) => onChange(account.id, patch)}
          onRemove={() => onRemove(account)}
          onOpenConsole={onOpenConsole}
          onDone={onClose}
        />
      )}
    </SlideDrawer>
  );
}

/** The labels a server picker shows, built-ins by name and the player's own marked. */
function serverOptions(servers: LobbyServer[]) {
  return servers.map((s) => ({
    value: s.id,
    label: `${s.builtin ? s.name : `${s.name || s.host} (custom)`}${
      s.alpha ? " (alpha)" : ""
    }`,
  }));
}

/** The foot of an add drawer: Cancel, and the button that saves the draft. */
function AddFooter({
  label,
  disabled,
  onCancel,
}: {
  label: string;
  disabled: boolean;
  onCancel: () => void;
}) {
  return (
    <footer className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
      <Button type="button" variant="outline" size="sm" onClick={onCancel}>
        Cancel
      </Button>
      <Button type="submit" size="sm" disabled={disabled}>
        <Plus /> {label}
      </Button>
    </footer>
  );
}

/**
 * The foot of an edit drawer. It says that changes save as the player makes
 * them, confirms the last one, and closes the drawer on Done.
 */
function EditFooter({
  status,
  onDone,
}: {
  status: SaveStatus;
  onDone: () => void;
}) {
  return (
    <footer className="flex items-center gap-3 border-t border-border px-4 py-3">
      <div className="min-w-0 flex-1 space-y-0.5 text-xs leading-snug">
        <p className="text-muted-foreground">Changes save automatically.</p>
        <p
          role="status"
          className={cn(
            "flex items-start gap-1",
            status.kind === "saved" && "text-emerald-600 dark:text-emerald-400",
            status.kind === "error" && "text-destructive",
            status.kind === "saving" && "text-muted-foreground",
          )}
        >
          {status.kind === "saved" && (
            <Check className="mt-px size-3.5 shrink-0" aria-hidden />
          )}
          {status.kind === "saving" && "Saving…"}
          {(status.kind === "saved" || status.kind === "error") && (
            <span>{status.text}</span>
          )}
        </p>
      </div>
      <Button type="button" size="sm" onClick={onDone}>
        Done
      </Button>
    </footer>
  );
}

/** Whether the component that called this is still mounted. */
function useMounted() {
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return mounted;
}

/**
 * The add-login drawer's body. Everything here is a draft. The login is written
 * to settings, and its password to the keychain, only when the player presses
 * Add, after which the drawer switches to editing the saved login. Auto-join
 * channels are keyed by the saved login, so they are offered from that point.
 */
function AddAccountForm({
  draft,
  accounts,
  servers,
  onAdd,
  onCancel,
}: {
  draft: LobbyAccount;
  accounts: LobbyAccount[];
  servers: LobbyServer[];
  onAdd: (a: LobbyAccount) => void;
  onCancel: () => void;
}) {
  const [serverId, setServerId] = useState(draft.serverId);
  const [username, setUsername] = useState(draft.username);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useMounted();

  const server = servers.find((s) => s.id === serverId);
  const tachyon = serverProtocol(server ?? {}) === "tachyon";
  const identity = { serverId, username: username.trim() };
  const taken = identity.username !== "" && loginTaken(accounts, identity);
  const ready = server != null && identity.username !== "" && !taken;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!ready || busy) return;
    const secret = tachyon ? "" : password;
    setBusy(true);
    setError(null);
    if (secret !== "") {
      try {
        await lsStoreCredential({ ...identity, secret });
      } catch (err) {
        if (mounted.current) {
          setBusy(false);
          setError(
            `Coilbox could not save the password to your keychain, so the login was not added. ${String(err)}`,
          );
        }
        return;
      }
      // Closed while the keychain was busy, which is a cancel.
      if (!mounted.current) {
        lsDeleteCredential(identity).catch(() => {});
        return;
      }
    }
    onAdd({ ...draft, ...identity, hasSecret: secret !== "" });
  };

  return (
    <form className="flex min-h-0 flex-1 flex-col" onSubmit={submit}>
      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        <p className="text-xs leading-snug text-muted-foreground">
          Nothing is saved until you add the login.
          {!tachyon &&
            " You can choose channels to join automatically once it is added."}
        </p>
        <Field label="Server">
          <OptionSelect
            value={serverId}
            onValueChange={setServerId}
            options={serverOptions(servers)}
            placeholder="Select a server"
          />
        </Field>
        <Field
          label="Username"
          hint={taken ? "You already have this login." : undefined}
        >
          <Input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            {...identifierFieldProps}
          />
        </Field>
        {tachyon ? (
          <p className="text-xs leading-snug text-muted-foreground">
            This server has no password. Add the login, then sign in with your
            browser.
          </p>
        ) : (
          <Field
            label="Password"
            hint="Saved in your keychain when you add the login."
          >
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              {...identifierFieldProps}
            />
          </Field>
        )}
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
      </div>
      <AddFooter
        label="Add login"
        disabled={!ready || busy}
        onCancel={onCancel}
      />
    </form>
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

/**
 * Password recovery in the same slide-in drawer as registration and the login
 * editor. `onSignIn` is `handleRecoverySignIn`, which opens the account
 * editor on the recovered login so the user can paste the emailed password
 * into the keychain. The form itself never sees or asks for that password.
 */
function RecoveryDrawer({
  open,
  servers,
  onClose,
  onSignIn,
}: {
  open: boolean;
  servers: LobbyServer[];
  onClose: () => void;
  onSignIn: (serverId: string, username: string) => void;
}) {
  return (
    <SlideDrawer open={open} title="Recover your password" onClose={onClose}>
      <div className="flex-1 overflow-y-auto p-4">
        <PasswordRecoveryForm
          servers={servers}
          onSignIn={onSignIn}
          onCancel={onClose}
        />
      </div>
    </SlideDrawer>
  );
}

/**
 * The edit-login drawer's body: server, username and password, channels, and
 * actions. Opening it is a user action, so it is the one place that reads the
 * keychain to check a secret exists (an OS prompt here is expected), and it
 * heals the login's stored `hasSecret` flag with the answer.
 *
 * The username saves when the field loses focus rather than on each keystroke,
 * because the keychain entry is keyed by it. A login with a saved secret has
 * that secret moved to the new name, and the player is asked for the password
 * again if the keychain refuses.
 */
function AccountForm({
  account: a,
  accounts,
  servers,
  added,
  onChange,
  onRemove,
  onOpenConsole,
  onDone,
}: {
  account: LobbyAccount;
  accounts: LobbyAccount[];
  servers: LobbyServer[];
  added: boolean;
  onChange: (patch: Partial<LobbyAccount>) => void;
  onRemove: () => void;
  onOpenConsole: (serverKey: string) => void;
  onDone: () => void;
}) {
  const [password, setPassword] = useState("");
  const [usernameInput, setUsernameInput] = useState(a.username);
  const [status, setStatus] = useState<SaveStatus>(
    added ? { kind: "saved", text: "Login added" } : IDLE,
  );
  // Set while a rename's keychain move is under way, so a second rename
  // cannot start from the name the first is moving away from.
  const renaming = useRef(false);
  // Seed from the persisted flag for an instant render, then verify against the
  // keychain. A user opened this drawer, so the (macOS) prompt is expected.
  const [saved, setSaved] = useState<boolean | undefined>(a.hasSecret);
  const server = servers.find((s) => s.id === a.serverId);
  const { connected, onlineCount } = useAccountConnection(a, server);
  // The button below only shows while `connected`, which needs `server`
  // resolved (see `useAccountConnection`), so this is non-null whenever it
  // is clickable.
  const accountKey = server ? serverKeyFor(server, a.username) : null;

  // Latest patcher behind a ref so the probe effect keys only on the identity
  // fields (a fresh `onChange` closure each render must not re-fire the probe).
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const { serverId, username, hasSecret } = a;
  // biome-ignore lint/correctness/useExhaustiveDependencies: `hasSecret` is the probe's answer, not a trigger. Keying on it would re-fire after the heal.
  useEffect(() => {
    lsGetCredential({ serverId, username })
      .then(({ secret }) => {
        const exists = secret != null;
        setSaved(exists);
        if (hasSecret !== exists) onChangeRef.current({ hasSecret: exists });
      })
      .catch(() => {});
  }, [serverId, username]);

  const rename = async (next: LoginIdentity) => {
    const from = { serverId: a.serverId, username: a.username };
    if (
      renaming.current ||
      (next.serverId === from.serverId && next.username === from.username)
    ) {
      return;
    }
    if (next.username === "") {
      setUsernameInput(a.username);
      setStatus({ kind: "error", text: "A login needs a username." });
      return;
    }
    if (loginTaken(accounts, next, a.id)) {
      setUsernameInput(a.username);
      setStatus({ kind: "error", text: "You already have this login." });
      return;
    }
    renaming.current = true;
    setStatus({ kind: "saving" });
    let moved = false;
    let lost = false;
    if (saved !== false) {
      try {
        moved = await moveCredential(from, next);
      } catch {
        lost = true;
      }
    }
    onChange({ ...next, hasSecret: moved });
    setSaved(moved);
    renaming.current = false;
    setStatus(
      lost
        ? {
            kind: "error",
            text: "Coilbox could not move the saved password to the new name. Enter the password again.",
          }
        : SAVED,
    );
  };

  const savePassword = () => {
    if (password === "") return;
    setStatus({ kind: "saving" });
    lsStoreCredential({
      serverId: a.serverId,
      username: a.username,
      secret: password,
    })
      .then(() => {
        setSaved(true);
        onChange({ hasSecret: true });
        setStatus({ kind: "saved", text: "Password saved" });
      })
      .catch(() => {
        setSaved(false);
        onChange({ hasSecret: false });
        setStatus({
          kind: "error",
          text: "Coilbox could not save the password to your keychain.",
        });
      });
  };

  const blurOnEnter = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") e.currentTarget.blur();
  };

  return (
    <>
      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {connected && (
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <span
                className="size-2 rounded-full bg-emerald-500"
                aria-hidden
              />
              Connected · {onlineCount} online
            </span>
            <Button
              variant="outline"
              size="sm"
              className="ml-auto"
              onClick={() => accountKey && onOpenConsole(accountKey)}
              aria-label="Open protocol console"
            >
              <Terminal />
            </Button>
          </div>
        )}
        <Field label="Server">
          <OptionSelect
            value={a.serverId}
            onValueChange={(v) =>
              void rename({ serverId: v, username: a.username })
            }
            options={serverOptions(servers)}
            placeholder="Select a server"
          />
        </Field>
        <Field label="Username">
          <Input
            value={usernameInput}
            onChange={(e) => setUsernameInput(e.target.value)}
            onBlur={() =>
              void rename({
                serverId: a.serverId,
                username: usernameInput.trim(),
              })
            }
            onKeyDown={blurOnEnter}
            readOnly={status.kind === "saving"}
            {...identifierFieldProps}
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
              setStatus({
                kind: "saved",
                text: exists ? "Signed in" : "Signed out",
              });
            }}
          />
        ) : (
          <Field
            label="Password"
            hint={
              saved == null
                ? undefined
                : saved
                  ? "Saved in keychain"
                  : "Not set"
            }
          >
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onBlur={savePassword}
              onKeyDown={blurOnEnter}
              placeholder={saved ? "•••••••• (saved)" : ""}
              {...identifierFieldProps}
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
      <EditFooter status={status} onDone={onDone} />
    </>
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
  const { signIn, busyKeys } = useMultiplayer();
  const [error, setError] = useState<string | null>(null);
  const named = a.username.trim() !== "";
  // Scoped to this login's own key, not the store-wide `busy`, so signing in
  // or out on one account does not grey out another's controls (issue #2846).
  const busy = server != null && busyKeys.has(serverKeyFor(server, a.username));

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
 * The custom server drawer, in the same slide-in as the login drawer. Adding
 * edits a draft that is written only on Add, and editing saves as the player
 * goes. Built-ins never reach it.
 */
function ServerDrawer({
  state,
  servers,
  onAdd,
  onChange,
  onRemove,
  onClose,
}: {
  state: DrawerState<LobbyServer> | null;
  servers: LobbyServer[];
  onAdd: (s: LobbyServer) => void;
  onChange: (id: string, patch: Partial<LobbyServer>) => void;
  onRemove: (s: LobbyServer) => void;
  onClose: () => void;
}) {
  const server =
    state?.mode === "edit"
      ? (servers.find((s) => s.id === state.id) ?? null)
      : null;
  const adding = state?.mode === "add";
  let title = "New server";
  if (server) title = server.name.trim() || server.host || "Unnamed server";
  return (
    <SlideDrawer
      open={adding || server != null}
      title={title}
      onClose={onClose}
    >
      {state?.mode === "add" && (
        <AddServerForm
          key={state.draft.id}
          draft={state.draft}
          onAdd={onAdd}
          onCancel={onClose}
        />
      )}
      {server && (
        <CustomServerForm
          key={server.id}
          server={server}
          added={state?.mode === "edit" && state.added === true}
          onChange={(patch) => onChange(server.id, patch)}
          onRemove={() => onRemove(server)}
          onDone={onClose}
        />
      )}
    </SlideDrawer>
  );
}

/** The add-server drawer's body. Nothing is written until the player presses Add. */
function AddServerForm({
  draft: initial,
  onAdd,
  onCancel,
}: {
  draft: LobbyServer;
  onAdd: (s: LobbyServer) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const ready = draft.host.trim() !== "" && validPort(draft.port);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    onAdd({ ...draft, name: draft.name.trim(), host: draft.host.trim() });
  };

  return (
    <form className="flex min-h-0 flex-1 flex-col" onSubmit={submit}>
      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        <p className="text-xs leading-snug text-muted-foreground">
          Nothing is saved until you add the server.
        </p>
        <ServerFields
          server={draft}
          onChange={(patch) => setDraft((d) => ({ ...d, ...patch }))}
        />
      </div>
      <AddFooter label="Add server" disabled={!ready} onCancel={onCancel} />
    </form>
  );
}

/** The edit-server drawer's body. Each change saves straight away and says so. */
function CustomServerForm({
  server: s,
  added,
  onChange,
  onRemove,
  onDone,
}: {
  server: LobbyServer;
  added: boolean;
  onChange: (patch: Partial<LobbyServer>) => void;
  onRemove: () => void;
  onDone: () => void;
}) {
  const [status, setStatus] = useState<SaveStatus>(
    added ? { kind: "saved", text: "Server added" } : IDLE,
  );
  return (
    <>
      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        <ServerFields
          server={s}
          onChange={(patch) => {
            onChange(patch);
            setStatus(SAVED);
          }}
        />
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
      <EditFooter status={status} onDone={onDone} />
    </>
  );
}

/** One custom server's fields. Usernames and passwords belong to logins, not here. */
function ServerFields({
  server: s,
  onChange,
}: {
  server: LobbyServer;
  onChange: (patch: Partial<LobbyServer>) => void;
}) {
  return (
    <>
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
            {...identifierFieldProps}
          />
        </Field>
        <Field label="Port">
          <Input
            type="number"
            min={1}
            max={65535}
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
    </>
  );
}
