/**
 * The editor's page-level shortcuts, listed (issue #2277). Opened from the
 * header's overflow menu, the same way Share and Delete are: a drawer rather
 * than a dialog, matching every other surface this editor opens on demand.
 */

import { editorShortcuts } from "./shortcuts";

export function ShortcutsList() {
  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-1.5">
        {editorShortcuts().map((shortcut) => (
          <li
            key={shortcut.description}
            className="flex items-center justify-between gap-4 text-sm"
          >
            <span>{shortcut.description}</span>
            <kbd className="shrink-0 rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-xs">
              {shortcut.keys}
            </kbd>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">
        The map has its own keys for stepping through what is placed, moving it,
        turning it and deleting it. Focus the map and press{" "}
        <kbd className="rounded border border-border bg-muted px-1 py-0.5 font-mono text-xs">
          ?
        </kbd>{" "}
        to hear them.
      </p>
    </div>
  );
}
