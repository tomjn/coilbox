import { Button, Input } from "@picoframe/frame";
import { Hash, Plus, Trash2 } from "lucide-react";
import {
  type JoinedChannel,
  normalizeChannelList,
  useJoinedChannels,
} from "../../../multiplayer/channels";
import { useMultiplayer } from "../../../multiplayer/store";

/**
 * Editor for an account's auto-join channel list, keyed by its `serverKey`
 * (`username@host:port`). This is the same list manual joins add to, so edits here
 * and in the chat browser converge. Rows are edited by index (names may be blank or
 * duplicated while typing); the store skips blank names when auto-joining. Keys are
 * shared low-sensitivity secrets stored in plaintext settings, matching SpringLobby.
 */
export function AutojoinChannels({ serverKey }: { serverKey: string }) {
  const [all, setAll] = useJoinedChannels();
  const list = normalizeChannelList(all[serverKey]);

  // Channels the server refused to (re)join this session, flagged so the user can
  // see why an entry isn't working and remove it. Only meaningful for the account
  // that's actually connected, so scope it to the active connection.
  const { activeKey, channelJoinFailures } = useMultiplayer();
  const failures = serverKey === activeKey ? channelJoinFailures : {};

  const persist = (next: JoinedChannel[]) =>
    setAll({ ...all, [serverKey]: next });

  const updateRow = (i: number, patch: Partial<JoinedChannel>) =>
    persist(list.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));

  const removeRow = (i: number) => persist(list.filter((_, idx) => idx !== i));

  const addRow = () => persist([...list, { name: "" }]);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Hash size={14} className="text-muted-foreground" />
        Auto-join channels
      </div>
      {list.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          None. Channels you join are added here; add one to auto-join it on
          connect.
        </p>
      ) : (
        <ul className="space-y-2">
          {list.map((c, i) => {
            const failure = c.name ? failures[c.name] : undefined;
            return (
              <li
                // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional (names may be blank/duplicate while editing)
                key={i}
                className="space-y-1"
              >
                <div className="grid grid-cols-[1fr_1fr_auto] items-center gap-2">
                  <Input
                    value={c.name}
                    onChange={(e) => updateRow(i, { name: e.target.value })}
                    placeholder="channel"
                    aria-label="Channel name"
                  />
                  <Input
                    value={c.key ?? ""}
                    onChange={(e) =>
                      updateRow(i, { key: e.target.value || undefined })
                    }
                    placeholder="key (optional)"
                    aria-label="Channel key"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => removeRow(i)}
                    aria-label={`Remove ${c.name || "channel"}`}
                  >
                    <Trash2 />
                  </Button>
                </div>
                {failure !== undefined && (
                  <p className="text-xs text-destructive">
                    Last join failed{failure ? `: ${failure}` : ""}. Remove it
                    if you no longer have access.
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <Button variant="outline" size="sm" onClick={addRow}>
        <Plus /> Add channel
      </Button>
    </div>
  );
}
