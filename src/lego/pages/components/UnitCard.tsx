/**
 * The card over the view with the unit's name, what it exports as, its
 * texture, its game and its loadouts.
 *
 * In four views it is one line, the unit's name, and the rest of the card
 * opens from it (#5410). The views share what the chrome leaves, so a full
 * card would take a band of the screen most of the time it is not being used.
 */

import { useLingui } from "@lingui/react/macro";
import { Button } from "@picoframe/frame";
import { Blocks, ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
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
  if (!compact) {
    return (
      <div
        data-testid="unit-card"
        className="pointer-events-auto flex max-w-full min-w-56 items-center gap-2 rounded-lg border border-border/60 bg-background/80 px-2 py-1.5 backdrop-blur"
      >
        <Blocks size={16} className="shrink-0 text-muted-foreground" />
        {children}
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
        {children}
      </PopoverContent>
    </Popover>
  );
}
