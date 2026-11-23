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
import { Blocks, ChevronDown, ChevronRight } from "lucide-react";
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
  children,
}: {
  /** One line, with the card behind it. */
  compact: boolean;
  /** The unit's name, which the one line shows. */
  name: string;
  /** What the card holds. */
  children: ReactNode;
}) {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);
  if (!compact) {
    return (
      <Collapsible open={open} onOpenChange={setOpen} asChild>
        <div
          data-testid="unit-card"
          className={cn(
            "pointer-events-auto flex max-w-full items-center gap-1 rounded-lg border border-border/60 bg-background/80 px-1 py-1 backdrop-blur",
            open && "min-w-56",
          )}
        >
          <CollapsibleTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 min-w-0 shrink-0 gap-1.5 self-start px-1.5"
              // Closed, the button's name is the unit's name it shows.
              {...(open
                ? { "aria-label": t`Hide unit details` }
                : { title: t`Show unit details` })}
            >
              {open ? (
                <ChevronDown size={14} className="shrink-0" />
              ) : (
                <ChevronRight size={14} className="shrink-0" />
              )}
              <Blocks size={16} className="shrink-0 text-muted-foreground" />
              {open ? null : (
                <span className="min-w-0 truncate font-semibold">{name}</span>
              )}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="min-w-0">
            {children}
          </CollapsibleContent>
        </div>
      </Collapsible>
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
        {children}
      </PopoverContent>
    </Popover>
  );
}
