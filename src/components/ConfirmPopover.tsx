import { Button } from "@picoframe/frame";
import { type ComponentProps, type ReactNode, useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

/**
 * A button that asks before it does something nobody can undo.
 *
 * The first click opens a popover anchored to the button. It names the thing,
 * says what will be lost, and has a Cancel button and a destructive one. The
 * popover opens beside the button rather than over it, so a second click on the
 * same spot cannot confirm. Focus lands on Cancel, the first button inside, so
 * pressing Enter twice from the keyboard does not confirm either.
 *
 * `onConfirm` reports its own failures. The popover closes once it settles.
 */
export function ConfirmPopover({
  children,
  triggerProps,
  heading,
  description,
  confirmLabel,
  busyLabel,
  onConfirm,
}: {
  /** The trigger button's content. */
  children: ReactNode;
  /** The trigger button's own props: `aria-label`, `title`, `variant`, `size`. */
  triggerProps?: Omit<ComponentProps<typeof Button>, "children" | "onClick">;
  /** A question naming the thing, such as "Abandon Two Shores?". */
  heading: string;
  /** What will be lost. */
  description: ReactNode;
  /** The destructive button's label. Differs from the trigger's accessible name. */
  confirmLabel: string;
  /** The destructive button's label while `onConfirm` runs. */
  busyLabel: string;
  onConfirm: () => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const confirm = async () => {
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
      setOpen(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" {...triggerProps}>
          {children}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        side="bottom"
        className="flex w-80 flex-col gap-3"
      >
        <div className="flex flex-col gap-1">
          <h3 className="break-words text-sm font-medium">{heading}</h3>
          <div className="text-xs text-muted-foreground">{description}</div>
        </div>
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => setOpen(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            variant="destructive"
            disabled={busy}
            onClick={() => void confirm()}
          >
            {busy ? busyLabel : confirmLabel}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
