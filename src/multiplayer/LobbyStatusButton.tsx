import { Button } from "@picoframe/frame";
import { Loader2, Plus, UserPlus, Users } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  allServers,
  type LobbyAccount,
  resolveServer,
  useCustomServers,
  useLobbyAccounts,
} from "../lobby-servers/config";
import { RegisterForm } from "../lobby-servers/RegisterForm";
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

export function LoginPanel({ onNavigate }: { onNavigate: () => void }) {
  const [accountsCfg] = useLobbyAccounts();
  const [customCfg] = useCustomServers();
  const accounts = accountsCfg.accounts;
  const { mirror, activeKey, revealed, busy, connect, disconnect } =
    useMultiplayer();

  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<LobbyAccount | null>(null);
  const [registering, setRegistering] = useState(false);

  async function connectTo(account: LobbyAccount) {
    setError(null);
    setPending(account);
    try {
      const server = resolveServer(account.serverId, customCfg.servers);
      if (!server) {
        throw new Error(
          "This login's server no longer exists (check Settings).",
        );
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
            className="flex flex-col items-start rounded-md px-2 py-1.5 text-left hover:bg-accent disabled:pointer-events-none disabled:opacity-50"
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
