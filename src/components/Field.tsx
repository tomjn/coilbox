import { cn } from "@picoframe/frame";
import type { ReactNode } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

/**
 * A labelled form field. Wrapping the control in the <label> associates them.
 * `help` and `learnMore` take pre-built elements (e.g. a tooltip trigger or a
 * link), not raw text, so Field stays agnostic to what "help" looks like in a
 * given plugin rather than depending on one plugin's tooltip/link components.
 */
export function Field({
  label,
  hint,
  help,
  learnMore,
  className,
  children,
}: {
  label: string;
  hint?: string;
  /** Optional element shown beside the label, e.g. a "?" tooltip trigger. */
  help?: ReactNode;
  /** Optional element shown in the hint row, e.g. a "Learn more" link. */
  learnMore?: ReactNode;
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
      <span className="flex items-center gap-1.5 font-medium leading-none">
        {label}
        {help}
      </span>
      {children}
      {(hint || learnMore) && (
        <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs leading-snug text-muted-foreground">
          {hint && <span>{hint}</span>}
          {learnMore}
        </span>
      )}
    </Label>
  );
}

/** A checkbox + label row, for booleans like tls / allowSelfSigned. */
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
