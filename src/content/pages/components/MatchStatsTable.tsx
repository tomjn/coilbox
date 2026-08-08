import { useId } from "react";
import {
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ValueTable } from "../../matchStats";

/**
 * The chart's figures, printed.
 *
 * This works out nothing. {@link ValueTable} arrives already built from the
 * series and the rows the plot was handed, so the per-minute table is the
 * per-minute figures and the teams table is the summed sides, with no second
 * opinion about either.
 *
 * A real table rather than a grid of divs, because the reader this exists for
 * most is the one the chart above is nothing at all to. The caption is the
 * table's name, every column is a `th`, and every row starts with the match
 * time as a `th` of its own, so a cell read on its own says whose figure it is
 * and when.
 */

/** Tall enough for twenty-odd rows, short enough to leave the page usable. */
const SCROLL_HEIGHT = "max-h-[28rem]";

/**
 * A cell the file has no figure for: a team before its first sample, or after
 * the engine stopped recording it. A zero here would claim a measurement.
 */
function NoReading() {
  return (
    <>
      <span className="text-muted-foreground" aria-hidden>
        &ndash;
      </span>
      <span className="sr-only">no reading</span>
    </>
  );
}

export function MatchStatsTable({ table }: { table: ValueTable }) {
  const captionId = useId();

  return (
    // The scroll box is written out here rather than taken from the `Table`
    // wrapper, which owns its own overflow: the stuck header only stays put
    // when the box it scrolls in is the one the sticky cells are measured
    // against, and a scrolled box has to be named and reachable: it holds no
    // focusable element of its own, so without a tab stop a keyboard-only
    // reader cannot reach the bottom of it (WCAG 2.1.1).
    <section
      aria-labelledby={captionId}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrolled box needs a tab stop
      tabIndex={0}
      className={`min-w-0 overflow-auto rounded-md border border-border/50 ${SCROLL_HEIGHT}`}
    >
      <table className="w-full caption-top border-collapse text-sm">
        <TableCaption
          id={captionId}
          className="mt-0 border-b bg-card px-2 py-2 text-left"
        >
          {table.caption}
        </TableCaption>
        {/* A sticky cell leaves its collapsed border behind when it moves, so
         * the line under the header and the line beside the time column are
         * drawn as inset shadows, which travel with the cell. */}
        <TableHeader>
          <TableRow>
            <TableHead
              scope="col"
              className="sticky top-0 left-0 z-20 bg-card px-2 shadow-[inset_-1px_0_0_var(--color-border),inset_0_-1px_0_var(--color-border)]"
            >
              Time
            </TableHead>
            {table.columns.map((c) => (
              <TableHead
                key={c.id}
                scope="col"
                className="sticky top-0 z-10 bg-card px-2 text-right shadow-[inset_0_-1px_0_var(--color-border)]"
              >
                <span className="inline-flex items-center gap-1.5">
                  <span
                    className="size-2 shrink-0 rounded-[2px]"
                    style={{ backgroundColor: c.color }}
                    aria-hidden
                  />
                  {c.label}
                </span>
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {table.rows.map((r) => (
            <TableRow key={r.timeSec}>
              <TableHead
                scope="row"
                className="sticky left-0 z-10 h-auto bg-card px-2 py-2 font-normal tabular-nums shadow-[inset_-1px_0_0_var(--color-border)]"
              >
                {r.time}
              </TableHead>
              {r.cells.map((text, i) => (
                <TableCell
                  key={table.columns[i].id}
                  className="px-2 text-right tabular-nums"
                >
                  {text ?? <NoReading />}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </table>
    </section>
  );
}
