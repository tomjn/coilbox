import { type ReactNode, useRef, useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

/**
 * Thin convenience wrapper over the shadcn `Select` (from the `@picoframe`
 * registry) for the common "pick one of a list of options" case, so pages don't
 * repeat the Trigger/Content/Item composition. Composes the registry primitive
 * rather than re-implementing it.
 */
export function OptionSelect({
  value,
  onValueChange,
  options,
  placeholder,
  disabled,
  className,
  size,
}: {
  value: string;
  onValueChange: (value: string) => void;
  options: {
    value: string;
    label: string;
    description?: string;
    /** Optional leading glyph (e.g. a faction emblem). Rendered inside the item's
     * `ItemText`, so Radix mirrors it into the trigger's selected value too. */
    icon?: ReactNode;
  }[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  size?: "sm" | "default";
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  // Portal the open list into the surrounding dialog or drawer when there is
  // one. Left on the body, a click on the list counts as a click outside the
  // drawer and dismisses it, losing everything the user had filled in.
  const [container, setContainer] = useState<HTMLElement | null>(null);
  return (
    <Select
      value={value}
      onValueChange={onValueChange}
      disabled={disabled}
      onOpenChange={(open) => {
        if (open) {
          setContainer(
            triggerRef.current?.closest<HTMLElement>('[role="dialog"]') ?? null,
          );
        }
      }}
    >
      <SelectTrigger
        ref={triggerRef}
        size={size}
        className={cn("w-full", className)}
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent container={container}>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value} description={o.description}>
            {o.icon ? (
              <span className="flex items-center gap-2">
                {o.icon}
                {o.label}
              </span>
            ) : (
              o.label
            )}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
