import { Button, Input } from "@picoframe/frame";
import { ChevronRight, X } from "lucide-react";
import { useState } from "react";
import { createPortal } from "react-dom";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import type { LobbyProtocol } from "../lobby-servers/config";
import { mpSend } from "./bindings";
import { useMultiplayer } from "./store";
import {
  consoleView,
  MAX_FRAME_CHARS,
  parseTachyonEntry,
  type TachyonConsoleEntry,
} from "./tachyonConsole";

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
 *
 * The log has two views, chosen by the protocol the live connection speaks. A
 * TASServer connection carries wire lines, so they are shown as they arrive. A
 * Tachyon connection carries JSON frames, which read as noise on one line, so each
 * frame gets a row naming what it is and expands to the frame in full. The send box
 * belongs to the line protocol and is left out of the Tachyon view, because a wire
 * line means nothing to a Tachyon server: the connection task drops it and writes a
 * note saying so.
 */
export function ConsoleDrawer({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { mirror, activeKey, protocol } = useMultiplayer();
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
          <ConsoleLog lines={lines} protocol={protocol} />
        </div>
        {consoleView(protocol) === "lines" && (
          <form
            onSubmit={send}
            className="flex gap-2 border-t border-border p-3"
          >
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
        )}
      </aside>
    </>,
    document.body,
  );
}

/** The log itself, in whichever of the two views the connection calls for. */
function ConsoleLog({
  lines,
  protocol,
}: {
  lines: string[];
  protocol: LobbyProtocol;
}) {
  if (lines.length === 0) {
    return (
      <p className="p-4 text-sm text-muted-foreground">
        No console output yet.
      </p>
    );
  }
  if (consoleView(protocol) === "frames") return <TachyonLog lines={lines} />;
  return (
    <pre className="whitespace-pre-wrap break-words p-4 text-xs">
      {lines.join("\n")}
    </pre>
  );
}

/** One row per Tachyon frame, in the order they crossed the socket. */
function TachyonLog({ lines }: { lines: string[] }) {
  return (
    <ul className="divide-y divide-border">
      {lines.map((line, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: log lines are append-only, so the index is a stable key
        <li key={i} className="min-w-0">
          <TachyonFrame entry={parseTachyonEntry(line)} />
        </li>
      ))}
    </ul>
  );
}

/**
 * One frame: a row saying what it is, expanding to the frame in full.
 *
 * The row carries the direction, the type, the command id and the status, which
 * are what a reader scans a log for, plus the reason when a response failed. The
 * payload is behind the expander, because a lobby list would otherwise bury the
 * next twenty frames. Everything on the row is held to one line and the frame
 * itself scrolls in its own box, so one enormous frame cannot stretch the drawer.
 */
function TachyonFrame({ entry }: { entry: TachyonConsoleEntry }) {
  const arrow = entry.direction === "out" ? ">>" : "<<";
  const direction = entry.direction === "out" ? "sent" : "received";

  // Not a frame at all: a note the connection task wrote, or something the server
  // sent that is not JSON. Shown as it stands, wrapped rather than truncated,
  // because there is nothing to expand into.
  if (!entry.json) {
    return (
      <p className="flex gap-2 px-3 py-1.5 font-mono text-xs">
        <span className="shrink-0 text-muted-foreground" aria-hidden="true">
          {arrow}
        </span>
        <span className="sr-only">{direction}</span>
        <span className="min-w-0 whitespace-pre-wrap [overflow-wrap:anywhere]">
          {entry.body}
        </span>
      </p>
    );
  }

  return (
    <Collapsible className="min-w-0">
      <CollapsibleTrigger className="group flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left font-mono text-xs hover:bg-accent/50">
        <ChevronRight className="size-3.5 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none group-data-[state=open]:rotate-90" />
        <span className="shrink-0 text-muted-foreground" aria-hidden="true">
          {arrow}
        </span>
        <span className="sr-only">{direction}</span>
        {entry.type ? (
          <Badge variant="outline" className="shrink-0">
            {entry.type}
          </Badge>
        ) : null}
        <span className="min-w-0 truncate">
          {entry.commandId ?? "no command id"}
        </span>
        {entry.status ? (
          <Badge
            variant={entry.status === "failed" ? "destructive" : "secondary"}
            className="shrink-0"
          >
            {entry.status}
          </Badge>
        ) : null}
        {entry.reason ? (
          <span className="min-w-0 truncate text-destructive">
            {entry.reason}
          </span>
        ) : null}
      </CollapsibleTrigger>
      <CollapsibleContent>
        {entry.details ? (
          <p className="px-3 pb-1 text-xs text-muted-foreground">
            {entry.details}
          </p>
        ) : null}
        <pre className="max-h-64 overflow-auto px-3 pb-2 font-mono text-xs">
          {entry.body}
        </pre>
        {entry.truncated ? (
          <p className="px-3 pb-2 text-xs text-muted-foreground">
            Cut short at {MAX_FRAME_CHARS} characters.
          </p>
        ) : null}
      </CollapsibleContent>
    </Collapsible>
  );
}
