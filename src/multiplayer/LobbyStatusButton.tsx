import { Button } from "@picoframe/frame";
import { Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useLobbyServers } from "../lobby-servers/config";
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

  const [selectedId, setSelectedId] = useState("");
  const [error, setError] = useState<string | null>(null);

  const selected = useMemo(
    () => servers.find((s) => s.id === selectedId),
    [servers, selectedId],
  );

  // Auto-select the first server once the directory loads (or when the current
  // selection is gone), so Connect is usable without a manual pick.
  useEffect(() => {
    if (servers.length > 0 && !servers.some((s) => s.id === selectedId)) {
      setSelectedId(servers[0].id);
    }
  }, [servers, selectedId]);

  async function onConnect() {
    if (!selected) {
      setError("Pick a server first.");
      return;
    }
    setError(null);
    try {
      await connect(selected);
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
    const username =
      mirror.state?.myUsername ?? selected?.username ?? "Connected";
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
    <div className="flex flex-col gap-3">
      <p className="text-sm font-medium">Connect to multiplayer</p>
      <Select value={selectedId} onValueChange={setSelectedId} disabled={busy}>
        <SelectTrigger className="w-full" aria-label="Lobby server">
          <SelectValue placeholder="Select a server" />
        </SelectTrigger>
        <SelectContent>
          {servers.map((s) => (
            <SelectItem key={s.id} value={s.id}>
              {s.name} ({s.host}:{s.port})
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        onClick={onConnect}
        disabled={busy || servers.length === 0}
        className="h-8"
      >
        {busy ? "Connecting…" : "Connect"}
      </Button>
      {error && <p className="text-xs text-destructive">{error}</p>}
      {mirror.error && (
        <p className="text-xs text-destructive">Disconnected: {mirror.error}</p>
      )}
      <Link
        to="/settings/lobby-servers"
        onClick={onNavigate}
        className="text-xs text-muted-foreground hover:text-foreground"
      >
        Manage servers
      </Link>
    </div>
  );
}
