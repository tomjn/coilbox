import { Button, Input } from "@picoframe/frame";
import { X } from "lucide-react";
import { useState } from "react";
import { createPortal } from "react-dom";
import { mpSend } from "./bindings";
import { useMultiplayer } from "./store";

/**
 * A right-edge slide-in drawer showing the raw lobby protocol log
 * (`mirror.consoleLines`), with a command input that sends an arbitrary wire line
 * via `mpSend` (the raw escape hatch). Lives off a button in Settings > Lobby
 * servers so the debug console stays out of the main lobby UI. Unlike the chat-pane
 * drawers this one is viewport-anchored (`fixed`), since the settings page has no
 * positioned container to anchor an absolute drawer to — and portalled to `<body>`
 * so a transformed/filtered ancestor can't hijack `fixed` and cut the drawer short
 * of the window bottom. Motion is disabled under prefers-reduced-motion via the
 * `motion-reduce:` variants.
 */
export function ConsoleDrawer({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { mirror, activeKey } = useMultiplayer();
  const lines = mirror.consoleLines;
  const [command, setCommand] = useState("");

  function send(e: React.FormEvent) {
    e.preventDefault();
    const line = command.trim();
    if (!line || !activeKey) return;
    // The sent line and any reply surface in `consoleLines` via the protocol layer.
    mpSend({ serverKey: activeKey, line }).catch(() => {});
    setCommand("");
  }

  return createPortal(
    <>
      {open && (
        <button
          type="button"
          aria-label="Close protocol console"
          className="fixed inset-0 z-40 bg-black/20"
          onClick={onClose}
        />
      )}
      <aside
        className={`fixed inset-y-0 right-0 z-50 flex w-[32rem] max-w-full flex-col border-l border-border bg-background shadow-lg transition-transform motion-reduce:transition-none ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
        inert={!open}
      >
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">Protocol console</h2>
          <Button className="h-7 px-2" onClick={onClose} aria-label="Close">
            <X className="size-4" />
          </Button>
        </header>
        <div className="flex-1 overflow-auto">
          {lines.length > 0 ? (
            <pre className="whitespace-pre-wrap break-words p-4 text-xs">
              {lines.join("\n")}
            </pre>
          ) : (
            <p className="p-4 text-sm text-muted-foreground">
              No console output yet.
            </p>
          )}
        </div>
        <form onSubmit={send} className="flex gap-2 border-t border-border p-3">
          <Input
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            placeholder={
              activeKey ? "Send a raw command…" : "Connect to send commands"
            }
            disabled={!activeKey}
            className="font-mono text-xs"
          />
          <Button type="submit" disabled={!activeKey || !command.trim()}>
            Send
          </Button>
        </form>
      </aside>
    </>,
    document.body,
  );
}
