import { Button, Input } from "@picoframe/frame";
import { useEffect, useMemo, useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useLobbyServers } from "../../lobby-servers/config";
import { mpJoinBattle, mpLeaveBattle, mpSay } from "../bindings";
import { useMultiplayer } from "../store";

/**
 * The lobby client screen. Deliberately plain (UI/UX polish is a follow-up): a
 * server picker, a Connect/Disconnect control, the login phase, the online-user and
 * open-battle lists, a minimal chat for the joined battle, and a raw protocol
 * console. This exists to prove the connection/state/command plumbing end to end.
 *
 * Default-exported for the frame's lazy route convention.
 */
export default function LobbyPage() {
  const [cfg] = useLobbyServers();
  const servers = cfg.servers;
  // Connection + mirror live in the app-level provider so they survive navigation.
  const { mirror, activeKey, busy, connect, disconnect } = useMultiplayer();

  const [selectedId, setSelectedId] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [chatInput, setChatInput] = useState("");

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

  const state = mirror.state;
  const users = state ? Object.values(state.users) : [];
  const battles = state ? Object.values(state.battles) : [];
  const currentBattle =
    state?.currentBattle != null
      ? state.battles[String(state.currentBattle)]
      : undefined;
  const currentChannel =
    currentBattle?.channel != null
      ? state?.channels[currentBattle.channel]
      : undefined;

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

  async function join(id: number) {
    if (!activeKey) return;
    try {
      await mpJoinBattle({ serverKey: activeKey, id });
    } catch (e) {
      setError(String(e));
    }
  }

  async function leave() {
    if (!activeKey) return;
    try {
      await mpLeaveBattle({ serverKey: activeKey });
    } catch (e) {
      setError(String(e));
    }
  }

  async function sendChat() {
    const channel = currentBattle?.channel;
    if (!activeKey || !channel || !chatInput.trim()) return;
    try {
      await mpSay({ serverKey: activeKey, channel, message: chatInput.trim() });
      setChatInput("");
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <main className="flex flex-col gap-6 p-6">
      <header>
        <h1 className="text-lg font-semibold">Lobby</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Connect to a lobby server, browse open battles, and join a game.
        </p>
      </header>

      {/* Connection controls */}
      <section className="flex flex-wrap items-center gap-3">
        <Select
          value={selectedId}
          onValueChange={setSelectedId}
          disabled={activeKey != null || busy}
        >
          <SelectTrigger className="w-64" aria-label="Lobby server">
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

        {activeKey ? (
          <Button onClick={onDisconnect} disabled={busy}>
            Disconnect
          </Button>
        ) : (
          <Button onClick={onConnect} disabled={busy || servers.length === 0}>
            Connect
          </Button>
        )}

        <span className="text-sm text-muted-foreground">
          {mirror.connected
            ? `Phase: ${mirror.phase ?? "…"}`
            : activeKey
              ? "Connecting…"
              : "Not connected"}
        </span>
      </section>

      {servers.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No servers configured. Add one under Settings first.
        </p>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
      {mirror.error && (
        <p className="text-sm text-destructive">Disconnected: {mirror.error}</p>
      )}

      {state && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Open battles */}
          <section>
            <h2 className="mb-2 text-sm font-semibold">
              Battles ({battles.length})
            </h2>
            <ul className="flex flex-col gap-2">
              {battles.map((b) => (
                <li
                  key={b.id}
                  className="flex items-center justify-between gap-3 rounded-md border border-border p-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {b.title || `Battle ${b.id}`}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {b.map} · {b.host} · {Object.keys(b.members).length}/
                      {b.maxPlayers}
                      {b.passworded ? " · locked" : ""}
                    </p>
                  </div>
                  <Button
                    onClick={() => join(b.id)}
                    disabled={mirror.phase !== "ready"}
                  >
                    Join
                  </Button>
                </li>
              ))}
              {battles.length === 0 && (
                <li className="text-sm text-muted-foreground">
                  No open battles.
                </li>
              )}
            </ul>
          </section>

          {/* Online users */}
          <section>
            <h2 className="mb-2 text-sm font-semibold">
              Online ({users.length})
            </h2>
            <ul className="flex max-h-72 flex-col gap-1 overflow-auto">
              {users.map((u) => (
                <li key={u.name} className="text-sm">
                  {u.name}
                  {u.status.ingame && (
                    <span className="ml-2 text-xs text-muted-foreground">
                      in-game
                    </span>
                  )}
                  {u.status.away && (
                    <span className="ml-2 text-xs text-muted-foreground">
                      away
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}

      {/* Current battle chat */}
      {currentBattle && (
        <section className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">
              In battle: {currentBattle.title || currentBattle.id}
            </h2>
            <Button onClick={leave}>Leave battle</Button>
          </div>
          <ul className="flex max-h-48 flex-col gap-1 overflow-auto rounded-md border border-border p-3">
            {(currentChannel?.messages ?? []).map((m, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: chat log is append-only, so the index is a stable identity.
              <li key={`${m.from}-${i}`} className="text-sm">
                <span className="font-medium">{m.from}:</span> {m.text}
              </li>
            ))}
            {(currentChannel?.messages?.length ?? 0) === 0 && (
              <li className="text-sm text-muted-foreground">
                No messages yet.
              </li>
            )}
          </ul>
          <div className="flex gap-2">
            <Input
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") sendChat();
              }}
              placeholder="Message the battle…"
              disabled={!currentBattle.channel}
            />
            <Button onClick={sendChat} disabled={!currentBattle.channel}>
              Send
            </Button>
          </div>
        </section>
      )}

      {/* Protocol console (debug) */}
      {mirror.consoleLines.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold">Console</h2>
          <pre className="max-h-48 overflow-auto rounded-md border border-border bg-muted/30 p-3 text-xs">
            {mirror.consoleLines.join("\n")}
          </pre>
        </section>
      )}
    </main>
  );
}
