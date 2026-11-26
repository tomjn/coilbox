import { Trans, useLingui } from "@lingui/react/macro";
import { Button, Input } from "@picoframe/frame";
import { X } from "lucide-react";
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
  const { t } = useLingui();
  const [filter, setFilter] = useState("");

  const conflicts = useMemo(
    () => new Set(conflictKeys(keymap.bindings)),
    [keymap.bindings],
  );

  const total = keymap.bindings.length;
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

  const shown = rows.length;
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={t`Search by key or action`}
          aria-label={t`Search by key or action`}
        />
        <span className="shrink-0 text-xs text-muted-foreground">
          <Trans>
            {shown} of {total}
          </Trans>
        </span>
      </div>

      <ul className="max-h-96 divide-y divide-border overflow-y-auto rounded-md border border-border">
        {rows.map((b) => {
          const { keys, action } = b;
          const removeLabel = t`Remove ${action} from ${keys}`;
          return (
            <li
              key={`${keys} ${action}`}
              className="flex items-center gap-3 px-4 py-1"
            >
              <button
                type="button"
                onClick={() => onSelect(keys)}
                title={keys}
                className="w-44 shrink-0 truncate text-left font-mono text-xs underline-offset-4 hover:underline"
              >
                {keys}
              </button>
              <span
                className="min-w-0 flex-1 truncate font-mono text-xs"
                title={action}
              >
                {action}
              </span>
              {b.source === "user" ? (
                <Badge variant="outline" className="text-[10px]">
                  <Trans>yours</Trans>
                </Badge>
              ) : null}
              {conflicts.has(keys) ? (
                <Badge variant="outline" className="text-[10px]">
                  <Trans>shared key</Trans>
                </Badge>
              ) : null}
              <Button
                size="icon"
                variant="ghost"
                className="size-7 shrink-0 text-muted-foreground hover:text-foreground"
                onClick={() => onRemove(keys, action)}
                aria-label={removeLabel}
                title={removeLabel}
              >
                <X className="size-3.5" />
              </Button>
            </li>
          );
        })}
        {rows.length === 0 ? (
          <li className="px-4 py-4 text-center text-muted-foreground text-sm">
            <Trans>No binding matches that.</Trans>
          </li>
        ) : null}
      </ul>

      <Collapsible>
        <CollapsibleTrigger className="text-muted-foreground text-xs underline-offset-4 hover:underline">
          <Trans>Show the file this would write</Trans>
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
