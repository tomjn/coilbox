import { Button, Input } from "@picoframe/frame";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { conflictKeys, type Keymap, keymapText } from "../../keymap";

/**
 * Every binding, searchable.
 *
 * The keyboard above cannot show a keychain (two keysets pressed in sequence
 * have no one place to sit) and cannot show what is bound to a key the layout
 * leaves out, so this is the complete view, and the way in when a player knows
 * the action but not the key.
 */
export function BindingList({
  keymap,
  onSelect,
  onRemove,
}: {
  keymap: Keymap;
  /** Open a keyset in the editor above. */
  onSelect: (keys: string) => void;
  onRemove: (keys: string, action: string) => void;
}) {
  const [filter, setFilter] = useState("");

  const conflicts = useMemo(
    () => new Set(conflictKeys(keymap.bindings)),
    [keymap.bindings],
  );

  const rows = useMemo(() => {
    const q = filter.trim().toLowerCase();
    // Sort by keyset so a multi-bound key's actions sit together, and keep the
    // keymap's own order within a keyset, because that is the order the engine
    // tries them in.
    const withIndex = keymap.bindings.map((b, i) => ({ b, i }));
    return withIndex
      .filter(
        ({ b }) =>
          !q ||
          b.keys.toLowerCase().includes(q) ||
          b.action.toLowerCase().includes(q),
      )
      .sort((x, y) => x.b.keys.localeCompare(y.b.keys) || x.i - y.i)
      .map(({ b }) => b);
  }, [keymap.bindings, filter]);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Search by key or action"
        />
        <span className="shrink-0 text-xs text-muted-foreground">
          {rows.length} of {keymap.bindings.length}
        </span>
      </div>

      <div className="max-h-96 overflow-y-auto rounded-lg border border-border/50">
        <table className="w-full text-sm">
          <tbody>
            {rows.map((b) => (
              <tr
                key={`${b.keys} ${b.action}`}
                className="border-border/30 border-b last:border-0"
              >
                <td className="w-48 px-2 py-1">
                  <button
                    type="button"
                    onClick={() => onSelect(b.keys)}
                    className="truncate font-mono text-xs underline-offset-4 hover:underline"
                  >
                    {b.keys}
                  </button>
                </td>
                <td className="px-2 py-1 font-mono text-xs">{b.action}</td>
                <td className="w-40 px-2 py-1 text-right">
                  {b.source === "user" ? (
                    <Badge variant="outline" className="text-[10px]">
                      yours
                    </Badge>
                  ) : null}
                  {conflicts.has(b.keys) ? (
                    <Badge variant="outline" className="ml-1 text-[10px]">
                      shared key
                    </Badge>
                  ) : null}
                </td>
                <td className="w-24 px-2 py-1 text-right">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => onRemove(b.keys, b.action)}
                  >
                    Remove
                  </Button>
                </td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={4}
                  className="px-2 py-4 text-center text-muted-foreground text-sm"
                >
                  No binding matches that.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <Collapsible>
        <CollapsibleTrigger className="text-muted-foreground text-xs underline-offset-4 hover:underline">
          Show the file this would write
        </CollapsibleTrigger>
        <CollapsibleContent>
          <pre className="mt-2 max-h-80 overflow-auto rounded-lg border border-border/50 bg-muted/20 p-2 font-mono text-xs">
            {keymapText(keymap)}
          </pre>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
