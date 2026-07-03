import { Button, Input } from "@picoframe/frame";
import { useState } from "react";
import { mpLeaveBattle, mpSayBattle } from "../bindings";
import { useMultiplayer } from "../store";

/**
 * The lobby client screen. Deliberately plain (UI/UX polish is a follow-up): a
 * server picker, a Connect/Disconnect control, the login phase, and a minimal chat
 * for the joined battle. Browsing and joining battles lives on the dedicated Battles
 * page; starting a direct message lives in Chat; the raw protocol console lives in
 * Settings > Lobby servers. This exists to prove the connection/state/command
 * plumbing end to end.
 *
 * Default-exported for the frame's lazy route convention.
 */
export default function LobbyPage() {
  // Connection + mirror live in the app-level provider so they survive navigation.
  const { mirror, activeKey, openLoginPopover } = useMultiplayer();

  const [error, setError] = useState<string | null>(null);
  const [chatInput, setChatInput] = useState("");

  const state = mirror.state;
  const currentBattle =
    state?.currentBattle != null
      ? state.battles[String(state.currentBattle)]
      : undefined;
  const currentChannel =
    currentBattle?.channel != null
      ? state?.channels[currentBattle.channel]
      : undefined;

  async function leave() {
    if (!activeKey) return;
    try {
      await mpLeaveBattle({ serverKey: activeKey });
    } catch (e) {
      setError(String(e));
    }
  }

  async function sendChat() {
    if (!activeKey || !currentBattle || !chatInput.trim()) return;
    try {
      await mpSayBattle({ serverKey: activeKey, message: chatInput.trim() });
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
          Connect to a lobby server. Browse and join battles on the Battles
          page.
        </p>
      </header>

      {!activeKey && (
        <section className="flex flex-col items-start gap-3">
          <p className="text-sm text-muted-foreground">
            You are not connected to a lobby server.
          </p>
          <Button onClick={openLoginPopover}>Connect…</Button>
        </section>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
      {mirror.error && (
        <p className="text-sm text-destructive">Disconnected: {mirror.error}</p>
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
            />
            <Button onClick={sendChat}>Send</Button>
          </div>
        </section>
      )}
    </main>
  );
}
