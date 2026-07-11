import { cn } from "@picoframe/frame";
import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";

/** A labelled form field. Wrapping the control in the <label> associates them. */
export function Field({
  label,
  hint,
  className,
  children,
}: {
  label: string;
  hint?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Label
      className={cn(
        "flex flex-col items-stretch gap-1.5 text-sm font-normal",
        className,
      )}
    >
      <span className="font-medium leading-none">{label}</span>
      {children}
      {hint && (
        <span className="text-xs leading-snug text-muted-foreground">
          {hint}
        </span>
      )}
    </Label>
  );
}
