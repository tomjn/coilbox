import { Button } from "@picoframe/frame";
import { Plus, Users } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { type LobbyServer, useLobbyServers } from "../lobby-servers/config";
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
 * server is configured and nothing is connected. The open state is controlled by
 * MultiplayerContext so not-connected CTAs elsewhere can open this same popover.
 */
export default function LobbyStatusButton() {
  const [cfg] = useLobbyServers();
  const {
    mirror,
    activeKey,
    busy,
    loginPopoverOpen,
    openLoginPopover,
    closeLoginPopover,
  } = useMultiplayer();

  const hasServers = cfg.servers.length > 0;
  if (!hasServers && activeKey == null) return null;

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

function LoginPanel({ onNavigate }: { onNavigate: () => void }) {
  const [cfg] = useLobbyServers();
  const servers = cfg.servers;
  const { mirror, activeKey, busy, connect, disconnect } = useMultiplayer();

  const [error, setError] = useState<string | null>(null);

  async function connectTo(server: LobbyServer) {
    setError(null);
    try {
      await connect(server);
    } catch (e) {
      setError(String(e));
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
        <div className="flex gap-2">
          <Link
            to="/lobby"
            onClick={onNavigate}
            className="inline-flex h-8 flex-1 items-center justify-center rounded-md border border-border text-sm font-medium hover:bg-muted"
          >
            Lobby
          </Link>
          <Link
            to="/chat"
            onClick={onNavigate}
            className="inline-flex h-8 flex-1 items-center justify-center rounded-md border border-border text-sm font-medium hover:bg-muted"
          >
            Chat
          </Link>
        </div>
        <Button onClick={onDisconnect} disabled={busy} className="h-8">
          Log out
        </Button>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <p className="px-2 pb-1 text-sm font-medium">Connect to multiplayer</p>
      {servers.map((s) => (
        <button
          key={s.id}
          type="button"
          onClick={() => connectTo(s)}
          disabled={busy}
          className="flex flex-col items-start rounded-md px-2 py-1.5 text-left hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
        >
          <span className="text-base font-semibold leading-tight">
            {s.username ?? s.name}
          </span>
          <span className="text-xs text-muted-foreground">{s.name}</span>
        </button>
      ))}
      <Link
        to="/settings/lobby-servers"
        onClick={onNavigate}
        className="mt-1 flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <Plus className="size-4" />
        Add a server
      </Link>
      {busy && (
        <p className="px-2 pt-1 text-xs text-muted-foreground">Connecting…</p>
      )}
      {error && <p className="px-2 pt-1 text-xs text-destructive">{error}</p>}
      {mirror.error && (
        <p className="px-2 pt-1 text-xs text-destructive">
          Disconnected: {mirror.error}
        </p>
      )}
    </div>
  );
}
