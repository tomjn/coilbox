/**
 * The sortable table of every unit (issue #1316): the raw fields plus
 * `unitReference.ts`'s derived numbers, one row per unit, searchable the same
 * way the workshop's own unit list is (`searchQuery.ts`) and windowed the
 * same way it is too (`rowVirtualize.ts`), since a game like Beyond All
 * Reason puts well over a thousand rows on screen at once.
 *
 * Selecting two or more rows is how the comparison view (issue #1316's other
 * half) picks its units: a checkbox column here, read by the page that owns
 * `selected` and renders `UnitCompareDrawer` off it.
 *
 * The search box and faction filter live in `UnitReferenceView` (issue
 * #3115), not here: the scatter plot it now draws beside this table reads
 * the same query and faction, so one is the filter both read rather than two
 * that could drift apart. This table receives the already-filtered rows and
 * only adds its own sort.
 */
import { ArrowDown, ArrowUp } from "lucide-react";
import { type ReactNode, useLayoutEffect, useMemo, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { UnitDisplay } from "@/content/bindings";
import { UnitIcon } from "@/content/pages/components/UnitIcon";
import { visibleRowWindow } from "@/lib/rowVirtualize";
import {
  formatReferenceValue,
  REFERENCE_COLUMNS,
  type ReferenceColumn,
  type SortState,
  sortReferenceRows,
  type UnitReferenceRow,
} from "../../unitReference";

/** Pinned by an inline style on every row, the same belt-and-braces reason
 *  `UnitList.tsx`'s own `ROW_HEIGHT` gives. */
const ROW_HEIGHT = 40;
const OVERSCAN = 10;
/** Checkbox column plus the name column. */
const LEADING_COLUMNS = 2;

export function UnitReferenceTable({
  rows,
  emptyMessage,
  selected,
  onToggle,
  allShownSelected,
  onToggleShown,
  renderName,
  picOf,
  picsPending = false,
  factionOf,
}: {
  /** Already filtered by `UnitReferenceView`'s search box and faction
   *  filter: this table only sorts and windows it. */
  rows: UnitReferenceRow[];
  /** What the empty table body says, decided by `UnitReferenceView` from
   *  which filter is active. */
  emptyMessage: string;
  selected: ReadonlySet<string>;
  onToggle: (key: string) => void;
  /** Whether every row in `rows` is selected, for the header checkbox. */
  allShownSelected: boolean;
  /** The header checkbox (issue #3113): select every row in `rows`, or clear
   *  them when every one already is. */
  onToggleShown: () => void;
  /** How to render a row's name cell: a plain span, or a link to the unit's
   *  own page, whichever the caller's page offers. */
  renderName: (row: UnitReferenceRow) => ReactNode;
  /** A row's build picture (issue #3110), the same lookup `UnitList.tsx` draws
   *  its own rows from. Omitted entirely, rather than drawn as a "missing"
   *  box on every row, when a caller has no picture read to offer (the
   *  game's own reference page outside a project). */
  picOf?: (key: string) => UnitDisplay | undefined;
  /** The picture read has not landed yet, so a row's box is a loading
   *  placeholder rather than a "missing" one. */
  picsPending?: boolean;
  /** Which faction reaches a unit, the same walk `UnitList.tsx` uses to tell
   *  apart two rows that share a name (issue #3110). Omitted, alongside the
   *  faction column and its filter, when a caller has no build graph to
   *  answer from. */
  factionOf?: (key: string) => string | undefined;
}) {
  const [sort, setSort] = useState<SortState>({
    columnId: "name",
    direction: "asc",
  });
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);

  useLayoutEffect(() => {
    if (!scroller) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setViewportHeight(entry.contentRect.height);
    });
    observer.observe(scroller);
    return () => observer.disconnect();
  }, [scroller]);

  const sorted = useMemo(() => sortReferenceRows(rows, sort), [rows, sort]);

  const { start, end } = visibleRowWindow(
    scrollTop,
    viewportHeight,
    sorted.length,
    ROW_HEIGHT,
    OVERSCAN,
  );

  const toggleSort = (columnId: string) => {
    setSort((s) =>
      s.columnId === columnId
        ? { columnId, direction: s.direction === "asc" ? "desc" : "asc" }
        : { columnId, direction: "asc" },
    );
  };

  const sortButton = (columnId: string, label: string) => (
    <button
      type="button"
      className="inline-flex items-center gap-1 whitespace-nowrap"
      onClick={() => toggleSort(columnId)}
    >
      {label}
      {sort.columnId === columnId &&
        (sort.direction === "asc" ? (
          <ArrowUp className="size-3" aria-hidden="true" />
        ) : (
          <ArrowDown className="size-3" aria-hidden="true" />
        ))}
    </button>
  );

  /** A column's header: the sort button, wrapped in a tooltip explaining the
   *  number when the column has one (issue #3110), so a derived column like
   *  "DPS per 100 metal" reads the same on the header as it does on the
   *  strip. */
  const columnHeader = (column: ReferenceColumn) => {
    const button = sortButton(column.id, column.label);
    if (!column.help) return button;
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>{button}</TooltipTrigger>
          <TooltipContent>{column.help}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  };

  const totalColumns =
    REFERENCE_COLUMNS.length + LEADING_COLUMNS + (factionOf ? 1 : 0);

  return (
    <div className="flex flex-col gap-2">
      <div
        ref={setScroller}
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
        className="max-h-[70vh] overflow-y-auto rounded-lg border border-border/50"
      >
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-background">
            <TableRow>
              <TableHead className="w-8">
                <Checkbox
                  checked={allShownSelected}
                  disabled={rows.length === 0}
                  onCheckedChange={onToggleShown}
                  aria-label="Select every unit shown"
                />
              </TableHead>
              <TableHead>{sortButton("name", "Name")}</TableHead>
              {factionOf && <TableHead>Faction</TableHead>}
              {REFERENCE_COLUMNS.map((column) => (
                <TableHead key={column.id} className="text-right">
                  {columnHeader(column)}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {start > 0 && (
              <TableRow>
                <TableCell
                  colSpan={totalColumns}
                  style={{ height: start * ROW_HEIGHT, padding: 0 }}
                />
              </TableRow>
            )}
            {sorted.slice(start, end).map((row) => (
              <TableRow
                key={row.key}
                data-state={selected.has(row.key) ? "selected" : undefined}
                style={{ height: ROW_HEIGHT }}
              >
                <TableCell>
                  <Checkbox
                    checked={selected.has(row.key)}
                    onCheckedChange={() => onToggle(row.key)}
                    aria-label={`Select ${row.name} to compare`}
                  />
                </TableCell>
                <TableCell className="font-medium">
                  <span className="flex items-center gap-2">
                    {picOf && (
                      <UnitIcon
                        display={picOf(row.key)}
                        pending={picsPending}
                      />
                    )}
                    {renderName(row)}
                  </span>
                </TableCell>
                {factionOf && (
                  <TableCell className="text-muted-foreground">
                    {factionOf(row.key) ?? "—"}
                  </TableCell>
                )}
                {REFERENCE_COLUMNS.map((column) => (
                  <TableCell
                    key={column.id}
                    className="text-right tabular-nums"
                  >
                    {formatReferenceValue(column.value(row))}
                  </TableCell>
                ))}
              </TableRow>
            ))}
            {sorted.length - end > 0 && (
              <TableRow>
                <TableCell
                  colSpan={totalColumns}
                  style={{
                    height: (sorted.length - end) * ROW_HEIGHT,
                    padding: 0,
                  }}
                />
              </TableRow>
            )}
            {sorted.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={totalColumns}
                  className="text-center text-sm text-muted-foreground"
                >
                  {emptyMessage}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
