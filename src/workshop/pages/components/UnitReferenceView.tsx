/**
 * The reference table and the comparison view together (issue #1316), so
 * `UnitReferencePage.tsx` (outside a project) and the workshop's own
 * reference page (inside one) share the one selection-and-compare behaviour
 * rather than each growing their own.
 */
import { Button } from "@picoframe/frame";
import { type ReactNode, useMemo, useState } from "react";
import type { UnitDisplay } from "@/content/bindings";
import type { UnitReferenceRow } from "../../unitReference";
import { UnitCompareDrawer } from "./UnitCompareDrawer";
import { UnitReferenceTable } from "./UnitReferenceTable";

export function UnitReferenceView({
  rows,
  renderName,
  picOf,
  picsPending,
  factionOf,
}: {
  rows: UnitReferenceRow[];
  renderName: (row: UnitReferenceRow) => ReactNode;
  /** See `UnitReferenceTable`: a row's build picture and the picture read's
   *  own pending state (issue #3110), omitted entirely on a page with no
   *  picture read to offer. */
  picOf?: (key: string) => UnitDisplay | undefined;
  picsPending?: boolean;
  /** See `UnitReferenceTable`: which faction reaches a unit (issue #3110),
   *  omitted alongside the faction column and its filter on a page with no
   *  build graph to answer from. */
  factionOf?: (key: string) => string | undefined;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [compareOpen, setCompareOpen] = useState(false);
  const selectedSet = useMemo(() => new Set(selected), [selected]);

  const toggle = (key: string) =>
    setSelected((current) =>
      current.includes(key)
        ? current.filter((k) => k !== key)
        : [...current, key],
    );

  const byKey = useMemo(
    () => new Map(rows.map((row) => [row.key, row])),
    [rows],
  );
  const selectedRows = selected.flatMap((key) => {
    const row = byKey.get(key);
    return row ? [row] : [];
  });

  return (
    <div className="flex flex-col gap-3">
      {selected.length > 0 && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-border/50 bg-card p-2">
          <span className="text-xs text-muted-foreground">
            {selected.length} unit{selected.length === 1 ? "" : "s"} selected
          </span>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setSelected([])}
            >
              Clear
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={selected.length < 2}
              onClick={() => setCompareOpen(true)}
            >
              Compare
            </Button>
          </div>
        </div>
      )}
      <UnitReferenceTable
        rows={rows}
        selected={selectedSet}
        onToggle={toggle}
        renderName={renderName}
        picOf={picOf}
        picsPending={picsPending}
        factionOf={factionOf}
      />
      <UnitCompareDrawer
        open={compareOpen}
        onOpenChange={setCompareOpen}
        rows={selectedRows}
        onRemove={toggle}
      />
    </div>
  );
}
