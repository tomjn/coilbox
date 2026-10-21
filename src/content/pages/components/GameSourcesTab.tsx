import { t } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
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
  if (secs < 60) return t`${secs} s`;
  const mins = Math.floor(secs / 60);
  const rest = secs % 60;
  if (mins < 60) return rest ? t`${mins} min ${rest} s` : t`${mins} min`;
  const hours = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? t`${hours} h ${m} min` : t`${hours} h`;
}

function LastResult({ last }: { last: DownloadRecord | null }) {
  const { t } = useLingui();
  if (!last) {
    return (
      <span className="inline-flex items-center gap-1.5 text-muted-foreground">
        <Circle className="size-3.5 shrink-0" aria-hidden />
        <Trans>not tried</Trans>
      </span>
    );
  }
  const when = dateOf(last.at);
  if (last.outcome === "ok") {
    const took = tookLabel(last.durationMs);
    return (
      <span className="inline-flex items-center gap-1.5">
        <CheckCircle2
          className="size-3.5 shrink-0 text-emerald-500"
          aria-hidden
        />
        <Trans>
          ok · {when} · {took}
        </Trans>
      </span>
    );
  }
  const reason = last.failure ?? t`no reason given`;
  return (
    <span className="inline-flex items-start gap-1.5" title={last.detail ?? ""}>
      <XCircle
        className="mt-0.5 size-3.5 shrink-0 text-destructive"
        aria-hidden
      />
      <span className="min-w-0 break-words">
        <Trans>
          failed {when} · {reason}
        </Trans>
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
  const { t } = useLingui();
  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        <Trans>No source can fetch this game.</Trans>
      </p>
    );
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-6">#</TableHead>
          <TableHead>
            <Trans>Source</Trans>
          </TableHead>
          <TableHead>
            <Trans>Fetches</Trans>
          </TableHead>
          <TableHead>
            <Trans>Last result</Trans>
          </TableHead>
          <TableHead>
            <span className="sr-only">
              <Trans>Pin</Trans>
            </span>
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
                  <Pin
                    className="size-3.5 text-primary"
                    aria-label={t`Pinned`}
                  />
                )}
                {row.label === "Direct" ? t`Direct` : row.label}
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
                  <Trans>Unpin</Trans>
                </Button>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => onPin(row.step)}
                >
                  <Trans>Use this</Trans>
                </Button>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
