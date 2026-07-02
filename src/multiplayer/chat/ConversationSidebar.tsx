import { Button, Input } from "@picoframe/frame";
import { Hash, MessageSquare, Search } from "lucide-react";
import { useState } from "react";
import { useMultiplayer } from "../store";
import { type ConversationDescriptor, convId } from "./conversation";

function Badge({ n }: { n: number }) {
  if (n <= 0) return null;
  return (
    <span className="ml-auto min-w-5 rounded-full bg-primary px-1.5 text-center text-xs text-primary-foreground">
      {n > 99 ? "99+" : n}
    </span>
  );
}

/** The left rail: channels, DMs, unread badges, browse + new-DM affordances. */
export function ConversationSidebar({
  active,
  onSelect,
  onBrowse,
}: {
  active: ConversationDescriptor | null;
  onSelect: (d: ConversationDescriptor) => void;
  onBrowse: () => void;
}) {
  const { mirror, unreadFor } = useMultiplayer();
  const state = mirror.state;
  const channels = state ? Object.keys(state.channels).sort() : [];
  const peers = state ? Object.keys(state.dms ?? {}).sort() : [];
  const [newDm, setNewDm] = useState("");

  const activeId = active ? convId(active) : null;

  function rowClass(id: string): string {
    return `flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm ${
      id === activeId ? "bg-muted font-medium" : "hover:bg-muted"
    }`;
  }

  function startDm() {
    const peer = newDm.trim();
    if (!peer) return;
    setNewDm("");
    onSelect({ kind: "dm", peer });
  }

  return (
    <nav className="flex w-60 shrink-0 flex-col border-r border-border">
      <div className="flex items-center justify-between px-3 py-3">
        <span className="text-sm font-semibold">Channels</span>
        <Button
          onClick={onBrowse}
          aria-label="Browse channels"
          className="h-7 px-2"
        >
          <Search className="size-4" />
        </Button>
      </div>
      <ul className="flex flex-col gap-0.5 px-2">
        {channels.map((name) => {
          const id = `channel:${name}`;
          const count = state?.channels[name].messages.length ?? 0;
          return (
            <li key={id}>
              <button
                type="button"
                className={rowClass(id)}
                onClick={() => onSelect({ kind: "channel", name })}
              >
                <Hash className="size-4 shrink-0 text-muted-foreground" />
                <span className="truncate">{name}</span>
                <Badge n={unreadFor(id, count)} />
              </button>
            </li>
          );
        })}
        {channels.length === 0 && (
          <li className="px-2 py-1.5 text-xs text-muted-foreground">
            No channels joined. Browse to join one.
          </li>
        )}
      </ul>

      <div className="mt-4 px-3 py-2 text-sm font-semibold">
        Direct messages
      </div>
      <ul className="flex flex-col gap-0.5 px-2">
        {peers.map((peer) => {
          const id = `dm:${peer}`;
          const count = state?.dms[peer].length ?? 0;
          return (
            <li key={id}>
              <button
                type="button"
                className={rowClass(id)}
                onClick={() => onSelect({ kind: "dm", peer })}
              >
                <MessageSquare className="size-4 shrink-0 text-muted-foreground" />
                <span className="truncate">{peer}</span>
                <Badge n={unreadFor(id, count)} />
              </button>
            </li>
          );
        })}
      </ul>

      <div className="mt-auto flex gap-2 border-t border-border p-3">
        <Input
          value={newDm}
          onChange={(e) => setNewDm(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") startDm();
          }}
          placeholder="New DM: username"
          aria-label="Start a direct message"
        />
      </div>
    </nav>
  );
}
