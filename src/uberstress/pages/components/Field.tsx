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
    <label className={cn("flex flex-col gap-1.5 text-sm", className)}>
      <span className="font-medium leading-none">{label}</span>
      {children}
      {hint && <span className="text-xs leading-snug text-muted-foreground">{hint}</span>}
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
    <label className="flex items-start gap-2.5 text-sm">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 size-4 shrink-0 accent-current"
      />
      <span className="flex flex-col gap-0.5">
        <span className="font-medium leading-none">{label}</span>
        {hint && <span className="text-xs leading-snug text-muted-foreground">{hint}</span>}
      </span>
    </label>
  );
}
