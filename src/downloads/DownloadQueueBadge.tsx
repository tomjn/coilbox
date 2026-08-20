import { Button } from "@picoframe/frame";
import { Download, X } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { type QueueItem, useDownloadQueue } from "./DownloadQueueProvider";
import { formatDuration } from "./downloadRate";
import { QueueProgress } from "./pages/components/ProgressBar";

/**
 * The one number the pill has room for, or null when there is nothing worth
 * putting there.
 *
 * Time left is the thing somebody glancing at the topbar actually wants, since
 * it is the one that answers "can I go and do something else". It needs a
 * settled rate though, so until there is one the percentage stands in, and a
 * download that reports neither gets no number rather than a made-up one.
 */
export function badgeSummary(item: QueueItem | null): string | null {
  if (!item?.progress) return null;
  if (item.rate.secondsLeft != null) {
    return `${formatDuration(item.rate.secondsLeft)} left`;
  }
  if (item.progress.percent != null)
    return `${Math.round(item.progress.percent)}%`;
  return null;
}

/**
 * topbar.right slot: a download-queue widget, shown only while something is
 * downloading or waiting. The pill reports the in-flight count and how much
 * longer the running one has to go. Its popover shows that download's full
 * progress on top and the queued items beneath, each cancellable. Returns null
 * when the queue is idle.
 */
export default function DownloadQueueBadge() {
  const { active, queued, cancel } = useDownloadQueue();
  if (!active && queued.length === 0) return null;

  const count = (active ? 1 : 0) + queued.length;
  const summary = badgeSummary(active);
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
          <div className="space-y-2">
            <div className="flex items-start justify-between gap-2">
              <span className="min-w-0 flex-1 truncate text-sm font-medium">
                {active.label}
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 shrink-0 px-2"
                onClick={() => cancel(active.id)}
                aria-label={`Cancel downloading ${active.label}`}
              >
                <X size={14} />
              </Button>
            </div>
            {active.progress ? (
              <QueueProgress item={active} />
            ) : (
              <p className="text-xs text-muted-foreground">Starting…</p>
            )}
          </div>
        )}
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
