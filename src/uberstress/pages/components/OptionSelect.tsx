import type { ReactNode } from "react";
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
  return (
    <Select value={value} onValueChange={onValueChange} disabled={disabled}>
      <SelectTrigger size={size} className={cn("w-full", className)}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
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
