import { Button, buttonVariants, useDrawer } from "@picoframe/frame";
import { Download } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatBytes } from "@/lib/format";
import { cn } from "@/lib/utils";
import { FilterBar } from "../../content/pages/components/FilterBar";
import { EmptyState } from "../../content/pages/components/states";
import {
  type ActivityRow,
  type ActivityState,
  activityRows,
  retryInput,
  retryLabel,
  sourceText,
} from "../activityRows";
import { useDownloadQueue } from "../DownloadQueueProvider";
import { useDownloadHistory } from "../downloadHistory";
import { QueueProgress, StartingBar } from "./components/ProgressBar";

type ActivityChip = "all" | "downloading" | "failed" | "done";
type ActivitySort = "newest" | "name";

const CHIPS: { value: ActivityChip; label: string }[] = [
  { value: "all", label: "All" },
  { value: "downloading", label: "Downloading" },
  { value: "failed", label: "Failed" },
  { value: "done", label: "Done" },
];

const SORT_OPTIONS: { value: ActivitySort; label: string }[] = [
  { value: "newest", label: "Newest first" },
  { value: "name", label: "Name" },
];

const EMPTY_CHIP: Record<ActivityChip, string> = {
  all: "Nothing downloaded yet.",
  downloading: "Nothing is downloading.",
  failed: "No failed downloads.",
  done: "No finished downloads.",
};

const CHIP_STATES: Record<ActivityChip, readonly ActivityState[]> = {
  all: ["active", "queued", "failed", "canceled", "done"],
  downloading: ["active", "queued"],
  failed: ["failed", "canceled"],
  done: ["done"],
};

const DOT: Record<ActivityState, { className: string; label: string }> = {
  active: { className: "bg-primary animate-pulse", label: "Downloading" },
  queued: { className: "bg-muted-foreground/50", label: "Queued" },
  failed: { className: "bg-destructive", label: "Failed" },
  canceled: { className: "bg-amber-500", label: "Cancelled" },
  done: { className: "bg-emerald-500", label: "Done" },
};

const KIND_WORD: Record<ActivityRow["content"], string> = {
  map: "map",
  game: "game",
  rapid: "game",
  engine: "engine",
  file: "file",
};

const SHOW_LINK = buttonVariants({ variant: "ghost", size: "sm" });

const when = (ms: number) =>
  new Date(ms).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });

function StateDot({ state }: { state: ActivityState }) {
  const dot = DOT[state];
  return (
    <span
      role="img"
      aria-label={dot.label}
      className={cn(
        "inline-block size-2.5 rounded-full motion-reduce:animate-none",
        dot.className,
      )}
    />
  );
}

function Result({ row }: { row: ActivityRow }) {
  switch (row.state) {
    case "active":
      return row.item?.progress ? (
        <QueueProgress item={row.item} />
      ) : (
        <StartingBar />
      );
    case "queued": {
      const size = row.item?.sizeBytes;
      return (
        <span className="text-muted-foreground">
          Queued{size ? ` · ${formatBytes(size)}` : ""}
        </span>
      );
    }
    case "failed":
      return (
        <span className="line-clamp-2 break-words text-destructive">
          Failed: {row.failure ?? "no reason given"}
        </span>
      );
    case "canceled":
      return <span className="text-muted-foreground">Cancelled</span>;
    case "done":
      return (
        <span className="text-muted-foreground">
          Done{row.at ? ` · ${when(row.at)}` : ""}
        </span>
      );
  }
}

/** The full text behind a failed or cancelled row, for its drawer. */
export function ActivityLog({ row }: { row: ActivityRow }) {
  return (
    <div className="flex flex-col gap-4 text-sm">
      {row.failure && (
        <pre className="whitespace-pre-wrap break-words rounded-md bg-muted p-3 font-mono text-xs">
          {row.failure}
        </pre>
      )}
      {row.records.length > 0 && (
        <ol className="flex flex-col gap-3">
          {row.records.map((r) => (
            <li
              key={`${r.source}|${r.mirror ?? ""}|${r.at}`}
              className="flex flex-col gap-1"
            >
              <span className="font-medium">
                {sourceText(r)} · {r.outcome === "ok" ? "ok" : "failed"}
              </span>
              <span className="text-xs text-muted-foreground">
                {when(Date.parse(r.at))}
                {r.filename ? ` · ${r.filename}` : ""}
              </span>
              {r.failure && <span className="break-words">{r.failure}</span>}
              {r.detail && r.detail !== r.failure && (
                <pre className="whitespace-pre-wrap break-words font-mono text-xs text-muted-foreground">
                  {r.detail}
                </pre>
              )}
            </li>
          ))}
        </ol>
      )}
      {!row.failure && row.records.length === 0 && (
        <p className="text-muted-foreground">Nothing was recorded.</p>
      )}
    </div>
  );
}

function Actions({
  row,
  onCancel,
  onRetry,
  onLog,
}: {
  row: ActivityRow;
  onCancel: (row: ActivityRow) => void;
  onRetry: (row: ActivityRow) => void;
  onLog: (row: ActivityRow) => void;
}) {
  const canRetry =
    !!row.item && !!row.next && retryInput(row.item, row.next) !== null;
  const hasLog = !!row.failure || row.records.length > 0;
  return (
    <div className="flex justify-end gap-1.5">
      {row.state === "active" && (
        <Button size="sm" variant="ghost" onClick={() => onCancel(row)}>
          Cancel
        </Button>
      )}
      {row.state === "queued" && (
        <Button size="sm" variant="ghost" onClick={() => onCancel(row)}>
          Remove from queue
        </Button>
      )}
      {canRetry && row.next && (
        <Button
          size="sm"
          variant="outline"
          onClick={() => onRetry(row)}
          title={row.next.mirror ?? undefined}
        >
          {retryLabel(row.next, row.content)}
        </Button>
      )}
      {(row.state === "failed" || row.state === "canceled") && hasLog && (
        <Button size="sm" variant="ghost" onClick={() => onLog(row)}>
          Log
        </Button>
      )}
      {row.state === "done" && row.content === "map" && (
        <Link to="/library/maps" className={SHOW_LINK}>
          Show in Maps
        </Link>
      )}
      {row.state === "done" &&
        (row.content === "game" || row.content === "rapid") && (
          <Link to="/library/games" className={SHOW_LINK}>
            Show in Games
          </Link>
        )}
    </div>
  );
}

/**
 * The downloads table with its filter bar. Takes its rows and handlers rather
 * than reading the queue, so a test can draw it from fixtures.
 */
export function DownloadsActivity({
  rows,
  onCancel,
  onRetry,
  onLog,
}: {
  rows: readonly ActivityRow[];
  onCancel: (row: ActivityRow) => void;
  onRetry: (row: ActivityRow) => void;
  onLog: (row: ActivityRow) => void;
}) {
  const [chip, setChip] = useState<ActivityChip>("all");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<ActivitySort>("newest");

  const counts = useMemo(() => {
    const c = {} as Record<ActivityChip, number>;
    for (const { value } of CHIPS)
      c[value] = rows.filter((r) =>
        CHIP_STATES[value].includes(r.state),
      ).length;
    return c;
  }, [rows]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = rows.filter(
      (r) =>
        CHIP_STATES[chip].includes(r.state) &&
        (!q || r.name.toLowerCase().includes(q)),
    );
    return sort === "name"
      ? [...list].sort((a, b) => a.name.localeCompare(b.name))
      : list;
  }, [rows, chip, search, sort]);

  if (rows.length === 0) {
    return <EmptyState icon={Download} label={EMPTY_CHIP.all} />;
  }

  return (
    <>
      <FilterBar
        chips={CHIPS.map((c) => ({ ...c, count: counts[c.value] }))}
        chip={chip}
        onChip={(v) => setChip(v as ActivityChip)}
        chipsLabel="Show"
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Search downloads…"
        searchLabel="Search downloads"
        sort={sort}
        onSort={(v) => setSort(v as ActivitySort)}
        sortOptions={SORT_OPTIONS}
        sortClassName="w-40"
        total={counts[chip]}
        shown={shown.length}
        noun="downloads"
      />
      {shown.length === 0 ? (
        <EmptyState
          icon={Download}
          label={
            search.trim()
              ? `No downloads match "${search.trim()}".`
              : EMPTY_CHIP[chip]
          }
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-6">
                <span className="sr-only">State</span>
              </TableHead>
              <TableHead>Item</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Progress</TableHead>
              <TableHead>
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map((row) => (
              <TableRow key={row.id} data-state={row.state}>
                <TableCell>
                  <StateDot state={row.state} />
                </TableCell>
                <TableCell className="max-w-64">
                  <span className="block truncate font-medium">{row.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {KIND_WORD[row.content]}
                  </span>
                </TableCell>
                <TableCell className="max-w-56 truncate text-xs text-muted-foreground">
                  {row.source ?? "-"}
                </TableCell>
                <TableCell className="w-80 max-w-96 whitespace-normal text-xs">
                  <Result row={row} />
                </TableCell>
                <TableCell>
                  <Actions
                    row={row}
                    onCancel={onCancel}
                    onRetry={onRetry}
                    onLog={onLog}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </>
  );
}

/**
 * Library > Downloads (issue #4583): the queue and its history in one table.
 * A row that stopped before every source was tried offers the next one, in the
 * order the download walks, a pinned source included.
 */
export default function ActivityPage() {
  const { items, settled, cancel, enqueue } = useDownloadQueue();
  const history = useDownloadHistory();
  const drawer = useDrawer();
  const rows = useMemo(
    () => activityRows({ items, settled, history }),
    [items, settled, history],
  );

  return (
    <div className="flex flex-col gap-4 p-4">
      <header className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold">Downloads</h1>
      </header>
      <DownloadsActivity
        rows={rows}
        onCancel={(row) => row.item && cancel(row.item.id)}
        onRetry={(row) => {
          const input =
            row.item && row.next ? retryInput(row.item, row.next) : null;
          if (input) enqueue(input);
        }}
        onLog={(row) =>
          drawer.open({
            title: row.name,
            width: "32rem",
            content: <ActivityLog row={row} />,
          })
        }
      />
    </div>
  );
}
