import { Button } from "@picoframe/frame";
import { Download, X } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { type QueueItem, useDownloadQueue } from "./DownloadQueueProvider";
import { formatDuration } from "./downloadRate";
import {
  type ProgressSource,
  QueueProgress,
} from "./pages/components/ProgressBar";

/**
 * The one number the pill has room for, or null when there is nothing worth
 * putting there.
 *
 * Time left is the thing somebody glancing at the topbar actually wants, since
 * it is the one that answers "can I go and do something else". It needs a
 * settled rate though, so until there is one the percentage stands in, and a
 * download that reports neither gets no number rather than a made-up one.
 */
export function badgeSummary(item: ProgressSource | null): string | null {
  if (!item?.progress) return null;
  if (item.rate.secondsLeft != null) {
    return `${formatDuration(item.rate.secondsLeft)} left`;
  }
  if (item.progress.percent != null)
    return `${Math.round(item.progress.percent)}%`;
  return null;
}

/**
 * One running download's name and progress bar, with a cancel button when
 * there is something to cancel. A download reported from outside the queue has
 * no cancel, because the queue has no way to stop something it is not running.
 */
function RunningDownload({
  item,
  onCancel,
}: {
  item: ProgressSource & { label: string };
  onCancel?: () => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {item.label}
        </span>
        {onCancel && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 shrink-0 px-2"
            onClick={onCancel}
            aria-label={`Cancel downloading ${item.label}`}
          >
            <X size={14} />
          </Button>
        )}
      </div>
      {item.progress ? (
        <QueueProgress item={item} />
      ) : (
        <p className="text-xs text-muted-foreground">Starting…</p>
      )}
    </div>
  );
}

/**
 * topbar.right slot: a download-queue widget, shown only while something is
 * downloading or waiting. The pill reports the in-flight count and how much
 * longer the running one has to go. Its popover shows the running downloads'
 * full progress on top and the queued items beneath, each cancellable. Returns
 * null when nothing is downloading.
 *
 * "Running" is the queue's own download plus anything reported to it from
 * outside, which today means coilbox downloading its own update. That one is
 * counted and drawn here rather than given a pill of its own, because the point
 * of this widget is to be the single place on screen that means something is
 * downloading (issue #1790).
 */
export default function DownloadQueueBadge() {
  const { active, queued, reported, cancel } = useDownloadQueue();
  if (!active && queued.length === 0 && reported.length === 0) return null;

  const count = (active ? 1 : 0) + reported.length + queued.length;
  const summary = badgeSummary(active ?? reported[0] ?? null);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary hover:bg-primary/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={
            summary
              ? `Downloads: ${count} in progress, ${summary}`
              : `Downloads: ${count} in progress`
          }
        >
          <Download
            size={14}
            className="animate-pulse motion-reduce:animate-none"
          />
          <span className="tabular-nums">
            {count} downloading{summary ? ` · ${summary}` : ""}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-3">
        {active && (
          <RunningDownload item={active} onCancel={() => cancel(active.id)} />
        )}
        {reported.map((item) => (
          <RunningDownload key={item.id} item={item} />
        ))}
        {queued.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Queued ({queued.length})
            </p>
            <ul className="space-y-1">
              {queued.map((item: QueueItem) => (
                <li
                  key={item.id}
                  className="flex items-center justify-between gap-2 text-sm"
                >
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 shrink-0 px-2"
                    onClick={() => cancel(item.id)}
                    aria-label={`Remove ${item.label} from queue`}
                  >
                    <X size={14} />
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
