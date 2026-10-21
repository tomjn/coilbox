import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
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
import { formatBytes, formatDateTime } from "@/lib/format";
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

const CHIPS: { value: ActivityChip; label: MessageDescriptor }[] = [
  { value: "all", label: msg`All` },
  { value: "downloading", label: msg`Downloading` },
  { value: "failed", label: msg`Failed` },
  { value: "done", label: msg`Done` },
];

const SORT_OPTIONS: { value: ActivitySort; label: MessageDescriptor }[] = [
  { value: "newest", label: msg`Newest first` },
  { value: "name", label: msg`Name` },
];

const EMPTY_CHIP: Record<ActivityChip, MessageDescriptor> = {
  all: msg`Nothing downloaded yet.`,
  downloading: msg`Nothing is downloading.`,
  failed: msg`No failed downloads.`,
  done: msg`No finished downloads.`,
};

const CHIP_STATES: Record<ActivityChip, readonly ActivityState[]> = {
  all: ["active", "queued", "failed", "canceled", "done"],
  downloading: ["active", "queued"],
  failed: ["failed", "canceled"],
  done: ["done"],
};

const DOT: Record<
  ActivityState,
  { className: string; label: MessageDescriptor }
> = {
  active: {
    className: "bg-primary animate-pulse",
    label: msg`Downloading`,
  },
  queued: { className: "bg-muted-foreground/50", label: msg`Queued` },
  failed: { className: "bg-destructive", label: msg`Failed` },
  canceled: { className: "bg-amber-500", label: msg`Cancelled` },
  done: { className: "bg-emerald-500", label: msg`Done` },
};

const KIND_WORD: Record<ActivityRow["content"], MessageDescriptor> = {
  map: msg`map`,
  game: msg`game`,
  rapid: msg`game`,
  engine: msg`engine`,
  file: msg`file`,
};

const SHOW_LINK = buttonVariants({ variant: "ghost", size: "sm" });

const when = (ms: number) =>
  formatDateTime(ms, { dateStyle: "medium", timeStyle: "short" });

function StateDot({ state }: { state: ActivityState }) {
  const { i18n } = useLingui();
  const dot = DOT[state];
  return (
    <span
      role="img"
      aria-label={i18n._(dot.label)}
      className={cn(
        "inline-block size-2.5 rounded-full motion-reduce:animate-none",
        dot.className,
      )}
    />
  );
}

function Result({ row }: { row: ActivityRow }) {
  const { t } = useLingui();
  switch (row.state) {
    case "active":
      return row.item?.progress ? (
        <QueueProgress item={row.item} />
      ) : (
        <StartingBar />
      );
    case "queued": {
      const size = row.item?.sizeBytes;
      const queuedSize = size ? formatBytes(size) : "";
      return (
        <span className="text-muted-foreground">
          {size ? t`Queued · ${queuedSize}` : t`Queued`}
        </span>
      );
    }
    case "failed": {
      const reason = row.failure ?? t`no reason given`;
      return (
        <span className="line-clamp-2 break-words text-destructive">
          <Trans>Failed: {reason}</Trans>
        </span>
      );
    }
    case "canceled":
      return (
        <span className="text-muted-foreground">
          <Trans>Cancelled</Trans>
        </span>
      );
    case "done": {
      const finished = row.at ? when(row.at) : "";
      return (
        <span className="text-muted-foreground">
          {row.at ? t`Done · ${finished}` : t`Done`}
        </span>
      );
    }
  }
}

/** The full text behind a failed or cancelled row, for its drawer. */
export function ActivityLog({ row }: { row: ActivityRow }) {
  const { t } = useLingui();
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
                {sourceText(r)} · {r.outcome === "ok" ? t`ok` : t`failed`}
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
        <p className="text-muted-foreground">
          <Trans>Nothing was recorded.</Trans>
        </p>
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
          <Trans>Cancel</Trans>
        </Button>
      )}
      {row.state === "queued" && (
        <Button size="sm" variant="ghost" onClick={() => onCancel(row)}>
          <Trans>Remove from queue</Trans>
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
          <Trans>Log</Trans>
        </Button>
      )}
      {row.state === "done" && row.content === "map" && (
        <Link to="/library/maps" className={SHOW_LINK}>
          <Trans>Show in Maps</Trans>
        </Link>
      )}
      {row.state === "done" &&
        (row.content === "game" || row.content === "rapid") && (
          <Link to="/library/games" className={SHOW_LINK}>
            <Trans>Show in Games</Trans>
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
  const { t, i18n } = useLingui();
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

  const query = search.trim();
  if (rows.length === 0) {
    return <EmptyState icon={Download} label={i18n._(EMPTY_CHIP.all)} />;
  }

  return (
    <>
      <FilterBar
        chips={CHIPS.map((c) => ({
          ...c,
          label: i18n._(c.label),
          count: counts[c.value],
        }))}
        chip={chip}
        onChip={(v) => setChip(v as ActivityChip)}
        chipsLabel={t`Show`}
        search={search}
        onSearch={setSearch}
        searchPlaceholder={t`Search downloads…`}
        searchLabel={t`Search downloads`}
        sort={sort}
        onSort={(v) => setSort(v as ActivitySort)}
        sortOptions={SORT_OPTIONS.map((o) => ({
          ...o,
          label: i18n._(o.label),
        }))}
        sortClassName="w-40"
        total={counts[chip]}
        shown={shown.length}
        noun={t`downloads`}
      />
      {shown.length === 0 ? (
        <EmptyState
          icon={Download}
          label={
            search.trim()
              ? t`No downloads match "${query}".`
              : i18n._(EMPTY_CHIP[chip])
          }
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-6">
                <span className="sr-only">
                  <Trans>State</Trans>
                </span>
              </TableHead>
              <TableHead>
                <Trans>Item</Trans>
              </TableHead>
              <TableHead>
                <Trans>Source</Trans>
              </TableHead>
              <TableHead>
                <Trans>Progress</Trans>
              </TableHead>
              <TableHead>
                <span className="sr-only">
                  <Trans>Actions</Trans>
                </span>
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
                    {i18n._(KIND_WORD[row.content])}
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
        <h1 className="text-lg font-semibold">
          <Trans>Downloads</Trans>
        </h1>
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
