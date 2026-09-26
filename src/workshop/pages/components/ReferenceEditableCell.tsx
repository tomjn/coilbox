/**
 * One editable number in the Reference table (issue #3113). Reads as the
 * plain number until clicked, then becomes a text box. The edit lands on
 * Enter or when the box loses focus, the same way the unit editor's own field
 * rows settle an edit (`UnitFieldRow.tsx`), so a half-typed number costs no
 * undo step. Escape puts the box back without writing anything.
 *
 * While the box is open every keystroke is reported through `onDraft`, so the
 * row's derived columns (DPS per 100 metal, cost per HP) follow what is being
 * typed before anything is written.
 *
 * An edited cell is marked, and hovering it shows the value before this
 * project's edits.
 */
import { Input } from "@picoframe/frame";
import { useState } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { ReferenceCell } from "../../referenceEdit";
import { formatReferenceValue } from "../../unitReference";

/** A typed number, or `undefined` for anything that is not one. */
function parsed(text: string): number | undefined {
  if (text.trim() === "") return undefined;
  const value = Number(text);
  return Number.isFinite(value) ? value : undefined;
}

export function ReferenceEditableCell({
  cell,
  shown,
  label,
  unitName,
  onDraft,
  onCommit,
}: {
  cell: ReferenceCell;
  /** What the row shows for this column, which follows a draft while one is
   *  being typed. */
  shown: number | undefined;
  /** The column's name, for the box's accessible name. */
  label: string;
  unitName: string;
  onDraft: (value: number | undefined) => void;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState<string | undefined>();

  const close = () => {
    setDraft(undefined);
    onDraft(undefined);
  };
  const commit = () => {
    if (draft === undefined) return;
    const value = parsed(draft);
    if (value !== undefined) onCommit(value);
    close();
  };

  if (draft !== undefined)
    return (
      <Input
        autoFocus
        inputMode="decimal"
        value={draft}
        aria-label={`${label} for ${unitName}`}
        aria-invalid={parsed(draft) === undefined}
        onChange={(e) => {
          setDraft(e.target.value);
          onDraft(parsed(e.target.value));
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") close();
        }}
        className="ml-auto h-7 w-24 text-right tabular-nums"
      />
    );

  const button = (
    <button
      type="button"
      onClick={() =>
        setDraft(cell.value === undefined ? "" : String(cell.value))
      }
      aria-label={`Edit ${label} for ${unitName}, now ${formatReferenceValue(shown)}`}
      className={cn(
        "w-full rounded px-1 text-right tabular-nums hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        cell.edited &&
          "font-medium text-primary underline decoration-dotted underline-offset-2",
      )}
    >
      {formatReferenceValue(shown)}
    </button>
  );
  if (!cell.edited) return button;
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{button}</TooltipTrigger>
        <TooltipContent>
          Before this project's edits: {formatReferenceValue(cell.gameValue)}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
