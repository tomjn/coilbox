import { Button, useSetting } from "@picoframe/frame";
import {
  ArrowLeft,
  ExternalLink,
  KeyRound,
  Loader2,
  Plus,
  RefreshCw,
  UserPlus,
  Users,
} from "lucide-react";
import { useEffect, useId, useState } from "react";
import { Link } from "react-router";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  allServers,
  isLastLogin,
  type LastLogin,
  type LobbyAccount,
  type LobbyServer,
  rememberedLogins,
  resolveServer,
  serverProtocol,
  sortAccountsByRecency,
  useCustomServers,
  useLastLogin,
  useLobbyAccounts,
} from "../lobby-servers/config";
import { PasswordRecoveryForm } from "../lobby-servers/PasswordRecoveryForm";
import { RegisterForm } from "../lobby-servers/RegisterForm";
import type { LoginPhase } from "./bindings";
import type { ConnectionState } from "./connections";
import { type DotStatus, lobbyDotStatus } from "./loginStatus";
import {
  liveConnectionKeys,
  serverHostFromKey,
  serverKeyFor,
  serverNameFor,
  useMultiplayer,
  useProtocolServers,
  usernameFromKey,
} from "./store";

const DOT_CLASS: Record<DotStatus, string> = {
  off: "bg-muted-foreground/50",
  connecting: "bg-amber-500 animate-pulse",
  on: "bg-green-500",
  // Matches the amber "Away" dot the chat member list uses (see presence.ts).
  away: "bg-amber-500",
  error: "bg-destructive",
};

const LABEL: Record<DotStatus, string> = {
  off: "Multiplayer: log in",
  connecting: "Multiplayer: connecting",
  on: "Multiplayer: connected",
  away: "Multiplayer: away",
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
    connections,
    activeKey,
    busy,
    loginPopoverOpen,
    openLoginPopover,
    closeLoginPopover,
  } = useMultiplayer();

  const hasAccounts = accountsCfg.accounts.length > 0;
  if (!hasAccounts && activeKey == null) return null;

  const status = lobbyDotStatus(connections, busy);

  return (
    <Popover
      open={loginPopoverOpen}
      onOpenChange={(o) => (o ? openLoginPopover() : closeLoginPopover())}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={LABEL[status]}
          className="relative flex size-8 items-center justify-center rounded-md hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
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

/**
 * What the Tachyon connect is doing, for the panel's waiting view. The TASServer
 * phases are not listed: that connect is one step from the user's side, and its
 * ten phases pass too fast to read.
 */
const PHASE_LABEL: Partial<Record<LoginPhase, string>> = {
  tachyonAuthorizing: "Checking your sign-in",
  tachyonOpening: "Opening the connection",
};

export function LoginPanel({ onNavigate }: { onNavigate: () => void }) {
  const [accountsCfg] = useLobbyAccounts();
  const [customCfg] = useCustomServers();
  const accounts = accountsCfg.accounts;
  const {
    mirror,
    connections,
    activeKey,
    revealed,
    busy,
    busyKeys,
    connect,
    signIn,
    disconnect,
    cancelConnect,
    manualAway,
    setManualAway,
  } = useMultiplayer();
  const servers = useProtocolServers();
  const rowId = useId();

  const [lastLogin] = useLastLogin();
  const [autoConnect] = useSetting<boolean>("multiplayer.autoConnect", false);

  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<LobbyAccount | null>(null);
  const [registering, setRegistering] = useState(false);
  const [recovering, setRecovering] = useState(false);
  // Set once recovery finishes, since there is nothing here to sign in to
  // directly: the new password went to the user's email, not to us. Shown in
  // the connect view as a pointer to add the login.
  const [recovered, setRecovered] = useState<{
    serverId: string;
    username: string;
  } | null>(null);
  // True while the user is off in their browser, which reads nothing like the
  // rest of a connect and takes as long as they take.
  const [signingIn, setSigningIn] = useState(false);
  // The Tachyon login whose connect just failed. A sign-in that is gone or no
  // longer accepted is the one cause the user can do something about, so the
  // panel offers the browser as the way out rather than leaving them with a
  // message and nothing to press.
  const [needsSignIn, setNeedsSignIn] = useState<LobbyAccount | null>(null);
  // True while a logged-in user is picking another login to add.
  const [adding, setAdding] = useState(false);
  useEffect(() => {
    if (activeKey == null) setAdding(false);
  }, [activeKey]);

  // Every lobby login, live ones first and the focused one first among those.
  // A login that dropped stays listed beside the live ones, so its reason can
  // still be read and its reconnect stopped. A room is left out: it is not a
  // login, and it is closed from the Battles page (issue #2850).
  const liveKeys = liveConnectionKeys(connections, activeKey).filter(
    (key) => !connections[key].direct,
  );
  const listed = [
    ...liveKeys,
    ...Object.keys(connections).filter(
      (key) => !connections[key].live && !connections[key].direct,
    ),
  ];

  // A one-click "reconnect" shortcut for each remembered login (the ones
  // open-at-quit resolves, per issue #2849), earned only after a genuine
  // connection this session (`revealed`). On a fresh open it would just
  // duplicate the top rows of the most-recent-first list below. Also hidden
  // when startup auto-connect is on, since the boot connect already tried
  // every one of them. A login already showing its own row (live, opening, or
  // dropped and still listed) is filtered out, so this never duplicates
  // `AccountList` below it. Resolved against the profile-filtered catalog, so
  // a profile-disallowed server won't offer it.
  const reconnects =
    autoConnect || !revealed
      ? []
      : rememberedLogins(
          accounts,
          lastLogin,
          allServers(customCfg.servers),
        ).filter(
          ({ account, server }) =>
            !(serverKeyFor(server, account.username) in connections),
        );

  // Most recently used first. The last-used login is badged instead of getting
  // a dedicated connect button.
  const sortedAccounts = sortAccountsByRecency(accounts, lastLogin);

  /** The connection a login would replace: another account on its server. */
  function replacedBy(account: LobbyAccount): string | null {
    const server = resolveServer(account.serverId, customCfg.servers);
    if (!server) return null;
    const key = serverKeyFor(server, account.username);
    const host = serverHostFromKey(key);
    return (
      listed.find((k) => k !== key && serverHostFromKey(k) === host) ?? null
    );
  }

  /**
   * Connect as `account`. A Tachyon login has no password, so the first connect
   * for one sends the user to their browser first, and `signInFirst` sends them
   * again when the stored sign-in turned out not to work.
   */
  async function connectTo(account: LobbyAccount, signInFirst = false) {
    setError(null);
    setNeedsSignIn(null);
    setPending(account);
    const server = resolveServer(account.serverId, customCfg.servers);
    const tachyon = server != null && serverProtocol(server) === "tachyon";
    try {
      if (!server) {
        throw new Error(
          "This login's server no longer exists (check Settings).",
        );
      }
      if (tachyon && (signInFirst || account.hasSecret !== true)) {
        setSigningIn(true);
        try {
          await signIn(server, account.username);
        } finally {
          setSigningIn(false);
        }
      }
      await connect(server, account.username);
      setAdding(false);
    } catch (e) {
      setError(String(e));
      if (tachyon) setNeedsSignIn(account);
    } finally {
      setPending(null);
    }
  }

  async function logOut(serverKey: string) {
    setError(null);
    try {
      await disconnect(serverKey);
    } catch (e) {
      setError(String(e));
    }
  }

  /** Log out of every connection, carrying on past one that fails. */
  async function logOutAll() {
    setError(null);
    for (const key of listed) {
      try {
        await disconnect(key);
      } catch (e) {
        setError(String(e));
      }
    }
  }

  /**
   * Connect as `account`. Coilbox holds one connection per server, so an
   * account already on that server is logged out first, as switching account
   * did. A failed log out stops here rather than opening a second socket beside
   * one that may still be live.
   */
  async function pick(account: LobbyAccount) {
    setError(null);
    const replaced = replacedBy(account);
    if (replaced) {
      try {
        await disconnect(replaced);
      } catch (e) {
        setError(String(e));
        return;
      }
    }
    await connectTo(account);
  }

  if (liveKeys.length > 0 && !adding) {
    const several = listed.length > 1;
    const anyReady = liveKeys.some(
      (key) => connections[key].mirror.phase === "ready",
    );
    const idleAway = liveKeys.some((key) => connections[key].status.away);
    return (
      <div className="flex flex-col gap-3">
        <ul className="flex flex-col gap-2">
          {listed.map((key, i) => {
            const entry = connections[key];
            const opening = !entry.live && busyKeys.has(key);
            const nameId = `${rowId}-${i}`;
            return (
              <li key={key} className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p id={nameId} className="truncate text-sm font-medium">
                    {entry.mirror.state?.myUsername ?? usernameFromKey(key)}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {serverNameFor(key, servers)}
                  </p>
                  <ConnectionLine entry={entry} opening={opening} />
                </div>
                {several && (
                  <Button
                    variant="ghost"
                    onClick={() =>
                      void (opening ? cancelConnect(key) : logOut(key))
                    }
                    disabled={busyKeys.has(key) && !opening}
                    aria-describedby={nameId}
                    className="h-7 shrink-0 px-2 text-xs"
                  >
                    {opening ? "Cancel" : "Log out"}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
        <label
          htmlFor="lobby-manual-away"
          className="flex items-center justify-between gap-3"
        >
          <span className="flex flex-col">
            <span className="text-sm font-medium">Away</span>
            <span className="text-xs text-muted-foreground">
              {/* The idle watcher owns the away bit unless the user takes it,
                  so say which of the two is showing right now. */}
              {manualAway
                ? "Others see you as away until you turn this off."
                : idleAway
                  ? "You've been set away automatically while idle."
                  : "Tell others you're not at the keyboard."}
            </span>
          </span>
          <Switch
            id="lobby-manual-away"
            checked={manualAway}
            onCheckedChange={setManualAway}
            disabled={!anyReady}
          />
        </label>
        <Link
          to="/chat"
          onClick={onNavigate}
          className="inline-flex h-8 items-center justify-center rounded-md border border-border text-sm font-medium hover:bg-accent"
        >
          Chat
        </Link>
        <Button
          variant="outline"
          onClick={() => {
            setError(null);
            setAdding(true);
          }}
          disabled={busy}
          className="h-8 gap-2"
        >
          <Plus className="size-4" />
          Add another login
        </Button>
        <Button
          onClick={() => void (several ? logOutAll() : logOut(listed[0]))}
          disabled={busy}
          className="h-8"
        >
          {several ? "Log out of all" : "Log out"}
        </Button>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    );
  }

  // Registering owns the panel while its form is open — checked before `busy` so
  // the form stays mounted during the in-flight request (which also sets `busy`),
  // keeping its fields and any error visible rather than flashing the spinner.
  if (registering) {
    return (
      <div className="flex flex-col gap-2">
        <p className="px-1 text-sm font-medium">Create an account</p>
        <RegisterForm
          servers={allServers(customCfg.servers)}
          onSuccess={() => setRegistering(false)}
          onCancel={() => setRegistering(false)}
        />
      </div>
    );
  }

  // Recovering owns the panel while its form is open, same as `registering`
  // above and for the same reason.
  if (recovering) {
    return (
      <div className="flex flex-col gap-2">
        <p className="px-1 text-sm font-medium">Recover your password</p>
        <PasswordRecoveryForm
          servers={allServers(customCfg.servers)}
          onSignIn={(serverId, username) => {
            setRecovering(false);
            setRecovered({ serverId, username });
          }}
          onCancel={() => setRecovering(false)}
        />
      </div>
    );
  }

  if ((busy && liveKeys.length === 0) || pending != null) {
    const phase = mirror.phase ? PHASE_LABEL[mirror.phase] : undefined;
    const pendingServer = pending
      ? resolveServer(pending.serverId, customCfg.servers)
      : null;
    const pendingKey =
      pending && pendingServer
        ? serverKeyFor(pendingServer, pending.username)
        : undefined;
    return (
      <div className="flex flex-col items-center gap-3 py-4">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
        <div className="text-center">
          <p className="text-sm font-medium">
            {signingIn ? "Waiting for your browser" : "Connecting…"}
          </p>
          <p className="text-xs text-muted-foreground">
            {signingIn
              ? "Sign in on the page Coilbox opened, then come back."
              : (phase ?? pending?.username ?? "server")}
          </p>
        </div>
        {/* Nothing can call off a sign-in that is happening in someone else's
            browser. It gives up on its own after a minute. */}
        {!signingIn && (
          <Button
            onClick={() => void cancelConnect(pendingKey)}
            className="h-8 w-full"
          >
            Cancel
          </Button>
        )}
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      {adding ? (
        <div className="flex items-center gap-1 pb-1">
          <Button
            variant="ghost"
            onClick={() => {
              setError(null);
              setAdding(false);
            }}
            className="h-8 gap-1.5 px-2"
          >
            <ArrowLeft className="size-4" />
            Back
          </Button>
          <p className="text-sm font-medium">Add another login</p>
        </div>
      ) : (
        <p className="px-2 pb-1 text-sm font-medium">
          {revealed ? "Reconnect to multiplayer" : "Connect to multiplayer"}
        </p>
      )}
      {reconnects.map(({ account: a, server }) => (
        <Button
          key={a.id}
          onClick={() => void connectTo(a)}
          disabled={busy}
          className="mb-1 h-9 justify-start gap-2"
        >
          <RefreshCw className="size-4" />
          Reconnect as {a.username || "last account"} on {server.name}
        </Button>
      ))}
      <AccountList
        accounts={sortedAccounts}
        customServers={customCfg.servers}
        lastLogin={lastLogin}
        liveKeys={liveKeys}
        replacedBy={replacedBy}
        disabled={busy}
        onPick={(a) => void pick(a)}
        onNavigate={onNavigate}
      />
      <button
        type="button"
        onClick={() => setRegistering(true)}
        className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
      >
        <UserPlus className="size-4" />
        Register a new account
      </button>
      <button
        type="button"
        onClick={() => {
          setRecovered(null);
          setRecovering(true);
        }}
        className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
      >
        <KeyRound className="size-4" />
        Forgot password?
      </button>
      {recovered && (
        <p className="px-2 pt-1 text-xs text-muted-foreground">
          A new password has been emailed for{" "}
          <span className="font-medium">{recovered.username}</span> on{" "}
          {resolveServer(recovered.serverId, customCfg.servers)?.name ??
            "that server"}
          .{" "}
          <Link
            to="/settings/lobby-servers"
            onClick={onNavigate}
            className="font-medium text-foreground underline underline-offset-2 hover:no-underline"
          >
            Go to Settings, Lobby servers
          </Link>{" "}
          and add or update that login with the password from the email.
        </p>
      )}
      {error && <p className="px-2 pt-1 text-xs text-destructive">{error}</p>}
      {needsSignIn && (
        <Button
          onClick={() => void connectTo(needsSignIn, true)}
          className="mt-1 h-9 justify-start gap-2"
        >
          <ExternalLink className="size-4" />
          Sign in with your browser
        </Button>
      )}
      {adding ? null : mirror.loginError ? (
        <p className="px-2 pt-1 text-xs text-destructive">
          Login failed: {mirror.loginError}
        </p>
      ) : (
        mirror.error && (
          <p className="px-2 pt-1 text-xs text-destructive">
            Disconnected: {mirror.error}
          </p>
        )
      )}
    </div>
  );
}

/**
 * The saved logins as rows to press, followed by the link to add another. Shared
 * by the logged-out view and the add-a-login view. `liveKeys` marks the logins
 * already connected, which are shown but cannot be picked, and `replacedBy`
 * names the connection a login would log out, because its server already has
 * another account.
 */
function AccountList({
  accounts,
  customServers,
  lastLogin,
  liveKeys,
  replacedBy,
  disabled,
  onPick,
  onNavigate,
}: {
  accounts: LobbyAccount[];
  customServers: LobbyServer[];
  lastLogin: LastLogin | null;
  liveKeys: string[];
  replacedBy: (account: LobbyAccount) => string | null;
  disabled: boolean;
  onPick: (account: LobbyAccount) => void;
  onNavigate: () => void;
}) {
  return (
    <>
      {accounts.map((a) => {
        const server = resolveServer(a.serverId, customServers);
        const current =
          server != null && liveKeys.includes(serverKeyFor(server, a.username));
        const replaced = current ? null : replacedBy(a);
        // A Tachyon login with no sign-in stored takes the user to their browser
        // when they press it, so say so before they press it.
        const opensBrowser =
          server != null &&
          serverProtocol(server) === "tachyon" &&
          a.hasSecret !== true;
        return (
          <button
            key={a.id}
            type="button"
            onClick={() => onPick(a)}
            disabled={disabled || current}
            className="flex flex-col items-start rounded-md px-2 py-1.5 text-left hover:bg-accent disabled:pointer-events-none disabled:opacity-50"
          >
            <span className="flex w-full items-center gap-2 text-base font-semibold leading-tight">
              {a.username || "(no username)"}
              {current ? (
                <span className="ml-auto rounded bg-green-500/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-green-600 dark:text-green-400">
                  Connected
                </span>
              ) : (
                isLastLogin(a, lastLogin) && (
                  <span className="ml-auto rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary">
                    Last used
                  </span>
                )
              )}
            </span>
            {/* The name and its badge are one inline run so a long name wraps
                through the badge rather than pushing it into a column. The
                sign-in note takes its own line under both. */}
            <span className="text-xs text-muted-foreground">
              {server?.name ?? "Unknown server"}
              {server?.alpha && (
                <span className="ml-1.5 rounded border border-destructive/40 bg-destructive/15 px-1 py-0.5 text-[10px] font-medium uppercase tracking-wide text-destructive">
                  Alpha
                </span>
              )}
            </span>
            {opensBrowser && (
              <span className="text-xs text-muted-foreground">
                Signs in with your browser
              </span>
            )}
            {replaced && (
              <span className="text-xs text-muted-foreground">
                Logs out {usernameFromKey(replaced)}
              </span>
            )}
          </button>
        );
      })}
      <Link
        to="/settings/lobby-servers"
        onClick={onNavigate}
        className="mt-1 flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
      >
        <Plus className="size-4" />
        Add a login
      </Link>
    </>
  );
}

/** Where one listed connection stands: logging in, online, away, or dropped. */
function ConnectionLine({
  entry,
  opening,
}: {
  entry: ConnectionState;
  opening: boolean;
}) {
  const m = entry.mirror;
  if (entry.live) {
    return (
      <p className="text-xs text-muted-foreground">
        {m.phase !== "ready"
          ? `Connecting… (${m.phase ?? "…"})`
          : entry.status.away
            ? "Away"
            : "Online"}
      </p>
    );
  }
  if (opening) {
    return <p className="text-xs text-muted-foreground">Connecting…</p>;
  }
  const reason = m.loginError
    ? `Login failed: ${m.loginError}`
    : m.error
      ? `Disconnected: ${m.error}`
      : "Disconnected";
  return <p className="text-xs text-destructive">{reason}</p>;
}
