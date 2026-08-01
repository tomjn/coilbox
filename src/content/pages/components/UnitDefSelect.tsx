/**
 * Pick one of a game's units.
 *
 * The picker the lego builder stands its reference figure with, lifted out so
 * the scenario editor places actors with the same one. It takes the dataset
 * rather than reading it, because the screens that use it already know which
 * game they are asking about and often need the picked unit's other fields.
 *
 * A select rather than a list: Radix's own typeahead jumps to a unit as its name
 * is typed, so a game with hundreds of units is still reachable from the
 * keyboard without a search box of our own.
 */

import { useMemo } from "react";

import { OptionSelect } from "@/uberstress/pages/components/OptionSelect";
import type { UnitDatasetEntry } from "../../bindings";
import { unitChoices } from "../../unitChoices";

export function UnitDefSelect({
  units,
  value,
  onValueChange,
  loading,
  placeholder = "Pick a unit",
  disabled,
  className,
  size,
}: {
  /** The game's units, as `useUnitsyncUnitDataset` reports them. */
  units: UnitDatasetEntry[];
  /** The internal def name currently picked, or "" for none. */
  value: string;
  onValueChange: (unitDef: string) => void;
  /** The dataset is still being read, so an empty list is not an answer yet. */
  loading?: boolean;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  size?: "sm" | "default";
}) {
  const options = useMemo(() => unitChoices(units), [units]);

  return (
    <OptionSelect
      value={value}
      onValueChange={onValueChange}
      options={options}
      placeholder={loading ? "Reading units" : placeholder}
      disabled={disabled ?? options.length === 0}
      className={className}
      size={size}
    />
  );
}
