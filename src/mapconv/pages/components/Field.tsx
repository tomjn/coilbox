import { cn } from "@picoframe/frame";
import type { ReactNode } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { HelpTip, LearnMore } from "./Help";

/** A labelled form field. Wrapping the control in the <label> associates them.
 * `help` adds a "?" tooltip beside the label; `learnMore` adds a wiki link. */
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
  help?: ReactNode;
  learnMore?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: control is the wrapped {children} (implicit label association)
    <label className={cn("flex flex-col gap-1.5 text-sm", className)}>
      <span className="flex items-center gap-1.5 font-medium leading-none">
        {label}
        {help && <HelpTip>{help}</HelpTip>}
      </span>
      {children}
      {(hint || learnMore) && (
        <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs leading-snug text-muted-foreground">
          {hint && <span>{hint}</span>}
          {learnMore && <LearnMore href={learnMore} />}
        </span>
      )}
    </label>
  );
}

/** A checkbox + label row, for booleans like noclamp / smooth. */
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
