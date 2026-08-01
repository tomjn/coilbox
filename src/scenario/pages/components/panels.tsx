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

import { Input } from "@picoframe/frame";
import { ChevronRight, type LucideIcon } from "lucide-react";
import { type ReactNode, useState } from "react";
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

/**
 * The name of a thing whose name is its id: an objective, a dialogue line, a
 * variable.
 *
 * Committed when the box is left rather than as it is typed, because every edit
 * a panel makes is written to disk. Put back when the name is refused, which is
 * what an empty or already-taken name is: both make a document `parseScenario`
 * will not load, and the author would find their scenario gone from the list.
 */
export function NameField({
  name,
  label,
  onRename,
  className,
}: {
  name: string;
  label: string;
  /** True when the rename was written. False puts the old name back. */
  onRename: (wanted: string) => boolean;
  className?: string;
}) {
  const [text, setText] = useState(name);

  return (
    <Input
      aria-label={label}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        if (text.trim() === name) return setText(name);
        if (!onRename(text)) setText(name);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
      className={className ?? "h-7 w-52 font-mono text-xs"}
    />
  );
}

/**
 * A free text field of a panel's form. Local while it is typed and committed
 * when it is left, for the same reason: a save per keystroke is a disk write per
 * keystroke.
 */
export function TextField({
  value,
  label,
  placeholder,
  onCommit,
  className,
}: {
  value: string;
  label: string;
  placeholder?: string;
  onCommit: (value: string) => void;
  className?: string;
}) {
  const [text, setText] = useState(value);

  return (
    <Input
      aria-label={label}
      value={text}
      placeholder={placeholder}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        if (text !== value) onCommit(text);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
      className={className ?? "h-7 text-xs"}
    />
  );
}
