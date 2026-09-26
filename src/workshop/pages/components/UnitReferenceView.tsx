/**
 * The reference table, its scatter plot (issue #3115) and the comparison
 * view together (issue #1316), so `UnitReferencePage.tsx` (outside a
 * project) and the workshop's own reference page (inside one) share the one
 * search-filter-select-compare behaviour rather than each growing their own.
 *
 * The search box and faction filter live here rather than in the table,
 * because the plot reads the same filtered rows the table does: one query
 * and one faction choice, so a unit hidden from the table cannot still turn
 * up as a dot.
 */
import { Button, Input } from "@picoframe/frame";
import { type ReactNode, useMemo, useState } from "react";
import { OptionSelect } from "@/components/OptionSelect";
import type { UnitDisplay } from "@/content/bindings";
import { cn } from "@/lib/utils";
import {
  ALL_FACTIONS,
  filterReferenceRows,
  type UnitReferenceRow,
} from "../../unitReference";
import { UnitCompareDrawer } from "./UnitCompareDrawer";
import { UnitReferenceTable } from "./UnitReferenceTable";
import { UnitScatterPlot } from "./UnitScatterPlot";

export function UnitReferenceView({
  rows,
  renderName,
  unitHref,
  baselineOf,
  picOf,
  picsPending,
  factionOf,
}: {
  rows: UnitReferenceRow[];
  renderName: (row: UnitReferenceRow) => ReactNode;
  /** Where a unit's own page is, for the scatter plot's dot click. The same
   *  destination `renderName`'s link points a row's name at. */
  unitHref: (row: UnitReferenceRow) => string;
  /** The unit's row before this project's edits (issue #3115), for the
   *  plot's faint "game position" dot. Absent on a page with no project to
   *  compare against (the game's own reference page). */
  baselineOf?: (key: string) => UnitReferenceRow | undefined;
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

  const [query, setQuery] = useState("");
  const [factionFilter, setFactionFilter] = useState(ALL_FACTIONS);

  // Every faction the rows answer for, in alphabetical order, so the filter
  // beside the search box only ever offers a faction that is actually on the
  // table (issue #3110). Absent entirely, alongside the column and the
  // filter it feeds, when the caller has no `factionOf` to ask.
  const factions = useMemo(() => {
    if (!factionOf) return [];
    const seen = new Set<string>();
    for (const row of rows) {
      const faction = factionOf(row.key);
      if (faction) seen.add(faction);
    }
    return [...seen].sort((a, b) => a.localeCompare(b));
  }, [rows, factionOf]);

  const needle = query.trim();
  const filterResult = useMemo(
    () => filterReferenceRows(rows, query, factionFilter, factionOf),
    [rows, query, factionFilter, factionOf],
  );
  const filtered = filterResult.rows;

  const emptyMessage = needle
    ? `No unit matches "${needle}".`
    : factionFilter !== ALL_FACTIONS
      ? "No unit in this faction."
      : "No units.";

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
      <div className="flex items-center gap-3">
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search units… (e.g. hp > 3000)"
          aria-label="Search units"
          className="h-9 max-w-sm"
        />
        {factions.length > 0 && (
          <OptionSelect
            value={factionFilter}
            onValueChange={setFactionFilter}
            ariaLabel="Filter by faction"
            className="h-9 w-auto"
            options={[
              { value: ALL_FACTIONS, label: "All factions" },
              ...factions.map((faction) => ({
                value: faction,
                label: faction,
              })),
            ]}
          />
        )}
        <p
          className={cn(
            "text-xs",
            filterResult.ok ? "text-muted-foreground" : "text-destructive",
          )}
        >
          {!filterResult.ok
            ? filterResult.error
            : needle || factionFilter !== ALL_FACTIONS
              ? `${filtered.length} of ${rows.length} units`
              : `${rows.length} unit${rows.length === 1 ? "" : "s"}`}
        </p>
      </div>
      <UnitScatterPlot
        rows={filtered}
        baselineOf={baselineOf}
        unitHref={unitHref}
        picOf={picOf}
        picsPending={picsPending}
      />
      <UnitReferenceTable
        rows={filtered}
        emptyMessage={emptyMessage}
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
