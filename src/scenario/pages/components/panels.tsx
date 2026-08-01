/**
 * The shell the editor's list-plus-form panels sit in.
 *
 * A panel is not a mode. A mode decides what a click on the map does, so it
 * belongs to the scene. A panel edits part of the document the map cannot show,
 * so it sits under the scene on the edit page, one collapsible section each.
 *
 * Triggers is the first of them. Objectives, dialogue, restrictions and vars
 * follow, and use this same shell so the page reads as one stack rather than
 * five inventions.
 */

import { ChevronRight, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

export function EditorPanel({
  title,
  icon: Icon,
  summary,
  defaultOpen = false,
  children,
}: {
  title: string;
  icon: LucideIcon;
  /** What the panel holds, in a few words, so a shut panel still says
   *  something. */
  summary: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <Collapsible
      defaultOpen={defaultOpen}
      className="rounded-lg border border-border/50 bg-card"
    >
      <CollapsibleTrigger className="group flex w-full cursor-pointer items-center gap-2 p-4 text-left">
        <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-90" />
        <Icon className="size-4 shrink-0 text-muted-foreground" />
        <h2 className="text-sm font-medium">{title}</h2>
        <span className="ml-auto truncate text-xs text-muted-foreground">
          {summary}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="border-t border-border/50 p-4">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}
