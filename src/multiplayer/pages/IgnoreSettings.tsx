import { Button, Input } from "@picoframe/frame";
import { Plus, Trash2, UserX } from "lucide-react";
import { useState } from "react";
import { addIgnore, ignoredFor, removeIgnore, useIgnored } from "../ignore";
import { useMultiplayer } from "../store";

/**
 * Settings section for the local ignore list. Ignores are per-account, keyed by the
 * live `serverKey` (`username@host:port`), so the editor targets the connected
 * account; when disconnected it explains that a connection is required. Ignored
 * users' channel and private messages are hidden client-side (see `useConversation`).
 */
export default function IgnoreSettings() {
  const { activeKey } = useMultiplayer();
  const [map, setMap] = useIgnored();
  const [draft, setDraft] = useState("");

  if (!activeKey) {
    return (
      <p className="text-sm text-muted-foreground">
        Ignores are per-account. Connect to a lobby server to manage the ignore
        list for that account.
      </p>
    );
  }

  const list = ignoredFor(map, activeKey);

  const add = () => {
    const name = draft.trim();
    if (!name) return;
    setMap(addIgnore(map, activeKey, name));
    setDraft("");
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Hidden users' channel and private messages are hidden in the client.
      </p>

      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="username"
          aria-label="Username to ignore"
        />
        <Button type="submit" disabled={!draft.trim()}>
          <Plus className="size-4" /> Ignore
        </Button>
      </form>

      {list.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No ignored users. Add one above, or use the ignore action next to a
          user in chat.
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {list.map((name) => (
            <li
              key={name.toLowerCase()}
              className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm"
            >
              <UserX className="size-4 shrink-0 text-muted-foreground" />
              <span className="truncate">{name}</span>
              <Button
                variant="outline"
                size="sm"
                className="ml-auto"
                onClick={() => setMap(removeIgnore(map, activeKey, name))}
                aria-label={`Stop ignoring ${name}`}
              >
                <Trash2 className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
