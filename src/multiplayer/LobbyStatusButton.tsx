import { Button, useSetting } from "@picoframe/frame";
import {
  ExternalLink,
  Loader2,
  Plus,
  RefreshCw,
  UserPlus,
  Users,
} from "lucide-react";
import { useState } from "react";
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
  type LobbyAccount,
  resolveLastLogin,
  resolveServer,
  serverProtocol,
  sortAccountsByRecency,
  useCustomServers,
  useLastLogin,
  useLobbyAccounts,
} from "../lobby-servers/config";
import { RegisterForm } from "../lobby-servers/RegisterForm";
import type { LoginPhase } from "./bindings";
import { useMultiplayer } from "./store";

type DotStatus = "off" | "connecting" | "on" | "away" | "error";

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
    mirror,
    activeKey,
    busy,
    loginPopoverOpen,
    openLoginPopover,
    closeLoginPopover,
    status: clientStatus,
  } = useMultiplayer();

  const hasAccounts = accountsCfg.accounts.length > 0;
  if (!hasAccounts && activeKey == null) return null;

  let status: DotStatus = "off";
  if (activeKey != null) {
    if (mirror.phase !== "ready") status = "connecting";
    else status = clientStatus.away ? "away" : "on";
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
    activeKey,
    revealed,
    busy,
    connect,
    signIn,
    disconnect,
    cancelConnect,
    status,
    manualAway,
    setManualAway,
  } = useMultiplayer();

  const [lastLogin] = useLastLogin();
  const [autoConnect] = useSetting<boolean>("multiplayer.autoConnect", false);

  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<LobbyAccount | null>(null);
  const [registering, setRegistering] = useState(false);
  // True while the user is off in their browser, which reads nothing like the
  // rest of a connect and takes as long as they take.
  const [signingIn, setSigningIn] = useState(false);
  // The Tachyon login whose connect just failed. A sign-in that is gone or no
  // longer accepted is the one cause the user can do something about, so the
  // panel offers the browser as the way out rather than leaving them with a
  // message and nothing to press.
  const [needsSignIn, setNeedsSignIn] = useState<LobbyAccount | null>(null);

  // A one-click "reconnect" shortcut to the last-used account, earned only after a
  // genuine connection this session (`revealed`) — on a fresh open it would just
  // duplicate the top row of the most-recent-first list below. Also hidden when
  // startup auto-connect is on (the boot connect already ran). Resolved against the
  // profile-filtered catalog, so a profile-disallowed server won't offer it.
  const reconnect =
    autoConnect || !revealed
      ? null
      : resolveLastLogin(lastLogin, accounts, allServers(customCfg.servers));

  // Most recently used first; the last-used login is badged instead of getting a
  // dedicated connect button.
  const sortedAccounts = sortAccountsByRecency(accounts, lastLogin);

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
    } catch (e) {
      setError(String(e));
      if (tachyon) setNeedsSignIn(account);
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
                : status.away
                  ? "You've been set away automatically while idle."
                  : "Tell others you're not at the keyboard."}
            </span>
          </span>
          <Switch
            id="lobby-manual-away"
            checked={manualAway}
            onCheckedChange={setManualAway}
            disabled={!ready}
          />
        </label>
        <Link
          to="/chat"
          onClick={onNavigate}
          className="inline-flex h-8 items-center justify-center rounded-md border border-border text-sm font-medium hover:bg-accent"
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

  if (busy) {
    const phase = mirror.phase ? PHASE_LABEL[mirror.phase] : undefined;
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
          <Button onClick={() => void cancelConnect()} className="h-8 w-full">
            Cancel
          </Button>
        )}
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <p className="px-2 pb-1 text-sm font-medium">
        {revealed ? "Reconnect to multiplayer" : "Connect to multiplayer"}
      </p>
      {reconnect && (
        <Button
          onClick={() => void connectTo(reconnect.account)}
          disabled={busy}
          className="mb-1 h-9 justify-start gap-2"
        >
          <RefreshCw className="size-4" />
          Reconnect as {reconnect.account.username || "last account"}
        </Button>
      )}
      {sortedAccounts.map((a) => {
        const server = resolveServer(a.serverId, customCfg.servers);
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
            onClick={() => connectTo(a)}
            disabled={busy}
            className="flex flex-col items-start rounded-md px-2 py-1.5 text-left hover:bg-accent disabled:pointer-events-none disabled:opacity-50"
          >
            <span className="flex w-full items-center gap-2 text-base font-semibold leading-tight">
              {a.username || "(no username)"}
              {isLastLogin(a, lastLogin) && (
                <span className="ml-auto rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary">
                  Last used
                </span>
              )}
            </span>
            <span className="text-xs text-muted-foreground">
              {server?.name ?? "Unknown server"}
              {opensBrowser && " · signs in with your browser"}
            </span>
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
      <button
        type="button"
        onClick={() => setRegistering(true)}
        className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
      >
        <UserPlus className="size-4" />
        Register a new account
      </button>
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
      {mirror.loginError ? (
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
