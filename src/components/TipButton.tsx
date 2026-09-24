import { Button, cn } from "@picoframe/frame";
import type { ComponentProps } from "react";

/**
 * A `Button` for inside a `TooltipTrigger`, whose tooltip still shows while it
 * is disabled.
 *
 * A real `disabled` button takes no pointer events and no focus, so its tooltip
 * never opens, and a disabled icon button with no tooltip is a button nobody
 * can name. This marks it `aria-disabled` instead and drops the click, which
 * keeps hover and focus and still reads as unavailable to a screen reader.
 */
export function TipButton({
  disabled,
  onClick,
  className,
  ...props
}: ComponentProps<typeof Button>) {
  return (
    <Button
      {...props}
      aria-disabled={disabled || undefined}
      onClick={disabled ? undefined : onClick}
      className={cn(
        "aria-disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:hover:bg-transparent",
        className,
      )}
    />
  );
}
