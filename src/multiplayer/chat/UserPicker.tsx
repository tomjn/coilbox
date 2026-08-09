import { Button, cn, Input } from "@picoframe/frame";
import { Plus } from "lucide-react";
import { useMemo, useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useMultiplayer } from "../store";
import { PRESENCE_META, userPresence } from "./presence";

/**
 * A "+" that opens a popover, searches the users currently online on the
 * connected server and hands back the one you pick. Next to Direct messages it
 * starts a DM (channel member lists remain the other entry), and in the Party
 * section it sends an invitation.
 *
 * Presence data only covers the live connection, so the list is exactly
 * `mirror.state.users` minus yourself and minus `exclude`. There is no
 * server-side user directory to search beyond who is online right now.
 */
export function UserPicker({
  onPick,
  label = "New direct message",
  exclude = [],
}: {
  onPick: (username: string) => void;
  /** What the "+" is for, read out to screen readers. */
  label?: string;
  /** Names to leave out, such as the people already in your party. */
  exclude?: string[];
}) {
  const { mirror, activeKey } = useMultiplayer();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  // Your own username is the local part of the connection key (`username@host:port`).
  const self = activeKey ? activeKey.split("@")[0] : null;

  const matches = useMemo(() => {
    const users = mirror.state ? Object.values(mirror.state.users) : [];
    const q = query.trim().toLowerCase();
    const leftOut = new Set(exclude);
    return users
      .filter((u) => u.name !== self && !leftOut.has(u.name))
      .filter((u) => (q ? u.name.toLowerCase().includes(q) : true))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [mirror.state, self, query, exclude]);

  function pick(username: string) {
    onPick(username);
    setOpen(false);
    setQuery("");
  }

  return (
    <Popover
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) setQuery("");
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="secondary" aria-label={label} className="h-7 px-2">
          <Plus className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 space-y-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search online users…"
          autoFocus
        />
        <ul className="flex max-h-64 flex-col gap-0.5 overflow-auto">
          {matches.map((u) => {
            const presence = mirror.state
              ? userPresence(mirror.state, u.name)
              : "online";
            const meta = PRESENCE_META[presence];
            return (
              <li key={u.name}>
                <button
                  type="button"
                  onClick={() => pick(u.name)}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
                >
                  <span className="truncate">{u.name}</span>
                  <span
                    className="ml-auto flex shrink-0 items-center gap-1 text-xs text-muted-foreground"
                    title={meta.label}
                  >
                    {presence !== "online" && meta.label}
                    <span
                      aria-hidden
                      className={cn("size-2 rounded-full", meta.dotClass)}
                    />
                  </span>
                </button>
              </li>
            );
          })}
          {matches.length === 0 && (
            <li className="px-2 py-1.5 text-sm text-muted-foreground">
              {query.trim() ? "No matching users." : "No other users online."}
            </li>
          )}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
