import { cn } from "@picoframe/frame";
import { useEffect, useId, useState } from "react";
import { Progress } from "@/components/ui/progress";
import { formatBytes } from "@/lib/format";
import type { DownloadProgress } from "../../bindings";
import { type DownloadRate, formatDuration } from "../../downloadRate";

/** Human-readable transfer rate, e.g. `3.4 MB/s`. */
export function formatSpeed(bytesPerSec: number): string {
  return `${formatBytes(bytesPerSec)}/s`;
}

/** Below this, a download has not been going long enough to say much about. */
const MIN_ELAPSED_SEC = 2;

/**
 * One-line caption summarising where a download has got to: how much of how
 * much, how fast, and how long is left.
 *
 * Which of those appear depends on what the source reported, so a download
 * whose size nobody knows reads as deliberate rather than broken. It falls back
 * down the chain: bytes of a known total, then bytes alone, then the percentage
 * on its own, and finally an admission that there is none of that. Time left
 * needs a settled rate, and elapsed time stands in for it until there is one.
 *
 * The percentage is left out when the byte total is known, because the bar
 * beside it already says the same thing.
 */
export function progressCaption(
  p: DownloadProgress,
  rate: DownloadRate,
  elapsedSec: number,
): string {
  const parts: string[] = [];
  if (p.phase === "extracting") {
    parts.push("Extracting…");
  } else if (p.totalBytes != null) {
    parts.push(
      `${formatBytes(p.downloadedBytes)} of ${formatBytes(p.totalBytes)}`,
    );
  } else if (p.downloadedBytes > 0) {
    parts.push(formatBytes(p.downloadedBytes));
  } else if (p.percent != null) {
    parts.push(`${Math.round(p.percent)}%`);
  } else if (elapsedSec >= MIN_ELAPSED_SEC) {
    // Nothing to put in the size slot, so say why rather than leave a bar
    // pulsing beside a bare elapsed time. A rapid game served by streamer.cgi
    // arrives with no length, and pr-downloader reports it once and never
    // again. Held back for a second or two so a download that is merely
    // starting does not announce it.
    parts.push("Size unknown");
  }

  if (p.phase !== "extracting") {
    if (rate.stalled) parts.push("stalled");
    else if (rate.bytesPerSec != null)
      parts.push(formatSpeed(rate.bytesPerSec));
  }

  if (rate.secondsLeft != null && p.phase !== "extracting") {
    parts.push(`${formatDuration(rate.secondsLeft)} left`);
  } else if (elapsedSec >= MIN_ELAPSED_SEC) {
    parts.push(`${formatDuration(elapsedSec)} elapsed`);
  }
  return parts.join(" · ");
}

/**
 * Whole seconds since `startedAt`, re-read every second so elapsed time moves
 * between progress events. Returns 0 when there is nothing running, and stops
 * its timer then too.
 */
export function useElapsedSeconds(startedAt: number | null): number {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (startedAt == null) {
      setSeconds(0);
      return;
    }
    const read = () => setSeconds(Math.floor((Date.now() - startedAt) / 1000));
    read();
    const timer = setInterval(read, 1000);
    return () => clearInterval(timer);
  }, [startedAt]);
  return seconds;
}

/**
 * Inline download progress bar. Determinate when `percent` is known, and
 * otherwise an indeterminate animated bar (extraction, length-less responses).
 * Motion is disabled under `prefers-reduced-motion`.
 *
 * `rate` and `startedAt` come from the download queue, which keeps one
 * estimator per download so the numbers survive this component unmounting, such
 * as the topbar popover being closed and reopened.
 */
export function ProgressBar({
  progress,
  rate,
  startedAt,
  className,
}: {
  progress: DownloadProgress;
  rate: DownloadRate;
  startedAt: number | null;
  className?: string;
}) {
  const determinate = progress.percent != null;
  const value = determinate ? Math.round(progress.percent ?? 0) : undefined;
  const elapsedSec = useElapsedSeconds(startedAt);
  const label = progressCaption(progress, rate, elapsedSec);
  const captionId = useId();
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      {determinate ? (
        <Progress
          value={value}
          className="h-1.5 bg-muted"
          aria-label="Download progress"
          aria-describedby={label ? captionId : undefined}
        />
      ) : (
        <div
          className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-label="Download progress"
          aria-describedby={label ? captionId : undefined}
        >
          <div className="h-full w-1/3 animate-pulse rounded-full bg-primary motion-reduce:animate-none" />
        </div>
      )}
      {label && (
        <span
          id={captionId}
          className="text-xs tabular-nums text-muted-foreground"
        >
          {label}
        </span>
      )}
    </div>
  );
}

/** The three things a download bar needs, as the queue hands them out. */
export interface ProgressSource {
  progress: DownloadProgress | null;
  rate: DownloadRate;
  startedAt: number | null;
}

/**
 * A queued download's progress bar, or nothing when it has not started sending
 * progress yet.
 *
 * Every screen that draws a download should go through this rather than
 * `ProgressBar` directly. It is what keeps the speed and time left on every
 * surface, instead of on whichever ones remembered to pass them through.
 */
export function QueueProgress({
  item,
  className,
}: {
  item: ProgressSource | null | undefined;
  className?: string;
}) {
  if (!item?.progress) return null;
  return (
    <ProgressBar
      progress={item.progress}
      rate={item.rate}
      startedAt={item.startedAt}
      className={className}
    />
  );
}
