/**
 * The offer to update module instances whose module has changed (issue #3304).
 *
 * One row for each instance, naming it and the module. Nothing updates until
 * the user presses Update on a row. Dismiss hides the banner until a module
 * changes again.
 */

import { Button } from "@picoframe/frame";

import type { ModuleUpdate } from "../../moduleUpdates";

interface Props {
  updates: ModuleUpdate[];
  onUpdate: (update: ModuleUpdate) => void;
  onDismiss: () => void;
}

export function ModuleUpdateBanner({ updates, onUpdate, onDismiss }: Props) {
  if (updates.length === 0) return null;
  return (
    <div
      role="status"
      className="pointer-events-auto mx-auto w-fit max-w-[80%] rounded-md border border-amber-500/40 bg-background/90 px-3 py-1.5 text-xs backdrop-blur"
    >
      <div className="flex items-center justify-between gap-3">
        <span>
          {updates.length === 1
            ? "1 part of this unit uses an older module."
            : `${updates.length} parts of this unit use an older module.`}
        </span>
        <Button size="sm" variant="ghost" onClick={onDismiss}>
          Dismiss
        </Button>
      </div>
      <ul className="mt-1 space-y-1">
        {updates.map((update) => (
          <li
            key={update.instance}
            className="flex items-center justify-between gap-3"
          >
            <span className="text-muted-foreground">
              {update.name} uses an older {update.moduleName}.
              {update.edited > 0
                ? ` Update resets ${update.edited} edited ${update.edited === 1 ? "piece" : "pieces"}.`
                : ""}
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => onUpdate(update)}
            >
              Update
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
