/**
 * The inventory's category menu (#4538): "All categories", then the entries the
 * tab offers, a colourway with its colour chip. The chosen entry's chip shows in
 * the closed menu too, because the chip is part of the entry's text.
 */

import { cn } from "@picoframe/frame";

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import type { ColourwayColours } from "../../colourwayColours";
import { EVERY_CATEGORY, type MenuGroup } from "../../inventoryCategory";
import { ColourwayChip } from "./ColourwayChip";

export function CategoryMenu({
  groups,
  value,
  onValueChange,
  colours,
  disabled,
  className,
}: {
  groups: MenuGroup[];
  value: string;
  onValueChange: (value: string) => void;
  colours: ColourwayColours;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <Select value={value} onValueChange={onValueChange} disabled={disabled}>
      <SelectTrigger
        size="sm"
        className={cn("w-44 shrink-0", className)}
        aria-label="Category"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={EVERY_CATEGORY}>
          <ColourwayChip colours={colours} />
          All categories
        </SelectItem>
        {groups.map((group) => (
          <SelectGroup key={group.label ?? "entries"}>
            {group.label ? <SelectLabel>{group.label}</SelectLabel> : null}
            {group.entries.map((entry) => (
              <SelectItem key={entry.value} value={entry.value}>
                {entry.colourway ? (
                  <ColourwayChip
                    colourway={entry.colourway}
                    colours={colours}
                  />
                ) : null}
                {entry.label}
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  );
}
