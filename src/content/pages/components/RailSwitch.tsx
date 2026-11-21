import { CheckIcon } from "lucide-react";
import type { ComponentProps } from "react";
import { ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

/**
 * A switch in the map card's rail. One that is on has a ticked box before its
 * name, a tinted fill and a border in the primary colour, which show against
 * the card where the plain accent fill of a toggle barely does. The box is
 * there when the switch is off too, so the name does not move when it is
 * switched.
 */
export function RailSwitch({
  className,
  children,
  ...props
}: ComponentProps<typeof ToggleGroupItem>) {
  return (
    <ToggleGroupItem
      {...props}
      className={cn(
        "group/switch @xl:justify-start data-[state=on]:border-primary data-[state=on]:bg-primary/20 data-[state=on]:font-semibold data-[state=on]:text-foreground",
        className,
      )}
    >
      <span
        aria-hidden
        className="flex size-4 shrink-0 items-center justify-center rounded-sm border border-current/40 group-data-[state=on]/switch:border-primary group-data-[state=on]/switch:bg-primary group-data-[state=on]/switch:text-primary-foreground"
      >
        <CheckIcon className="size-3 opacity-0 group-data-[state=on]/switch:opacity-100" />
      </span>
      {children}
    </ToggleGroupItem>
  );
}
