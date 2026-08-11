import { cn } from "@picoframe/frame";
import {
  KEYBOARD_ROWS,
  type KeyCap,
  type ModifierLayer,
} from "../../keyboardLayout";
import { bindingsFor, conflictKeys, type Keymap } from "../../keymap";
import { actionCommand } from "../../uikeys";

/**
 * The keymap on a keyboard, one modifier layer at a time.
 *
 * A layer rather than a live modifier: holding Ctrl to see the Ctrl bindings
 * would fight the browser for every shortcut, and would hide the layer the
 * moment you let go to click something.
 *
 * Presentational. It reads a keymap and reports which key was clicked, and the
 * page above owns every edit.
 */
export function KeyboardMap({
  keymap,
  layer,
  selected,
  onSelect,
}: {
  keymap: Keymap;
  layer: ModifierLayer;
  /** The keyset currently open in the editor, in full (`Ctrl+q`). */
  selected: string | null;
  onSelect: (keys: string) => void;
}) {
  const conflicts = new Set(conflictKeys(keymap.bindings));

  return (
    <div className="space-y-1 rounded-lg border border-border/50 bg-card p-2">
      {KEYBOARD_ROWS.map((row, i) => (
        // Rows have no id of their own, and their order is the layout.
        // biome-ignore lint/suspicious/noArrayIndexKey: rows are fixed data
        <div key={i} className="flex gap-1">
          {row.map((cap) => (
            <Cap
              key={cap.key}
              cap={cap}
              keys={`${layer}${cap.key}`}
              keymap={keymap}
              conflicts={conflicts}
              selected={selected}
              onSelect={onSelect}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function Cap({
  cap,
  keys,
  keymap,
  conflicts,
  selected,
  onSelect,
}: {
  cap: KeyCap;
  keys: string;
  keymap: Keymap;
  conflicts: Set<string>;
  selected: string | null;
  onSelect: (keys: string) => void;
}) {
  const bindings = bindingsFor(keymap, keys);
  const bound = bindings.length > 0;
  const yours = bindings.some((b) => b.source === "user");
  const first = bindings[0];

  return (
    <button
      type="button"
      onClick={() => onSelect(keys)}
      aria-pressed={keys === selected}
      title={
        bound
          ? `${keys}: ${bindings.map((b) => b.action).join(", ")}`
          : `${keys}: nothing bound`
      }
      // The flex basis is the cap's width in key units, so a row always fills
      // the panel however wide it is and Space stays six keys long.
      style={{ flexGrow: cap.width ?? 1, flexBasis: 0 }}
      className={cn(
        "flex h-11 min-w-0 flex-col items-center justify-center rounded border px-1 py-0.5 text-xs transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        bound
          ? "border-border/60 bg-background hover:bg-accent"
          : "border-border/30 bg-muted/30 text-muted-foreground hover:bg-muted/50",
        yours && "border-primary/60",
        conflicts.has(keys) && "ring-1 ring-amber-500/60",
        keys === selected && "ring-2 ring-primary",
      )}
    >
      <span className="w-full truncate font-medium leading-none">
        {cap.label}
      </span>
      {first ? (
        <span className="w-full truncate text-[10px] leading-tight text-muted-foreground">
          {actionCommand(first.action)}
          {bindings.length > 1 ? ` +${bindings.length - 1}` : ""}
        </span>
      ) : null}
    </button>
  );
}
