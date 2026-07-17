import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

/**
 * Thin wrapper over the shadcn `Select` (from the `@picoframe` registry) for the
 * "pick one of a list" case. A local copy of uberstress's OptionSelect so the
 * run pages don't import across plugin folders.
 */
export function OptionSelect({
  value,
  onValueChange,
  options,
  placeholder,
  disabled,
  className,
}: {
  value: string;
  onValueChange: (value: string) => void;
  options: { value: string; label: string; description?: string }[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <Select value={value} onValueChange={onValueChange} disabled={disabled}>
      <SelectTrigger className={cn("w-full", className)}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value} description={o.description}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
