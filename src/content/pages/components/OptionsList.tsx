import { ChevronRight } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import type { ConfigOption } from "../../bindings";

/**
 * Renders a map's or game's configuration options (name + description).
 *
 * `defaultOpen` stays true unless a caller asks otherwise, so the map page,
 * the original caller, keeps showing its options straight away. The game page
 * asks for closed: a game's option set can run long enough on its own to push
 * everything below it off the first screen.
 */
export function OptionsList({
  options,
  title,
  defaultOpen = true,
}: {
  options: ConfigOption[];
  title: string;
  defaultOpen?: boolean;
}) {
  if (options.length === 0) return null;
  return (
    <Collapsible defaultOpen={defaultOpen} className="flex flex-col gap-2">
      <CollapsibleTrigger className="group flex w-fit cursor-pointer items-center gap-1 text-left">
        <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-90" />
        <h2 className="text-sm font-medium">
          {title} ({options.length})
        </h2>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ul className="mt-2 flex flex-col gap-2">
          {options.map((o) => (
            <li
              key={o.key}
              className="rounded-lg border border-border/50 bg-card p-3"
            >
              <p className="text-sm font-medium">{o.name}</p>
              <p className="font-mono text-xs text-muted-foreground">{o.key}</p>
              {o.description && (
                <p className="mt-1 text-sm text-muted-foreground">
                  {o.description}
                </p>
              )}
            </li>
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}
