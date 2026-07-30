/**
 * A reference for the keyboard shortcuts scattered across the builder as
 * three tooltips and nothing else. The list is generated from `SHORTCUTS`
 * rather than typed out here by hand, so a new shortcut cannot land in a
 * handler without this sheet knowing about it.
 */

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  comboLabel,
  isMac,
  SHORTCUTS,
  type ShortcutGroup,
} from "../../shortcuts";

const GROUP_ORDER: ShortcutGroup[] = ["Transform", "View", "Edit", "Help"];

export function ShortcutSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const mac = isMac();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          {GROUP_ORDER.map((group) => (
            <div key={group}>
              <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {group}
              </h3>
              <ul className="mt-1 flex flex-col gap-1">
                {SHORTCUTS.filter((shortcut) => shortcut.group === group).map(
                  (shortcut) => (
                    <li
                      key={shortcut.id}
                      className="flex items-center justify-between gap-4 text-sm"
                    >
                      <span>{shortcut.description}</span>
                      <span className="flex shrink-0 gap-1">
                        {shortcut.combos.map((combo) => (
                          <kbd
                            key={`${combo.key}-${combo.mod}-${combo.shift}`}
                            className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-xs"
                          >
                            {comboLabel(combo, mac)}
                          </kbd>
                        ))}
                      </span>
                    </li>
                  ),
                )}
              </ul>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
