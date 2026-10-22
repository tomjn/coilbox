/**
 * Pick the module to put in place of the selected one (issue #3303).
 *
 * Opens over the builder as a drawer, like `SwapPartDrawer`. The caller orders
 * the list with the modules of the same category first, and the rows say which
 * those are.
 */

import { Trans, useLingui } from "@lingui/react/macro";
import { Button, Input } from "@picoframe/frame";
import { X } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { useMemo, useState } from "react";

import type { LegoProject } from "../../model";
import { filterModules } from "../../moduleFilter";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Every module that could go in, the current one's category first. */
  modules: LegoProject[];
  /** The category of the module being swapped out, when it has one. */
  category: string | undefined;
  onPick: (module: LegoProject) => void;
}

export function SwapModuleDrawer({
  open,
  onOpenChange,
  modules,
  category,
  onPick,
}: Props) {
  const { t } = useLingui();
  const [query, setQuery] = useState("");
  const shown = useMemo(
    () => filterModules(modules, query, null),
    [modules, query],
  );
  const hasSame =
    !!category &&
    modules.some((m) => m.category?.toLowerCase() === category.toLowerCase());

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/55 backdrop-blur-[1px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="fixed inset-y-0 right-0 z-50 flex w-[420px] max-w-[92vw] flex-col border-l border-border bg-background shadow-xl duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right"
        >
          <div className="flex items-center justify-between border-b border-border/60 px-5 py-4">
            <DialogPrimitive.Title className="text-base font-semibold">
              <Trans>Swap module</Trans>
            </DialogPrimitive.Title>
            <DialogPrimitive.Close asChild>
              <Button variant="ghost" size="icon" aria-label={t`Close`}>
                <X className="size-4" />
              </Button>
            </DialogPrimitive.Close>
          </div>
          <div className="border-b border-border/60 px-5 py-3">
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t`Search modules`}
              aria-label={t`Search modules`}
            />
            {category && !hasSame ? (
              <p className="mt-2 text-xs text-muted-foreground">
                <Trans>No other modules in this category</Trans>
              </p>
            ) : null}
          </div>
          <ul className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
            {shown.length === 0 ? (
              <li className="px-2 py-6 text-center text-sm text-muted-foreground">
                <Trans>No module matches</Trans>
              </li>
            ) : (
              shown.map((module) => (
                <li key={module.id}>
                  <button
                    type="button"
                    onClick={() => onPick(module)}
                    className="flex w-full items-baseline justify-between gap-3 rounded px-2 py-2 text-left text-sm hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="truncate">{module.name}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {module.category ?? ""}
                    </span>
                  </button>
                </li>
              ))
            )}
          </ul>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
