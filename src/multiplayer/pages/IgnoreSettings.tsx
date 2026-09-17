import { Button, Input } from "@picoframe/frame";
import { Plus, Trash2, UserX } from "lucide-react";
import { useState } from "react";
import { AccountPicker } from "../AccountPicker";
import { useIgnoreActions } from "../ignore";
import { liveConnectionKeys, useMultiplayer } from "../store";

/**
 * Settings section for the ignore list. Ignores are per-account, keyed by the live
 * `serverKey` (`username@host:port`), so the editor targets one connected account.
 * When disconnected it explains that a connection is required. With more than one
 * connection live, a picker chooses which one (issue #2846). With one, the editor
 * targets it without asking, exactly as it did before a second connection was
 * possible. Ignored users' channel and private messages are hidden client-side
 * (see `useConversation`), and the change is synced to the server's ignore list
 * where supported.
 */
export default function IgnoreSettings() {
  const { connections, activeKey } = useMultiplayer();
  const liveKeys = liveConnectionKeys(connections, activeKey);
  const [manualPick, setManualPick] = useState<string | null>(null);
  const pickedKey =
    manualPick && liveKeys.includes(manualPick)
      ? manualPick
      : (liveKeys[0] ?? null);

  const { list, ignore, unignore } = useIgnoreActions(pickedKey);
  const [draft, setDraft] = useState("");

  if (!pickedKey) {
    return (
      <p className="text-sm text-muted-foreground">
        Ignores are per-account. Connect to a lobby server to manage the ignore
        list for that account.
      </p>
    );
  }

  const add = () => {
    const name = draft.trim();
    if (!name) return;
    ignore(name);
    setDraft("");
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Hidden users' channel and private messages are hidden in the client.
      </p>

      {liveKeys.length > 1 && (
        <AccountPicker
          keys={liveKeys}
          value={pickedKey}
          onChange={setManualPick}
        />
      )}

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
                onClick={() => unignore(name)}
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
