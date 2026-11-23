/**
 * The card over the view with the unit's name, what it exports as, its
 * texture, its game and its loadouts.
 *
 * In four views it is one line, the unit's name, and the rest of the card
 * opens from it (#5410). The views share what the chrome leaves, so a full
 * card would take a band of the screen most of the time it is not being used.
 *
 * Over one view it starts closed too, as the name behind a chevron, and opens
 * in place rather than in a popover.
 */

import { useLingui } from "@lingui/react/macro";
import { Button, cn } from "@picoframe/frame";
import { Blocks, ChevronDown, ChevronUp } from "lucide-react";
import { type ReactNode, useState } from "react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

export function UnitCard({
  compact,
  name,
  nameField,
  children,
}: {
  /** One line, with the card behind it. */
  compact: boolean;
  /** The unit's name, which the closed card shows. */
  name: string;
  /** Where the name is edited, which takes the name's place in the open
   *  card, so the name does not move as the card opens. */
  nameField: ReactNode;
  /** The rest of what the card holds, under the name. */
  children: ReactNode;
}) {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);
  if (!compact) {
    // The icon, the name and the chevron on the right are one row, open or
    // closed. Open, the name becomes its field in the same place, and the
    // rest of the card is underneath, lined up with the name.
    //
    // The slot it sits in stays the closed card's height, its border, its
    // padding and the h-7 row: 1 + 4 + 28 + 4 + 1 pixels. Open, the card hangs
    // out of it over the view, so the chrome's row does not grow and the tool
    // rail centred in the room under it stays where it is.
    return (
      <div className="h-[38px] max-w-full shrink-0">
        <Collapsible open={open} onOpenChange={setOpen} asChild>
          <div
            data-testid="unit-card"
            className={cn(
              "pointer-events-auto relative z-20 flex max-w-full flex-col rounded-lg border border-border/60 bg-background/80 p-1 backdrop-blur",
              open && "min-w-56",
            )}
          >
            {open ? (
              <div className="flex h-7 min-w-0 items-center gap-2 pl-2">
                <Blocks size={16} className="shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">{nameField}</div>
                <CollapsibleTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-7 shrink-0"
                    aria-label={t`Hide unit details`}
                  >
                    <ChevronUp size={14} />
                  </Button>
                </CollapsibleTrigger>
              </div>
            ) : (
              <CollapsibleTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 min-w-0 justify-start gap-2 pr-1.5 pl-2"
                  title={t`Show unit details`}
                >
                  <Blocks
                    size={16}
                    className="shrink-0 text-muted-foreground"
                  />
                  {/* The field's size and weight, inset as its text is by its
                    border and padding, so the name does not change as the
                    card opens. */}
                  <span className="min-w-0 truncate px-[5px] text-sm font-semibold">
                    {name}
                  </span>
                  <ChevronDown
                    size={14}
                    className="ml-auto shrink-0 text-muted-foreground"
                  />
                </Button>
              </CollapsibleTrigger>
            )}
            <CollapsibleContent className="min-w-0 pb-1 pl-8">
              {children}
            </CollapsibleContent>
          </div>
        </Collapsible>
      </div>
    );
  }
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          data-testid="unit-card"
          title={t`Unit details`}
          className="pointer-events-auto max-w-full min-w-0 gap-2 bg-background/80 px-2 backdrop-blur"
        >
          <Blocks size={16} className="shrink-0 text-muted-foreground" />
          <span className="min-w-0 truncate font-semibold">{name}</span>
          <ChevronDown size={14} className="shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-2">
        {nameField}
        {children}
      </PopoverContent>
    </Popover>
  );
}
