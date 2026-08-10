import { Button } from "@picoframe/frame";
import { AlertTriangle, ExternalLink } from "lucide-react";
import type { ComponentType } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * The "here is what this is, do you want it" confirmation (issue #388), shared
 * by the deep-link handler and the import box (issue #1333).
 *
 * It started inside `DeepLinkHandler` and moved out when the import box needed
 * the same thing. Somebody who pastes a link into the box and somebody whose OS
 * hands the same link to coilbox are agreeing to the same act, so they should be
 * reading the same words in the same layout.
 */

/** A confirmed action, held while the dialog is open. */
export interface Pending {
  title: string;
  /** One line per fact the user is agreeing to. */
  lines: string[];
  warnings: string[];
  confirmLabel: string;
  run: () => void;
  /** The glyph beside the title. Defaults to the link icon, which is what an
   * import is. The hub's Remove passes its own, because a dialog about deleting
   * something should not be marked with the sign for fetching it. */
  icon?: ComponentType<{ className?: string }>;
}

export function ConfirmDialog({
  pending,
  setPending,
}: {
  pending: Pending | null;
  setPending: (pending: Pending | null) => void;
}) {
  const confirm = () => {
    const p = pending;
    setPending(null);
    p?.run();
  };
  const Icon = pending?.icon ?? ExternalLink;

  return (
    <Dialog
      open={pending !== null}
      onOpenChange={(open) => !open && setPending(null)}
    >
      {pending && (
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Icon className="size-4 text-muted-foreground" />
              {pending.title}
            </DialogTitle>
            <DialogDescription className="sr-only">
              Confirm this before it runs.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-2 text-sm">
            {pending.lines.map((line) => (
              <p key={line}>{line}</p>
            ))}
            {pending.warnings.map((w) => (
              <p
                key={w}
                className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-xs text-muted-foreground"
              >
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
                {w}
              </p>
            ))}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setPending(null)}>
              Cancel
            </Button>
            <Button onClick={confirm}>{pending.confirmLabel}</Button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  );
}
