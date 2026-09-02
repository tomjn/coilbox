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
import {
  forwardRef,
  type ReactNode,
  useImperativeHandle,
  useState,
} from "react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useFieldProblem } from "@/lib/useFieldProblem";
import { useFieldText } from "@/lib/useFieldText";

/** What a caller outside the panel can ask it to do, reached through a ref the
 *  way an imperative `inputRef.current.focus()` is. `ScenarioEditPage` uses
 *  this to expand a panel a mission problem points into, without the panel
 *  fighting an author who has since shut it again (issue #2271). */
export interface EditorPanelHandle {
  /** Expand the panel. Does nothing if it is already open. */
  open: () => void;
}

export const EditorPanel = forwardRef<
  EditorPanelHandle,
  {
    title: string;
    icon: LucideIcon;
    /** What the panel holds, in a few words, so a shut panel still says
     *  something. */
    summary: string;
    defaultOpen?: boolean;
    children: ReactNode;
  }
>(function EditorPanel(
  { title, icon: Icon, summary, defaultOpen = false, children },
  ref,
) {
  // Owned here rather than left to `Collapsible`'s own `defaultOpen`, so a
  // ref can force it open. Passing `open` alongside `onOpenChange` this way
  // is behaviourally the same uncontrolled toggle `defaultOpen` gave every
  // caller before this, with a controlled escape hatch added on top.
  const [open, setOpen] = useState(defaultOpen);
  useImperativeHandle(ref, () => ({ open: () => setOpen(true) }), []);

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
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
});

/**
 * Why a field's box just put back what was in it, next to the field itself
 * (issue #2275).
 *
 * `aria-describedby` on the field is the main route to this, read out the
 * moment the field is focused, on the first tab in as much as on a tab back
 * to fix it. But the revert happens on blur, when focus has already left for
 * wherever Tab or a click sent it, so `aria-live` says it too, without
 * waiting for the field to be found again. Not `role="status"`, which the
 * editor already puts on the document's own save/undo output elsewhere on
 * the page, `SaveStatus` and the plain `<output>` these panels sit beside in
 * tests. A second one would make "the status region" ambiguous, both to a
 * screen reader and to a test asking for it by role.
 *
 * Mounted whether or not there is anything to say, because a live region only
 * reliably announces text that changes in an element already in the DOM, the
 * same lesson `SaveStatus` documents. With nothing to report it is `sr-only`:
 * out of the flow so it costs no room in the row the field sits in, but still
 * there for the announcement to land in.
 */
export function FieldProblem({
  id,
  problem,
}: {
  id: string;
  problem: string | null;
}) {
  return (
    <p
      id={id}
      aria-live="polite"
      aria-atomic="true"
      className={problem ? "text-[11px] text-destructive" : "sr-only"}
    >
      {problem}
    </p>
  );
}

/**
 * What is wrong with a whole thing rather than one of its fields: an actor, a
 * group or a base standing off the map, a team with no engine number, or a
 * base building whose id collides with another's (issue #2343). None of
 * these name a control `aria-invalid` can sit on, so this is `LayoutNotes`'
 * own shape (`src/placement/LayoutControls.tsx`, issue #1416) rather than
 * `FieldProblem`'s: a coloured block a screen reader meets in the reading
 * order it sits in, rather than a line tied to one field by
 * `aria-describedby`. Red rather than `LayoutNotes`' mix of colours, because
 * every check this covers is always an error (`isBlocking`), never a
 * warning, so there is one thing to say rather than a severity to choose
 * between.
 *
 * Rendered null with nothing to say, the same as `LayoutNotes`' own notes,
 * so a caller can call this unconditionally rather than wrapping every use in
 * its own `{problem && ...}`.
 */
export function RowProblem({ problem }: { problem: string | null }) {
  if (!problem) return null;
  return (
    <p className="rounded bg-red-950/60 px-2 py-1.5 text-[11px] text-red-200">
      {problem}
    </p>
  );
}

/**
 * The name of a thing whose name is its id. A variable is the only one left:
 * its name is the key in `vars`, so there is no id beside it to point at. An
 * objective and a dialogue line each have one, and it is not editable (issue
 * #2248).
 *
 * Committed when the box is left rather than as it is typed, because every edit
 * a panel makes is written to disk. Put back when the name is refused, which is
 * what an empty or already-taken name is: both make a document `parseScenario`
 * will not load, and the author would find their scenario gone from the list.
 * `onRename` says why instead of returning a bare yes or no, and that reason is
 * what `FieldProblem` shows (issue #2275).
 */
export function NameField({
  name,
  label,
  onRename,
  className,
}: {
  name: string;
  label: string;
  /** Null commits the rename. A reason puts the old name back and shows why. */
  onRename: (wanted: string) => string | null;
  className?: string;
}) {
  const [text, setText] = useFieldText(name);
  const { problem, refuse, clear, describedBy } = useFieldProblem();

  return (
    <div className="flex flex-1 flex-col gap-0.5">
      <Input
        aria-label={label}
        aria-invalid={problem !== null}
        aria-describedby={describedBy}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          clear();
        }}
        onBlur={() => {
          if (text.trim() === name) return setText(name);
          const reason = onRename(text);
          if (reason === null) return clear();
          setText(name);
          refuse(reason);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
        className={className ?? "h-7 w-52 font-mono text-xs"}
      />
      <FieldProblem id={describedBy} problem={problem} />
    </div>
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
  describedBy,
}: {
  value: string;
  label: string;
  placeholder?: string;
  onCommit: (value: string) => void;
  className?: string;
  /** The id of a {@link FieldProblem} this field's value is about, so a
   *  screen reader reads the problem the moment the field is focused rather
   *  than only once the value it explains has already been left. */
  describedBy?: string;
}) {
  const [text, setText] = useFieldText(value);

  return (
    <Input
      aria-label={label}
      aria-describedby={describedBy}
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
