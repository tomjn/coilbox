import { cn } from "@picoframe/frame";
import { useId } from "react";
import type { DownloadProgress } from "../../bindings";

/** Human-readable bytes, e.g. `6.9 MB`. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/** Human-readable transfer rate, e.g. `3.4 MB/s`. */
export function formatSpeed(bytesPerSec: number): string {
  return `${formatBytes(bytesPerSec)}/s`;
}

/** One-line caption summarising a progress sample. */
function caption(p: DownloadProgress): string {
  if (p.phase === "extracting") return "Extracting…";
  const parts: string[] = [];
  if (p.totalBytes != null) {
    parts.push(
      `${formatBytes(p.downloadedBytes)} / ${formatBytes(p.totalBytes)}`,
    );
  } else if (p.downloadedBytes > 0) {
    parts.push(formatBytes(p.downloadedBytes));
  }
  if (p.bytesPerSec != null && p.bytesPerSec > 0) {
    parts.push(formatSpeed(p.bytesPerSec));
  }
  if (p.percent != null) parts.push(`${Math.round(p.percent)}%`);
  return parts.join(" · ");
}

/**
 * Inline download progress bar. Determinate when `percent` is known; otherwise
 * an indeterminate animated bar (extraction, length-less responses). Motion is
 * disabled under `prefers-reduced-motion`.
 */
export function ProgressBar({
  progress,
  className,
}: {
  progress: DownloadProgress;
  className?: string;
}) {
  const determinate = progress.percent != null;
  const value = determinate ? Math.round(progress.percent ?? 0) : undefined;
  const label = caption(progress);
  const captionId = useId();
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuenow={value}
        aria-valuemin={determinate ? 0 : undefined}
        aria-valuemax={determinate ? 100 : undefined}
        aria-label="Download progress"
        aria-describedby={label ? captionId : undefined}
      >
        {determinate ? (
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-150 motion-reduce:transition-none"
            style={{ width: `${value}%` }}
          />
        ) : (
          <div className="h-full w-1/3 animate-pulse rounded-full bg-primary motion-reduce:animate-none" />
        )}
      </div>
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
