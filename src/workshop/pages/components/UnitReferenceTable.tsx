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
 */
import { cn, Input } from "@picoframe/frame";
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
import { visibleRowWindow } from "@/lib/rowVirtualize";
import { evaluateUnitQuery, parseUnitQuery } from "../../searchQuery";
import {
  formatReferenceValue,
  REFERENCE_COLUMNS,
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
  selected,
  onToggle,
  renderName,
}: {
  rows: UnitReferenceRow[];
  selected: ReadonlySet<string>;
  onToggle: (key: string) => void;
  /** How to render a row's name cell: a plain span, or a link to the unit's
   *  own page, whichever the caller's page offers. */
  renderName: (row: UnitReferenceRow) => ReactNode;
}) {
  const [query, setQuery] = useState("");
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

  const needle = query.trim();
  const parsedQuery = useMemo(() => parseUnitQuery(needle), [needle]);
  const filtered = useMemo(() => {
    if (!parsedQuery.ok) return [];
    return rows.filter((row) =>
      evaluateUnitQuery(parsedQuery.query, {
        key: row.key,
        name: row.name,
        def: row.def,
        // Already computed for this row (issue #3074): no extra resolution
        // to memoise, since `rows` itself is.
        derived: () => row.derived,
      }),
    );
  }, [rows, parsedQuery]);
  const sorted = useMemo(
    () => sortReferenceRows(filtered, sort),
    [filtered, sort],
  );

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

  const totalColumns = REFERENCE_COLUMNS.length + LEADING_COLUMNS;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search units… (e.g. hp > 3000)"
          aria-label="Search units"
          className="h-9 max-w-sm"
        />
        <p
          className={cn(
            "text-xs",
            parsedQuery.ok ? "text-muted-foreground" : "text-destructive",
          )}
        >
          {!parsedQuery.ok
            ? parsedQuery.error
            : needle
              ? `${sorted.length} of ${rows.length} units`
              : `${rows.length} unit${rows.length === 1 ? "" : "s"}`}
        </p>
      </div>
      <div
        ref={setScroller}
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
        className="max-h-[70vh] overflow-y-auto rounded-lg border border-border/50"
      >
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-background">
            <TableRow>
              <TableHead className="w-8" aria-hidden="true" />
              <TableHead>{sortButton("name", "Name")}</TableHead>
              {REFERENCE_COLUMNS.map((column) => (
                <TableHead key={column.id} className="text-right">
                  {sortButton(column.id, column.label)}
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
                <TableCell className="font-medium">{renderName(row)}</TableCell>
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
                  {needle ? `No unit matches "${needle}".` : "No units."}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
