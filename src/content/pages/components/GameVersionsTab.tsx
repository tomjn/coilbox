import { Button } from "@picoframe/frame";
import { CheckCircle2, Loader2 } from "lucide-react";
import { useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatBytes, formatDate } from "@/lib/format";
import { isDeletableArchive } from "../../format";
import type { GameVersionRow, GameVersionTable } from "../../gameVersionRows";
import { DeleteArchiveButton } from "./DeleteArchiveButton";

const dateOf = (iso: string) =>
  formatDate(new Date(iso), { dateStyle: "medium" });

/** Where a row's download stands in the queue, or null when it has none. */
export type RowStatus = "queued" | "active" | "done" | "error" | null;

function KindCell({ row }: { row: GameVersionRow }) {
  const parts: string[] = [row.kind];
  if (row.date) parts.push(dateOf(row.date));
  if (row.size !== undefined) parts.push(formatBytes(row.size));
  return <>{parts.join(" · ")}</>;
}

function Action({
  row,
  status,
  canInstall,
  onInstall,
  onRemoved,
}: {
  row: GameVersionRow;
  status: RowStatus;
  canInstall: boolean;
  onInstall: (row: GameVersionRow) => void;
  onRemoved: () => void;
}) {
  const path = row.installedItem?.primaryArchive.path;
  if (row.installed) {
    return path && isDeletableArchive(path) ? (
      <DeleteArchiveButton
        path={path}
        name={row.installedItem?.primaryArchive.name ?? row.pkg}
        onDeleted={onRemoved}
      />
    ) : null;
  }
  if (status === "queued" || status === "active") {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" />
        {status === "active" ? "Downloading" : "Queued"}
      </span>
    );
  }
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      disabled={!canInstall || !row.request}
      onClick={() => onInstall(row)}
    >
      Install
    </Button>
  );
}

/**
 * The game page's Versions tab (issue #4580): a row per named rapid tag and per
 * GitHub release archive, with the commit snapshots folded behind one row, and
 * the age of the rapid index under the table.
 */
export function GameVersionsTab({
  table,
  indexAge,
  loading,
  errors,
  canInstall,
  statusOf,
  onInstall,
  onRemoved,
}: {
  table: GameVersionTable;
  /** "Rapid index refreshed 3 min ago from repos.springrts.com", or null. */
  indexAge: string | null;
  loading: boolean;
  errors: readonly string[];
  canInstall: boolean;
  statusOf: (row: GameVersionRow) => RowStatus;
  onInstall: (row: GameVersionRow) => void;
  onRemoved: () => void;
}) {
  const [showSnapshots, setShowSnapshots] = useState(false);
  const rows = showSnapshots ? [...table.rows, ...table.snapshots] : table.rows;
  const empty = table.rows.length === 0 && table.snapshots.length === 0;

  return (
    <div className="flex flex-col gap-2">
      {empty ? (
        <p className="text-sm text-muted-foreground">
          {loading ? "Reading the rapid index…" : "No source lists a version."}
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-6">
                <span className="sr-only">Installed</span>
              </TableHead>
              <TableHead>Version</TableHead>
              <TableHead>Where from</TableHead>
              <TableHead>Kind</TableHead>
              <TableHead>Package</TableHead>
              <TableHead>Needs</TableHead>
              <TableHead>
                <span className="sr-only">Action</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow
                key={row.key}
                data-installed={row.installed || undefined}
              >
                <TableCell>
                  {row.installed && (
                    <CheckCircle2
                      className="size-4 text-emerald-500"
                      aria-label="Installed"
                    />
                  )}
                </TableCell>
                <TableCell className="font-medium">{row.version}</TableCell>
                <TableCell className="font-mono text-xs">{row.from}</TableCell>
                <TableCell className="text-xs">
                  {row.installed ? "installed · " : ""}
                  <KindCell row={row} />
                </TableCell>
                <TableCell className="font-mono text-xs" title={row.pkg}>
                  {row.pkg}
                </TableCell>
                <TableCell className="max-w-56 truncate font-mono text-xs">
                  {row.needs.join(", ")}
                </TableCell>
                <TableCell className="text-right">
                  <Action
                    row={row}
                    status={statusOf(row)}
                    canInstall={canInstall}
                    onInstall={onInstall}
                    onRemoved={onRemoved}
                  />
                </TableCell>
              </TableRow>
            ))}
            {table.snapshots.length > 0 && (
              <TableRow>
                <TableCell />
                <TableCell colSpan={6}>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="text-muted-foreground"
                    aria-expanded={showSnapshots}
                    onClick={() => setShowSnapshots((v) => !v)}
                  >
                    {showSnapshots
                      ? `Hide ${table.snapshots.length} commit snapshots`
                      : `Show ${table.snapshots.length} commit snapshots`}
                  </Button>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      )}
      {indexAge && <p className="text-xs text-muted-foreground">{indexAge}</p>}
      {errors.map((e) => (
        <p key={e} className="break-words text-xs text-destructive">
          {e}
        </p>
      ))}
    </div>
  );
}
