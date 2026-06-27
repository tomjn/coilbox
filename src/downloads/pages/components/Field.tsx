import { cn } from "@picoframe/frame";
import type { ReactNode } from "react";

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
    // biome-ignore lint/a11y/noLabelWithoutControl: control is the wrapped {children} (implicit label association)
    <label className={cn("flex flex-col gap-1.5 text-sm", className)}>
      <span className="font-medium leading-none">{label}</span>
      {children}
      {hint && (
        <span className="text-xs leading-snug text-muted-foreground">
          {hint}
        </span>
      )}
    </label>
  );
}
