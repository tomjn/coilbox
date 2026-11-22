import { Button } from "@picoframe/frame";
import { CircleHelp } from "lucide-react";
import type { ReactNode } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

/**
 * A help icon beside a heading or a field, opening a popover that holds the
 * explanation of what the control does (#5376). Explanation lives here rather
 * than under the control. What changes what the player should do right now (a
 * warning, an empty or error state, a count) stays inline.
 *
 * `label` names the button and the popover, and says what it explains, such
 * as "About mirroring".
 */
export function HelpPopover({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-6 shrink-0 text-muted-foreground"
          aria-label={label}
          title={label}
        >
          <CircleHelp className="size-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        aria-label={label}
        className="flex max-h-[70vh] w-80 max-w-[calc(100vw-2rem)] flex-col gap-2 overflow-y-auto p-3 text-xs"
      >
        {children}
      </PopoverContent>
    </Popover>
  );
}
