import { cn } from "@picoframe/frame";
import { ChevronRight } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import type { ConfigOption } from "../../bindings";

/** A map's or game's configuration options (name + description), in a section
 * that opens and closes. */
export function OptionsList({
  options,
  title,
}: {
  options: ConfigOption[];
  title: string;
}) {
  if (options.length === 0) return null;
  return (
    <Collapsible defaultOpen className="flex flex-col gap-2">
      <CollapsibleTrigger className="group flex w-fit cursor-pointer items-center gap-1 text-left">
        <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-90" />
        <h2 className="text-sm font-medium">
          {title} ({options.length})
        </h2>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <OptionCards options={options} className="mt-2" />
      </CollapsibleContent>
    </Collapsible>
  );
}

/** One card per option, for a caller that gives them a place of their own. */
export function OptionCards({
  options,
  className,
}: {
  options: ConfigOption[];
  className?: string;
}) {
  return (
    <ul className={cn("flex flex-col gap-2", className)}>
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
  );
}
