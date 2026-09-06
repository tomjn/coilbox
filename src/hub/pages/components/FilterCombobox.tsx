import { Button } from "@picoframe/frame";
import { Check, ChevronsUpDown } from "lucide-react";
import { useState } from "react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/**
 * A filter with a suggestion list, for the hub filters (issue #1357) that have
 * no server-side facet to draw a dropdown from: game and map. The hub offers no
 * list of the values it carries, so the suggestions are built from what coilbox
 * knows is installed locally instead - which is also more useful to a player
 * than every value the gallery has ever seen.
 *
 * This is shadcn's combobox: a button that opens a popover holding a `Command`
 * (see `ui.shadcn.com/docs/components/radix/combobox`). It replaced a
 * hand-rolled text box with a popover anchored to it, which fought Radix over
 * focus - opening the list and closing it again in the same gesture - and had
 * no keyboard handling of its own. Filtering, keyboard navigation and dismissal
 * are all cmdk's and Radix's here, none of them ours.
 *
 * A locally installed name will not always match what the hub stores, so
 * whatever is typed can still be sent: the last row offers it verbatim. The
 * list is a shortcut into the box, never the only way in.
 *
 * `options` carries a `value` (what gets sent to the hub) alongside a
 * `label` (what the reader sees), rather than one string doing both: the
 * game filter's value is the hub's version-independent `game_key`, and
 * showing that in the box would read as "SF" rather than "SplinterFaction"
 * (issue #2587). The map filter has no such split and just uses the same
 * string for both.
 */
export interface ComboOption {
  value: string;
  label: string;
}

export function FilterCombobox({
  value,
  onCommit,
  options,
  placeholder,
  ariaLabel,
  className,
}: {
  value: string;
  onCommit: (value: string) => void;
  options: ComboOption[];
  placeholder: string;
  ariaLabel: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  function commit(next: string) {
    setOpen(false);
    setSearch("");
    if (next.trim() !== value.trim()) onCommit(next);
  }

  // The trigger shows the chosen option's label, falling back to the raw
  // value for one typed by hand rather than picked from the list.
  const selectedLabel = options.find((o) => o.value === value)?.label ?? value;

  const typed = search.trim();
  // Only worth offering when it is not already one of the rows below it.
  const offerTyped =
    typed !== "" &&
    !options.some((o) => o.label.toLowerCase() === typed.toLowerCase());

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          // The trigger carries the filter's name, because the button's own
          // text is the chosen value once there is one.
          aria-label={ariaLabel}
          aria-expanded={open}
          className={cn("justify-between font-normal", className)}
        >
          <span className={cn("truncate", !value && "text-muted-foreground")}>
            {selectedLabel || placeholder}
          </span>
          <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-0">
        <Command>
          <CommandInput
            placeholder={`Search ${placeholder.toLowerCase()}s…`}
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            <CommandEmpty>Nothing installed matches that.</CommandEmpty>
            {value && (
              <CommandGroup>
                {/* Its own words are its `value`, so cmdk filters it the way it
                    filters everything else. An empty value would be a row the
                    filter cannot match at all. */}
                <CommandItem
                  value={`Any ${placeholder}`}
                  onSelect={() => commit("")}
                >
                  Any {placeholder.toLowerCase()}
                </CommandItem>
              </CommandGroup>
            )}
            {offerTyped && (
              <CommandGroup>
                {/* The typed value is its own `value`, so cmdk's filter always
                    keeps this row: it is the one thing the list must never
                    hide. */}
                <CommandItem value={typed} onSelect={() => commit(typed)}>
                  Filter by “{typed}”
                </CommandItem>
              </CommandGroup>
            )}
            <CommandGroup heading="Installed">
              {options.map((option) => (
                <CommandItem
                  key={option.value}
                  value={option.label}
                  onSelect={() => commit(option.value)}
                >
                  <Check
                    className={cn(
                      "mr-2 size-4",
                      option.value === value ? "opacity-100" : "opacity-0",
                    )}
                  />
                  {option.label}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
