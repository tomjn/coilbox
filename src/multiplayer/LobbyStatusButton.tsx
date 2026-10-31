import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@picoframe/frame";
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
import { describeError } from "@/i18n/uiError";
import { cn } from "@/lib/utils";
import {
  allServers,
  dedupeByHost,
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
import {
  LOBBY_SERVERS_ROUTE,
  requestDrawer,
} from "../lobby-servers/drawerRequest";
import { PasswordRecoveryForm } from "../lobby-servers/PasswordRecoveryForm";
import { RegisterForm } from "../lobby-servers/RegisterForm";
import type { LoginPhase } from "./bindings";
import type { ConnectionState } from "./connections";
import { isPasswordRefusal, LoginRefusedError } from "./loginRefused";
import { type DotStatus, lobbyDotStatus, refusedReason } from "./loginStatus";
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
  refused: "bg-destructive",
};

const LABEL: Record<DotStatus, MessageDescriptor> = {
  off: msg`Multiplayer: log in`,
  connecting: msg`Multiplayer: connecting`,
  on: msg`Multiplayer: connected`,
  away: msg`Multiplayer: away`,
  error: msg`Multiplayer: connection error`,
  refused: msg`Multiplayer: password refused`,
};

/**
 * topbar.right slot: an icon button that shows lobby connection status via a dot
 * and opens a popover to connect / view status / log out. Hidden entirely when no
 * login is configured and no lobby login is connected. A room (`direct`) does not
 * count either way, since it is not a login and is closed from the Battles page,
 * which already has its own Stop room control (issue #2904). The open state is
 * controlled by MultiplayerContext so not-connected CTAs elsewhere can open this
 * same popover.
 */
export default function LobbyStatusButton() {
  const { t } = useLingui();
  const [accountsCfg] = useLobbyAccounts();
  const {
    connections,
    busy,
    loginPopoverOpen,
    openLoginPopover,
    closeLoginPopover,
  } = useMultiplayer();

  const hasAccounts = accountsCfg.accounts.length > 0;
  const hasLogins = Object.values(connections).some((c) => !c.direct);
  if (!hasAccounts && !hasLogins) return null;

  const status = lobbyDotStatus(connections, busy);

  return (
    <Popover
      open={loginPopoverOpen}
      onOpenChange={(o) => (o ? openLoginPopover() : closeLoginPopover())}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={t(LABEL[status])}
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
const PHASE_LABEL: Partial<Record<LoginPhase, MessageDescriptor>> = {
  tachyonAuthorizing: msg`Checking your sign-in`,
  tachyonOpening: msg`Opening the connection`,
};

export function LoginPanel({ onNavigate }: { onNavigate: () => void }) {
  const { t } = useLingui();
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
    reconnectAll,
    manualAway,
    setManualAway,
  } = useMultiplayer();
  const servers = useProtocolServers();
  const rowId = useId();

  const [lastLogin] = useLastLogin();

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

  // Every remembered login (the ones open-at-quit resolves, per issue #2849),
  // resolved against the profile-filtered catalog so a profile-disallowed
  // server is left out. `AccountList` marks each of these with a small badge
  // and sorts them to the top (issue #2927) instead of the separate
  // "Reconnect as…" buttons this used to feed, which duplicated the account
  // rows below them and ran long server names past the panel edge.
  const remembered = rememberedLogins(
    accounts,
    lastLogin,
    allServers(customCfg.servers),
  );
  const rememberedIds = new Set(remembered.map(({ account }) => account.id));

  // What "Reconnect all" actually attempts: the remembered logins not already
  // connected, collapsed to one per host so two that would log each other out
  // are never both tried (the one-login-per-host rule enforced in `doConnect`
  // via `connectBlockedReason`). The more recently used of a clashing pair is
  // kept.
  const pendingRemembered = dedupeByHost(
    remembered.filter(
      ({ account, server }) =>
        !(serverKeyFor(server, account.username) in connections),
    ),
    lastLogin,
  );

  // Most recently used first, with every remembered login pulled to the top
  // of that order so it reads as one list instead of two.
  const sortedAccounts = [...sortAccountsByRecency(accounts, lastLogin)].sort(
    (a, b) => Number(rememberedIds.has(b.id)) - Number(rememberedIds.has(a.id)),
  );

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
          t`This login's server no longer exists (check Settings).`,
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
      // A refused password is marked on the login's own row, with the server's
      // reason, and the store has raised the notification.
      if (!(e instanceof LoginRefusedError)) setError(describeError(e));
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
      setError(describeError(e));
    }
  }

  /** Log out of every connection, carrying on past one that fails. */
  async function logOutAll() {
    setError(null);
    for (const key of listed) {
      try {
        await disconnect(key);
      } catch (e) {
        setError(describeError(e));
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
        setError(describeError(e));
        return;
      }
    }
    await connectTo(account);
  }

  const recoveredUser = recovered?.username;
  const recoveredServer = recovered
    ? (resolveServer(recovered.serverId, customCfg.servers)?.name ??
      t`that server`)
    : null;
  const disconnectError = mirror.error;

  // The logins the server refused, by account id, with its reason (empty when
  // it gave none). A login is refused until its next attempt starts.
  const refused = new Map<string, string>();
  const accountByKey = new Map<string, LobbyAccount>();
  for (const a of accounts) {
    const server = resolveServer(a.serverId, customCfg.servers);
    if (!server) continue;
    const key = serverKeyFor(server, a.username);
    accountByKey.set(key, a);
    const entry = connections[key];
    const reason = entry ? refusedReason(entry) : null;
    if (reason != null) refused.set(a.id, reason);
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
                  {isPasswordRefusal(refusedReason(entry)) &&
                    accountByKey.has(key) && (
                      <ChangePasswordLink
                        account={accountByKey.get(key) as LobbyAccount}
                        onNavigate={onNavigate}
                      />
                    )}
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
                    {/* A login that dropped or never opened has nothing to
                        log out of. Dismissing it also stops its reconnect. */}
                    {opening ? (
                      <Trans>Cancel</Trans>
                    ) : entry.live ? (
                      <Trans>Log out</Trans>
                    ) : (
                      <Trans>Dismiss</Trans>
                    )}
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
            <span className="text-sm font-medium">
              <Trans>Away</Trans>
            </span>
            <span className="text-xs text-muted-foreground">
              {/* The idle watcher owns the away bit unless the user takes it,
                  so say which of the two is showing right now. */}
              {manualAway ? (
                <Trans>Others see you as away until you turn this off.</Trans>
              ) : idleAway ? (
                <Trans>You've been set away automatically while idle.</Trans>
              ) : (
                <Trans>Tell others you're not at the keyboard.</Trans>
              )}
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
          <Trans>Chat</Trans>
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
          <Trans>Add another login</Trans>
        </Button>
        <Button
          onClick={() => void (several ? logOutAll() : logOut(listed[0]))}
          disabled={busy}
          className="h-8"
        >
          {several ? <Trans>Log out of all</Trans> : <Trans>Log out</Trans>}
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
        <p className="px-1 text-sm font-medium">
          <Trans>Create an account</Trans>
        </p>
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
        <p className="px-1 text-sm font-medium">
          <Trans>Recover your password</Trans>
        </p>
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
    const phaseText = phase ? t(phase) : undefined;
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
            {signingIn ? t`Waiting for your browser` : t`Connecting…`}
          </p>
          <p className="text-xs text-muted-foreground">
            {signingIn
              ? t`Sign in on the page Coilbox opened, then come back.`
              : (phaseText ?? pending?.username ?? t`server`)}
          </p>
        </div>
        {/* Nothing can call off a sign-in that is happening in someone else's
            browser. It gives up on its own after a minute. */}
        {!signingIn && (
          <Button
            onClick={() => void cancelConnect(pendingKey)}
            className="h-8 w-full"
          >
            <Trans>Cancel</Trans>
          </Button>
        )}
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    );
  }

  return (
    <div className="flex max-h-[calc(var(--radix-popover-content-available-height)-2rem)] flex-col gap-1">
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
            <Trans>Back</Trans>
          </Button>
          <p className="text-sm font-medium">
            <Trans>Add another login</Trans>
          </p>
        </div>
      ) : (
        <p className="px-2 pb-1 text-sm font-medium">
          {revealed ? (
            <Trans>Reconnect to multiplayer</Trans>
          ) : (
            <Trans>Connect to multiplayer</Trans>
          )}
        </p>
      )}
      {pendingRemembered.length > 1 && (
        <Button
          variant="outline"
          onClick={() => void reconnectAll(pendingRemembered)}
          disabled={busy}
          className="mb-1 h-9 justify-start gap-2"
        >
          <RefreshCw className="size-4" />
          <Trans>Reconnect all</Trans>
        </Button>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <AccountList
          accounts={sortedAccounts}
          customServers={customCfg.servers}
          remembered={rememberedIds}
          refused={refused}
          liveKeys={liveKeys}
          replacedBy={replacedBy}
          disabled={busy}
          onPick={(a) => void pick(a)}
          onNavigate={onNavigate}
        />
      </div>
      <button
        type="button"
        onClick={() => setRegistering(true)}
        className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
      >
        <UserPlus className="size-4" />
        <Trans>Register a new account</Trans>
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
        <Trans>Forgot password?</Trans>
      </button>
      {recovered && (
        <p className="px-2 pt-1 text-xs text-muted-foreground">
          <Trans>
            A new password has been emailed for{" "}
            <span className="font-medium">{recoveredUser}</span> on{" "}
            {recoveredServer}.{" "}
            <Link
              to="/settings/lobby-servers"
              onClick={onNavigate}
              className="font-medium text-foreground underline underline-offset-2 hover:no-underline"
            >
              Go to Settings, Lobby servers
            </Link>{" "}
            and add or update that login with the password from the email.
          </Trans>
        </p>
      )}
      {error && <p className="px-2 pt-1 text-xs text-destructive">{error}</p>}
      {needsSignIn && (
        <Button
          onClick={() => void connectTo(needsSignIn, true)}
          className="mt-1 h-9 justify-start gap-2"
        >
          <ExternalLink className="size-4" />
          <Trans>Sign in with your browser</Trans>
        </Button>
      )}
      {adding ||
        // A refused login says so on its own row, and a connect that just
        // failed is already reported above, in `error`.
        (mirror.error && !error && !mirror.loginError && (
          <p className="px-2 pt-1 text-xs text-destructive">
            <Trans>Disconnected: {disconnectError}</Trans>
          </p>
        ))}
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
  remembered,
  refused,
  liveKeys,
  replacedBy,
  disabled,
  onPick,
  onNavigate,
}: {
  accounts: LobbyAccount[];
  customServers: LobbyServer[];
  /** Account ids `rememberedLogins` names, badged "Open last time" below. */
  remembered: ReadonlySet<string>;
  /** Server's reason by account id, for each login it refused. */
  refused: ReadonlyMap<string, string>;
  liveKeys: string[];
  replacedBy: (account: LobbyAccount) => string | null;
  disabled: boolean;
  onPick: (account: LobbyAccount) => void;
  onNavigate: () => void;
}) {
  const { t } = useLingui();
  return (
    <>
      {accounts.map((a) => {
        const server = resolveServer(a.serverId, customServers);
        const current =
          server != null && liveKeys.includes(serverKeyFor(server, a.username));
        const replaced = current ? null : replacedBy(a);
        const replacedName = replaced ? usernameFromKey(replaced) : null;
        const refusal = current ? undefined : refused.get(a.id);
        // A Tachyon login with no sign-in stored takes the user to their browser
        // when they press it, so say so before they press it.
        const opensBrowser =
          server != null &&
          serverProtocol(server) === "tachyon" &&
          a.hasSecret !== true;
        return (
          <div key={a.id}>
            <button
              type="button"
              onClick={() => onPick(a)}
              disabled={disabled || current}
              className="flex w-full flex-col items-start rounded-md px-2 py-1.5 text-left hover:bg-accent disabled:pointer-events-none disabled:opacity-50"
            >
              <span className="flex w-full items-center gap-2 text-base font-semibold leading-tight">
                {a.username || t`(no username)`}
                {current ? (
                  <span className="ml-auto rounded bg-green-500/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-green-600 dark:text-green-400">
                    <Trans>Connected</Trans>
                  </span>
                ) : refusal != null ? (
                  <span className="ml-auto rounded bg-destructive/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-destructive">
                    {isPasswordRefusal(refusal) ? (
                      <Trans>Password refused</Trans>
                    ) : (
                      <Trans>Login refused</Trans>
                    )}
                  </span>
                ) : (
                  remembered.has(a.id) && (
                    <span className="ml-auto rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary">
                      <Trans>Open last time</Trans>
                    </span>
                  )
                )}
              </span>
              {/* The name and its badge are one inline run so a long name wraps
                through the badge rather than pushing it into a column. The
                sign-in note takes its own line under both. */}
              <span className="text-xs text-muted-foreground">
                {server?.name ?? t`Unknown server`}
                {server?.alpha && (
                  <span className="ml-1.5 rounded border border-destructive/40 bg-destructive/15 px-1 py-0.5 text-[10px] font-medium uppercase tracking-wide text-destructive">
                    <Trans>Alpha</Trans>
                  </span>
                )}
              </span>
              {opensBrowser && (
                <span className="text-xs text-muted-foreground">
                  <Trans>Signs in with your browser</Trans>
                </span>
              )}
              {replaced && (
                <span className="text-xs text-muted-foreground">
                  <Trans>Logs out {replacedName}</Trans>
                </span>
              )}
              {refusal && (
                <span className="text-xs text-destructive">{refusal}</span>
              )}
            </button>
            {isPasswordRefusal(refusal) && (
              <div className="px-2 pb-1">
                <ChangePasswordLink account={a} onNavigate={onNavigate} />
              </div>
            )}
          </div>
        );
      })}
      <Link
        to="/settings/lobby-servers"
        onClick={onNavigate}
        className="mt-1 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
      >
        <Plus className="size-4" />
        <Trans>Add a login</Trans>
      </Link>
    </>
  );
}

/**
 * The one action for a refused login: the settings drawer for that login, with
 * the cursor in its password field.
 */
function ChangePasswordLink({
  account,
  onNavigate,
}: {
  account: LobbyAccount;
  onNavigate: () => void;
}) {
  return (
    <Link
      to={LOBBY_SERVERS_ROUTE}
      onClick={() => {
        requestDrawer({
          kind: "password",
          serverId: account.serverId,
          username: account.username,
        });
        onNavigate();
      }}
      className="inline-flex items-center gap-1.5 text-xs font-medium text-foreground underline underline-offset-2 hover:no-underline"
    >
      <KeyRound className="size-3.5" />
      <Trans>Change password</Trans>
    </Link>
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
  const { t } = useLingui();
  const m = entry.mirror;
  if (entry.live) {
    const phaseName = m.phase ?? "…";
    return (
      <p className="text-xs text-muted-foreground">
        {m.phase !== "ready"
          ? t`Connecting… (${phaseName})`
          : entry.status.away
            ? t`Away`
            : t`Online`}
      </p>
    );
  }
  if (opening) {
    return (
      <p className="text-xs text-muted-foreground">
        <Trans>Connecting…</Trans>
      </p>
    );
  }
  const loginError = m.loginError;
  const error = m.error;
  const reason = loginError
    ? t`Login failed: ${loginError}`
    : error
      ? t`Disconnected: ${error}`
      : t`Disconnected`;
  return <p className="text-xs text-destructive">{reason}</p>;
}
