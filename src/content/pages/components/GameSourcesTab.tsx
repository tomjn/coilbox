import { Button } from "@picoframe/frame";
import { CheckCircle2, Circle, Pin, XCircle } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDate } from "@/lib/format";
import type { DownloadRecord } from "../../../downloads/downloadHistory";
import type { SourceStep } from "../../../downloads/sourceWalk";
import type { GameSourceRow } from "../../gameSourceRows";

const dateOf = (iso: string) =>
  formatDate(new Date(iso), { dateStyle: "medium" });

/** "2 min 10 s" for a download that took `ms`. */
export function tookLabel(ms: number): string {
  const secs = Math.round(ms / 1000);
  if (secs < 60) return `${secs} s`;
  const mins = Math.floor(secs / 60);
  const rest = secs % 60;
  if (mins < 60) return rest ? `${mins} min ${rest} s` : `${mins} min`;
  const hours = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${hours} h ${m} min` : `${hours} h`;
}

function LastResult({ last }: { last: DownloadRecord | null }) {
  if (!last) {
    return (
      <span className="inline-flex items-center gap-1.5 text-muted-foreground">
        <Circle className="size-3.5 shrink-0" aria-hidden />
        not tried
      </span>
    );
  }
  if (last.outcome === "ok") {
    return (
      <span className="inline-flex items-center gap-1.5">
        <CheckCircle2
          className="size-3.5 shrink-0 text-emerald-500"
          aria-hidden
        />
        ok · {dateOf(last.at)} · {tookLabel(last.durationMs)}
      </span>
    );
  }
  return (
    <span className="inline-flex items-start gap-1.5" title={last.detail ?? ""}>
      <XCircle
        className="mt-0.5 size-3.5 shrink-0 text-destructive"
        aria-hidden
      />
      <span className="min-w-0 break-words">
        failed {dateOf(last.at)} · {last.failure ?? "no reason given"}
      </span>
    </span>
  );
}

/**
 * The game page's Sources tab (issue #4580): the sources a download walks, in
 * order, each with what it would fetch and what happened the last time the
 * player downloaded from it. "Use this" pins a source for this game.
 */
export function GameSourcesTab({
  rows,
  onPin,
}: {
  rows: readonly GameSourceRow[];
  /** Pin a source, or clear the pin with null. */
  onPin: (step: SourceStep | null) => void;
}) {
  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No source can fetch this game.
      </p>
    );
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-6">#</TableHead>
          <TableHead>Source</TableHead>
          <TableHead>Fetches</TableHead>
          <TableHead>Last result</TableHead>
          <TableHead>
            <span className="sr-only">Pin</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row, i) => (
          <TableRow
            key={`${row.label}|${row.where ?? ""}|${row.fetches}`}
            data-pinned={row.pinned || undefined}
          >
            <TableCell className="text-muted-foreground">{i + 1}</TableCell>
            <TableCell>
              <span className="inline-flex items-center gap-1.5">
                {row.pinned && (
                  <Pin className="size-3.5 text-primary" aria-label="Pinned" />
                )}
                {row.label}
                {row.where && (
                  <span className="font-mono text-xs text-muted-foreground">
                    {row.where}
                  </span>
                )}
              </span>
            </TableCell>
            <TableCell className="font-mono text-xs">{row.fetches}</TableCell>
            <TableCell className="max-w-80 text-xs">
              <LastResult last={row.last} />
            </TableCell>
            <TableCell className="text-right">
              {row.pinned ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => onPin(null)}
                >
                  Unpin
                </Button>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => onPin(row.step)}
                >
                  Use this
                </Button>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
