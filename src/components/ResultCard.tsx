import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

/**
 * The card a check answers in: a verdict that reads at a glance, whatever the
 * host should do about it, and the machine's own reply folded away underneath.
 *
 * Written for the reachability check in the hosting forms and then wanted by
 * the Windows Firewall panel next to it, which had been putting its answer
 * straight into the drawer as loose text. Two checks side by side in the same
 * form, one of them a card and one of them not, read as two different kinds of
 * thing when they are the same kind of thing: something coilbox asked the
 * machine, and what came back.
 *
 * Nothing here knows what is being checked. The words, the icon and the tone
 * are the caller's.
 */
export function ResultCard({
  tone,
  role,
  children,
}: {
  /** `alarm` is red, and only for something actually wrong. A machine that
   *  will not answer and a person who said no are both outcomes, not faults. */
  tone: "quiet" | "alarm";
  role?: "status" | "alert";
  children: ReactNode;
}) {
  return (
    <div
      role={role}
      className={cn(
        "flex flex-col gap-1.5 rounded-md border p-2.5 text-xs",
        tone === "alarm"
          ? "border-destructive/50 bg-destructive/10 text-destructive"
          : "border-border bg-muted/40 text-muted-foreground",
      )}
    >
      {children}
    </div>
  );
}

/** The one line to read first. Everything under it lines up with its words,
 *  not its icon. */
export function Verdict({
  icon,
  strong = true,
  children,
}: {
  icon: ReactNode;
  /** Drawn in the foreground colour, which a red card overrides. */
  strong?: boolean;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "flex items-center gap-1.5 text-sm font-medium",
        strong && "text-foreground",
      )}
    >
      <span aria-hidden className="contents">
        {icon}
      </span>
      <span>{children}</span>
    </span>
  );
}

/** What only a bug report needs, one press from view. Nothing at all when there
 *  is nothing to show. */
export function Details({ lines }: { lines: string[] }) {
  if (lines.length === 0) return null;
  return (
    <Collapsible className="pl-5">
      <CollapsibleTrigger className="group flex items-center gap-1 opacity-80 hover:opacity-100">
        <ChevronRight
          aria-hidden
          className="size-3 motion-safe:transition-transform group-data-[state=open]:rotate-90"
        />
        Details
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-1 flex flex-col gap-1 font-mono text-[11px] opacity-80">
        {lines.map((line) => (
          <span key={line}>{line}</span>
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}
