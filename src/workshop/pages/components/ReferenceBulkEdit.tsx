/**
 * One change to one column across every selected unit in the Reference table
 * (issue #3113), with each unit's old and new value listed before anything is
 * written. It replaces the Batch edit drawer (issue #2655), which only worked
 * on a named collection: here the selection is whatever the table's search,
 * faction and collection filters and checkboxes picked.
 *
 * Inline under the selection bar rather than a dialog, so the table the
 * selection came from stays in view. The arithmetic and the preview are
 * `batchEdit.ts`'s, and applying goes through the caller's `updateOverrides`
 * as one write, so it is one undo step however many units it touches.
 */
import { Button, Input } from "@picoframe/frame";
import { Sigma } from "lucide-react";
import { useState } from "react";
import { Field } from "@/components/Field";
import { OptionSelect } from "@/components/OptionSelect";
import {
  applyBatchRows,
  type BatchOperation,
  type BatchRounding,
  type BatchRow,
  batchChangeCount,
  computeBatchRows,
} from "../../batchEdit";
import { type PostChange, postNoteOf } from "../../beforePost";
import type { UnitOverrides } from "../../overrides";
import { editableColumnIds, editableFieldKeys } from "../../referenceEdit";
import { REFERENCE_COLUMNS, type UnitReferenceRow } from "../../unitReference";

/** How many preview rows are drawn. The apply button still acts on every
 *  selected unit, this only caps what is rendered. Kept from the Batch edit
 *  drawer this replaces. */
const SHOWN_ROWS = 300;

type OperationKind = "percent" | "offset" | "set";

const OPERATION_KINDS: { value: OperationKind; label: string }[] = [
  { value: "percent", label: "Change by %" },
  { value: "offset", label: "Add" },
  { value: "set", label: "Set to" },
];

const ROUNDING_KINDS = [
  { value: "none", label: "No rounding" },
  { value: "integer", label: "Nearest whole number" },
  { value: "nearest", label: "Nearest multiple of…" },
];

const PLACEHOLDERS: Record<OperationKind, string> = {
  percent: "10",
  offset: "-20",
  set: "500",
};

function skipLabel(row: BatchRow): string {
  return row.skipped === "missing" ? "No such field" : "Not a number";
}

/** What the editable page hands the table (issue #3113): the project's units
 *  and overrides to read, and the one way to write them. */
export interface ReferenceEditing {
  /** The game's units with the project's own copies in among them,
   *  unedited. */
  units: Record<string, Record<string, unknown>>;
  overrides: UnitOverrides;
  /** Write the project's overrides as one undo step. */
  updateOverrides: (update: (current: UnitOverrides) => UnitOverrides) => void;
  /** `key`'s row as it would read with `columnId` set to `value`, so the
   *  derived columns follow a number while it is typed. */
  draftRow: (
    key: string,
    columnId: string,
    value: number,
  ) => UnitReferenceRow | undefined;
  /** What the game's post files change per unit (issue #3057), for the note
   *  beside a preview row. Absent when the game's read has not said. */
  beforePost?: { units: Record<string, PostChange> };
}

export function ReferenceBulkEdit({
  rows,
  editing,
  onDone,
}: {
  /** The selected units, in the order they were picked. */
  rows: UnitReferenceRow[];
  editing: ReferenceEditing;
  /** Close the panel, after applying or cancelling. */
  onDone: () => void;
}) {
  const [columnId, setColumnId] = useState("health");
  const [opKind, setOpKind] = useState<OperationKind>("percent");
  const [opValue, setOpValue] = useState("");
  const [roundingKind, setRoundingKind] = useState<
    "none" | "integer" | "nearest"
  >("none");
  const [roundingStep, setRoundingStep] = useState("");

  const amount = Number(opValue);
  const operation: BatchOperation | undefined =
    opValue.trim() === "" || !Number.isFinite(amount)
      ? undefined
      : opKind === "percent"
        ? { kind: "multiply", factor: 1 + amount / 100 }
        : opKind === "offset"
          ? { kind: "offset", amount }
          : { kind: "set", value: amount };

  const step = Number(roundingStep);
  const rounding: BatchRounding | undefined =
    roundingKind === "none"
      ? { kind: "none" }
      : roundingKind === "integer"
        ? { kind: "integer" }
        : roundingStep.trim() !== "" && Number.isFinite(step) && step > 0
          ? { kind: "nearest", step }
          : undefined;

  const preview: BatchRow[] =
    operation && rounding
      ? computeBatchRows(
          rows.map((row) => row.key),
          editableFieldKeys(columnId),
          editing.units,
          editing.overrides,
          operation,
          rounding,
        )
      : [];
  const changeCount = batchChangeCount(preview);
  const nameOf = new Map(rows.map((row) => [row.key, row.name]));

  const apply = () => {
    if (changeCount === 0) return;
    editing.updateOverrides((o) => applyBatchRows(o, preview, editing.units));
    onDone();
  };

  const columns = editableColumnIds().map((id) => ({
    value: id,
    label: REFERENCE_COLUMNS.find((c) => c.id === id)?.label ?? id,
  }));

  return (
    <section
      aria-label="Change the selected units"
      className="flex flex-col gap-3 rounded-lg border border-border/50 bg-card p-3"
    >
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Column" className="w-40">
          <OptionSelect
            value={columnId}
            onValueChange={setColumnId}
            options={columns}
            size="sm"
            ariaLabel="Column"
          />
        </Field>
        <Field label="Operation" className="w-36">
          <OptionSelect
            value={opKind}
            onValueChange={(v) => setOpKind(v as OperationKind)}
            options={OPERATION_KINDS}
            size="sm"
            ariaLabel="Operation"
          />
        </Field>
        <Field label="Value" className="w-28">
          <Input
            inputMode="decimal"
            value={opValue}
            onChange={(e) => setOpValue(e.target.value)}
            placeholder={PLACEHOLDERS[opKind]}
            aria-label="Value"
            className="h-8"
          />
        </Field>
        <Field label="Rounding" className="w-48">
          <OptionSelect
            value={roundingKind}
            onValueChange={(v) =>
              setRoundingKind(v as "none" | "integer" | "nearest")
            }
            options={ROUNDING_KINDS}
            size="sm"
            ariaLabel="Rounding"
          />
        </Field>
        {roundingKind === "nearest" && (
          <Field label="Step" className="w-24">
            <Input
              inputMode="decimal"
              value={roundingStep}
              onChange={(e) => setRoundingStep(e.target.value)}
              placeholder="5"
              aria-label="Step"
              className="h-8"
            />
          </Field>
        )}
      </div>

      {preview.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="text-xs text-muted-foreground">
            {changeCount} of {preview.length} unit
            {preview.length === 1 ? "" : "s"} change
          </p>
          <ul
            aria-label="Preview"
            className="flex max-h-60 flex-col gap-0.5 overflow-y-auto rounded-md border border-border/60 p-1 text-sm"
          >
            {preview.slice(0, SHOWN_ROWS).map((row) => {
              const note =
                row.path !== undefined && editing.beforePost
                  ? postNoteOf(
                      editing.beforePost.units[row.unit],
                      row.path,
                      editing.units[row.unit],
                    )
                  : undefined;
              return (
                <li
                  key={row.unit}
                  className="flex items-center justify-between gap-2 rounded px-2 py-1"
                >
                  <span className="min-w-0 truncate">
                    {nameOf.get(row.unit) ?? row.unit}
                  </span>
                  {row.skipped ? (
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {skipLabel(row)}
                    </span>
                  ) : (
                    <span className="shrink-0 font-mono text-xs">
                      {row.before} {"→"} {row.after}
                      {!row.changed && (
                        <span className="ml-1 text-muted-foreground">
                          (unchanged)
                        </span>
                      )}
                      {note && (
                        <span
                          className="ml-1 text-muted-foreground"
                          title="The game's post files may change this field again as it loads."
                        >
                          *
                        </span>
                      )}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
          {preview.length > SHOWN_ROWS && (
            <p className="text-xs text-muted-foreground">
              Showing the first {SHOWN_ROWS} of {preview.length} units. All of
              them still apply.
            </p>
          )}
        </div>
      )}

      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          onClick={apply}
          disabled={changeCount === 0}
        >
          <Sigma className="mr-1 size-3.5" />
          Apply to {changeCount} unit{changeCount === 1 ? "" : "s"}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </section>
  );
}
