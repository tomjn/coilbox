import { cn } from "@picoframe/frame";
import type { ReactNode } from "react";
import { Checkbox } from "@/components/ui/checkbox";

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

/** A checkbox + label row, for booleans like register / db-reset. */
export function CheckField({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: wraps the <Checkbox> control (implicit label association)
    <label className="flex items-start gap-2.5 text-sm">
      <Checkbox
        checked={checked}
        onCheckedChange={(v) => onChange(v === true)}
        className="mt-0.5"
      />
      <span className="flex flex-col gap-0.5">
        <span className="font-medium leading-none">{label}</span>
        {hint && (
          <span className="text-xs leading-snug text-muted-foreground">
            {hint}
          </span>
        )}
      </span>
    </label>
  );
}
