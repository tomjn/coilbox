import { Button, Input } from "@picoframe/frame";
import { type KeyboardEvent, useState } from "react";
import { type BindingSource, bindingsFor, type Keymap } from "../../keymap";

/** What a source badge says, in the player's terms rather than ours. */
const SOURCE_LABEL: Record<BindingSource, string> = {
  engine: "engine default",
  game: "from the game",
  user: "you changed this",
};

/**
 * `event.key` to the engine's key names. Everything not here goes through
 * lowercasing, which is right for letters, digits and punctuation.
 */
const EVENT_KEY_NAMES: Record<string, string> = {
  Escape: "esc",
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  PageUp: "pageup",
  PageDown: "pagedown",
  " ": "space",
  Backspace: "backspace",
  Enter: "enter",
  Tab: "tab",
  Delete: "delete",
  Insert: "insert",
  Home: "home",
  End: "end",
  CapsLock: "capslock",
  Dead: "~",
};

/** The keyset a key press describes, or null while only modifiers are down. */
function keySetFromEvent(e: KeyboardEvent): string | null {
  if (["Control", "Alt", "Shift", "Meta"].includes(e.key)) return null;
  const key = EVENT_KEY_NAMES[e.key] ?? e.key.toLowerCase();
  return (
    (e.altKey ? "Alt+" : "") +
    (e.ctrlKey ? "Ctrl+" : "") +
    (e.metaKey ? "Meta+" : "") +
    (e.shiftKey ? "Shift+" : "") +
    key
  );
}

/**
 * One keyset: what it does, and the controls to change it.
 *
 * Capture is a field inside this panel rather than a mode the page is in, so a
 * player can read the keyboard while binding and never wonders whether their
 * next keystroke is about to be swallowed.
 */
export function KeyBindingEditor({
  keymap,
  keys,
  onAdd,
  onRemove,
  onReset,
  onRebind,
}: {
  keymap: Keymap;
  keys: string;
  onAdd: (action: string) => void;
  onRemove: (action: string) => void;
  onReset: () => void;
  /** Move every action on this keyset to another one. */
  onRebind: (nextKeys: string) => void;
}) {
  const [action, setAction] = useState("");
  const [capturing, setCapturing] = useState(false);

  const bindings = bindingsFor(keymap, keys);
  const baseline = keymap.baseline.filter((b) => b.keys === keys);
  const changed =
    bindings.length !== baseline.length ||
    bindings.some((b, i) => b.action !== baseline[i]?.action);

  function onCapture(e: KeyboardEvent) {
    e.preventDefault();
    const next = keySetFromEvent(e);
    if (!next) return;
    setCapturing(false);
    if (next !== keys) onRebind(next);
  }

  return (
    <div className="space-y-3 rounded-lg border border-border/50 bg-card p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-mono text-sm">{keys}</h3>
        <div className="flex gap-2">
          {capturing ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setCapturing(false)}
            >
              Cancel
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setCapturing(true)}
            >
              Press a key
            </Button>
          )}
          {changed ? (
            <Button size="sm" variant="ghost" onClick={onReset}>
              Reset
            </Button>
          ) : null}
        </div>
      </div>

      {capturing ? (
        <Input
          readOnly
          autoFocus
          value=""
          onKeyDown={onCapture}
          placeholder="Press the keys you want. Escape binds Escape, so use Cancel to back out."
          className="text-xs"
        />
      ) : null}

      {bindings.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nothing is bound to this key.
        </p>
      ) : (
        <ul className="space-y-1">
          {bindings.map((b) => (
            <li
              key={`${b.keys} ${b.action}`}
              className="flex items-center justify-between gap-2 rounded border border-border/40 px-2 py-1"
            >
              <span className="min-w-0 truncate font-mono text-xs">
                {b.action}
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <span className="text-[11px] text-muted-foreground">
                  {SOURCE_LABEL[b.source]}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => onRemove(b.action)}
                >
                  Remove
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}

      {bindings.length > 1 ? (
        <p className="text-xs text-muted-foreground">
          The engine tries these in order and runs the first one that applies,
          which is how one key can mean two things.
        </p>
      ) : null}

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!action.trim()) return;
          onAdd(action.trim());
          setAction("");
        }}
      >
        <Input
          value={action}
          onChange={(e) => setAction(e.target.value)}
          placeholder="Another action for this key, e.g. areaattack"
          className="font-mono text-xs"
        />
        <Button type="submit" size="sm" disabled={!action.trim()}>
          Add
        </Button>
      </form>
    </div>
  );
}
