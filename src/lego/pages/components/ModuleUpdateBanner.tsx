/**
 * The offer to update module instances whose module has changed (issue #3304).
 *
 * One row for each instance, naming it and the module. Nothing updates until
 * the user presses Update on a row. Dismiss hides the banner until a module
 * changes again.
 */

import { Plural, Trans } from "@lingui/react/macro";
import { Button } from "@picoframe/frame";

import type { ModuleUpdate, UntrackedModule } from "../../moduleUpdates";

interface Props {
  updates: ModuleUpdate[];
  /** Instances added before stamps were recorded (#4323). */
  untracked?: UntrackedModule[];
  onUpdate: (update: ModuleUpdate | UntrackedModule) => void;
  onMark?: (untracked: UntrackedModule) => void;
  onDismiss: () => void;
}

export function ModuleUpdateBanner({
  updates,
  untracked = [],
  onUpdate,
  onMark,
  onDismiss,
}: Props) {
  if (updates.length === 0 && untracked.length === 0) return null;
  const count = updates.length;
  return (
    <div
      role="status"
      className="pointer-events-auto mx-auto w-fit max-w-[80%] rounded-md border border-amber-500/40 bg-background/90 px-3 py-1.5 text-xs backdrop-blur"
    >
      <div className="flex items-center justify-between gap-3">
        <span>
          {count === 0 ? (
            <Trans>Some parts of this unit are not tracked.</Trans>
          ) : (
            <Plural
              value={count}
              one="# part of this unit uses an older module."
              other="# parts of this unit use an older module."
            />
          )}
        </span>
        <Button size="sm" variant="ghost" onClick={onDismiss}>
          <Trans>Dismiss</Trans>
        </Button>
      </div>
      <ul className="mt-1 space-y-1">
        {updates.map((update) => {
          const updateName = update.name;
          const updateModule = update.moduleName;
          const edited = update.edited;
          return (
            <li
              key={update.instance}
              className="flex items-center justify-between gap-3"
            >
              <span className="text-muted-foreground">
                <Trans>
                  {updateName} uses an older {updateModule}.
                </Trans>
                {update.edited > 0 ? (
                  <>
                    {" "}
                    <Plural
                      value={edited}
                      one="Update resets # edited piece."
                      other="Update resets # edited pieces."
                    />
                  </>
                ) : null}
              </span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => onUpdate(update)}
              >
                <Trans>Update</Trans>
              </Button>
            </li>
          );
        })}
        {untracked.map((item) => {
          const itemName = item.name;
          const itemModule = item.moduleName;
          return (
            <li
              key={item.instance}
              className="flex items-center justify-between gap-3"
            >
              <span className="text-muted-foreground">
                <Trans>
                  {itemName} ({itemModule}). Added before changes were tracked.
                </Trans>
              </span>
              <span className="flex gap-1">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onMark?.(item)}
                >
                  <Trans>Mark as current</Trans>
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onUpdate(item)}
                >
                  <Trans>Update now</Trans>
                </Button>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
