import { Fragment, type ReactNode } from "react";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

/** One option, as `OptionSelect` renders it. */
type Option = {
  value: string;
  label: string;
  description?: string;
  /** Optional leading glyph (e.g. a faction emblem). Rendered inside the item's
   * `ItemText`, so Radix mirrors it into the trigger's selected value too. */
  icon?: ReactNode;
  /** Optional badge pinned to the item's right edge (e.g. an AI's difficulty),
   * dropdown only. */
  trailing?: ReactNode;
  /** Offered but not pickable, for an option the document cannot use yet.
   * Shown greyed rather than left out, so the list says what exists. */
  disabled?: boolean;
  /**
   * The band this option sits under in the dropdown (e.g. "Units"), shown as a
   * `SelectLabel` a screen reader announces before the option's own name.
   * Options are grouped in first-appearance order of this value, so callers
   * that leave every option's `group` unset get today's flat list with no
   * `SelectGroup` wrapper at all: this is additive, not a new required field
   * (issue #2273).
   */
  group?: string;
};

function renderOption(o: Option) {
  return (
    <SelectItem
      key={o.value}
      value={o.value}
      description={o.description}
      trailing={o.trailing}
      disabled={o.disabled}
    >
      {o.icon ? (
        <span className="flex items-center gap-2">
          {o.icon}
          {o.label}
        </span>
      ) : (
        o.label
      )}
    </SelectItem>
  );
}

/** `options`, split into runs by `group` in first-appearance order. An option
 *  with no group sits in its own ungrouped run, rendered with no `SelectLabel`
 *  wrapper, so a caller that groups only some of its options still gets a
 *  sensible list rather than an unlabelled group. */
function groupRuns(
  options: Option[],
): { group: string | undefined; items: Option[] }[] {
  const runs: { group: string | undefined; items: Option[] }[] = [];
  for (const option of options) {
    const last = runs[runs.length - 1];
    if (last && last.group === option.group) {
      last.items.push(option);
    } else {
      runs.push({ group: option.group, items: [option] });
    }
  }
  return runs;
}

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
  ariaLabel,
  ariaInvalid,
  describedBy,
}: {
  value: string;
  onValueChange: (value: string) => void;
  options: Option[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  size?: "sm" | "default";
  ariaLabel?: string;
  /** Marks the trigger invalid, for a field a validator has flagged (issue
   *  #2287). */
  ariaInvalid?: boolean;
  /** The id of a message paragraph explaining why, `FieldProblem`'s. */
  describedBy?: string;
}) {
  const grouped = options.some((o) => o.group !== undefined);

  return (
    <Select value={value} onValueChange={onValueChange} disabled={disabled}>
      <SelectTrigger
        size={size}
        className={cn("w-full", className)}
        aria-label={ariaLabel}
        aria-invalid={ariaInvalid}
        aria-describedby={describedBy}
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {grouped
          ? groupRuns(options).map((run, index) =>
              run.group === undefined ? (
                // biome-ignore lint/suspicious/noArrayIndexKey: an ungrouped run has no name of its own, and its place among the other runs is what makes it distinct
                <Fragment key={`ungrouped-${index}`}>
                  {run.items.map(renderOption)}
                </Fragment>
              ) : (
                <SelectGroup key={run.group}>
                  <SelectLabel>{run.group}</SelectLabel>
                  {run.items.map(renderOption)}
                </SelectGroup>
              ),
            )
          : options.map(renderOption)}
      </SelectContent>
    </Select>
  );
}
