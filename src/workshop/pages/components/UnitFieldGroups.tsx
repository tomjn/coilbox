/**
 * The grouped, collapsible field list (issue #1270).
 *
 * The headings and the order come from `unitSections.ts`. This only draws them,
 * and a section with nothing in it never reaches here, so an empty collapsible
 * is not a state that exists.
 *
 * Sections start open. In the relevant view they hold a handful of rows each,
 * and a page that opens with eight closed drawers makes the reader do the work
 * of finding out which one has anything in it. The count in each header is what
 * says whether opening one is worth it in the all view.
 */
import { ChevronRight } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import type { CustomParamsResult } from "@/content/bindings";
import { consumerNote } from "../../customParamConsumers";
import type { FieldRow, UnitFieldView } from "../../unitSections";
import { UnitFieldRow } from "./UnitFieldRow";

export function UnitFieldGroups({
  view,
  consumers,
  onChange,
  onReset,
}: {
  view: UnitFieldView;
  /** The game's custom parameter consumer index, or `null` while it is still
   *  being read. Only custom parameter rows use it (issue #2661). */
  consumers: CustomParamsResult | null;
  onChange: (row: FieldRow, value: unknown) => void;
  onReset: (row: FieldRow) => void;
}) {
  if (view.groups.length === 0)
    return (
      <p className="text-sm text-muted-foreground">
        This unit's definition is empty.
      </p>
    );

  return (
    <div className="flex flex-col gap-5">
      {view.groups.map((group) => (
        <section key={group.id} className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">{group.label}</h3>
          {group.sections.map((section) => {
            const changed = section.rows.filter(
              (r) => r.state === "overridden",
            ).length;
            return (
              <Collapsible
                key={section.id}
                defaultOpen
                className="rounded-lg border border-border/50"
              >
                <CollapsibleTrigger className="group flex w-full cursor-pointer items-center gap-1.5 px-2 py-2 text-left text-xs font-medium">
                  <ChevronRight className="size-3.5 shrink-0 transition-transform group-data-[state=open]:rotate-90" />
                  {section.label}
                  <span className="text-muted-foreground">
                    {section.rows.length}
                  </span>
                  {changed > 0 && (
                    <span className="rounded-full bg-primary/15 px-1.5 text-[10px] text-primary">
                      {changed} changed
                    </span>
                  )}
                </CollapsibleTrigger>
                <CollapsibleContent className="flex flex-col gap-0.5 border-t border-border/50 p-1">
                  {section.rows.map((row) => (
                    <UnitFieldRow
                      key={row.path}
                      row={row}
                      note={consumerNote(row.path, consumers) ?? undefined}
                      onChange={(value) => onChange(row, value)}
                      onReset={() => onReset(row)}
                    />
                  ))}
                </CollapsibleContent>
              </Collapsible>
            );
          })}
        </section>
      ))}
    </div>
  );
}
