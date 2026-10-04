import { Button } from "@picoframe/frame";
import { AlertTriangle, X } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import type { ImportHold } from "./importHold";

/**
 * The drawer an import opens when `finish` stopped with an {@link ImportHold}
 * (issue #3488): what coilbox found, then Cancel, Try again when a second read
 * might work, and a button that creates the document anyway. `error` is a
 * failure of the attempt the player just chose, and keeps the drawer open.
 */
export function ImportHoldDrawer({
  hold,
  busy,
  error,
  onRetry,
  onAccept,
  onCancel,
}: {
  hold: ImportHold;
  busy: boolean;
  error: string | null;
  onRetry: () => void;
  onAccept: () => void;
  onCancel: () => void;
}) {
  return (
    <DialogPrimitive.Root open onOpenChange={(o) => !o && onCancel()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/55 backdrop-blur-[1px]" />
        <DialogPrimitive.Content className="fixed inset-y-0 right-0 z-50 flex w-[420px] max-w-[92vw] flex-col border-l border-border bg-background shadow-xl">
          <div className="flex items-center justify-between border-b border-border/60 px-5 py-4">
            <DialogPrimitive.Title className="text-base font-semibold">
              {hold.canRetry ? "Could not read unit data" : "No unit limit"}
            </DialogPrimitive.Title>
            <DialogPrimitive.Close asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Close"
                onClick={onCancel}
              >
                <X className="size-4" />
              </Button>
            </DialogPrimitive.Close>
          </div>
          <DialogPrimitive.Description className="sr-only">
            Nothing has been imported yet.
          </DialogPrimitive.Description>

          <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-5 py-4">
            <div className="flex items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <div className="flex min-w-0 flex-col gap-1.5">
                <p className="text-xs text-muted-foreground">{hold.message}</p>
                {hold.note && (
                  <p className="text-xs text-muted-foreground">{hold.note}</p>
                )}
                {hold.detail && (
                  <p className="break-words font-mono text-xs text-muted-foreground">
                    {hold.detail}
                  </p>
                )}
              </div>
            </div>
            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>

          <div className="flex justify-end gap-2 border-t border-border/60 px-5 py-4">
            <Button variant="outline" onClick={onCancel} disabled={busy}>
              Cancel
            </Button>
            {hold.canRetry && (
              <Button variant="outline" onClick={onRetry} disabled={busy}>
                Try again
              </Button>
            )}
            <Button onClick={onAccept} disabled={busy}>
              {hold.acceptLabel}
            </Button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
