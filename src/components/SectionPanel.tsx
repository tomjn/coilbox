/**
 * A collapsible card: a chevron, an icon, a title, and a line on the right that
 * says what is inside without opening it.
 *
 * The scenario editor drew this first, one per panel down its edit page, and the
 * unit page's field sections were a thinner version of the same idea: the same
 * `Collapsible`, but a two line high row that read as a table row rather than as
 * a part of the page (issue #2693). Rather than have the second one copy the
 * first's class names and drift from them again, the shell is here and both call
 * it.
 *
 * It stays a shell. It owns no open state, no content padding and no heading
 * level, because the two callers disagree on all three: the editor drives a
 * panel open from a ref, the unit page's sections open by default and hold rows
 * that are deliberately dense, and the unit page already spends its one `h2` on
 * the unit's name.
 */
import { cn } from "@picoframe/frame";
import { ChevronRight, type LucideIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

export function SectionPanel({
  title,
  icon: Icon,
  summary,
  headingLevel = 2,
  className,
  contentClassName = "p-4",
  children,
  ...collapsible
}: {
  title: string;
  icon: LucideIcon;
  /** What the panel holds, in a few words, so a shut panel still says
   *  something. */
  summary?: ReactNode;
  /** Where the title sits in the page's heading order. */
  headingLevel?: 2 | 3 | 4;
  contentClassName?: string;
  children: ReactNode;
} & Omit<ComponentProps<typeof Collapsible>, "title" | "children">) {
  const Title = `h${headingLevel}` as const;

  return (
    <Collapsible
      className={cn("rounded-lg border border-border/50 bg-card", className)}
      {...collapsible}
    >
      <CollapsibleTrigger className="group flex w-full cursor-pointer items-center gap-2 p-4 text-left">
        <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-90" />
        <Icon className="size-4 shrink-0 text-muted-foreground" />
        <Title className="text-sm font-medium">{title}</Title>
        <span className="ml-auto flex min-w-0 items-center gap-2 truncate text-xs text-muted-foreground">
          {summary}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className={cn("border-t border-border/50", contentClassName)}>
          {children}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
