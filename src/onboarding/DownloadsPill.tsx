import { useLingui } from "@lingui/react/macro";
import { Button } from "@picoframe/frame";
import { RotateCcw, X } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import type { QueueItem } from "@/downloads/DownloadQueueProvider";
import type { BackgroundProblem } from "./useBackgroundDownloads";

/**
 * The background downloads, top right of the wizard. One entry each with its
 * percentage, a cancel control while it runs and the error with a retry control
 * when it fails. Finished and cancelled entries leave the pill. A download that
 * never reached the queue shows its problem, with a retry control when trying
 * again can help.
 */
export function DownloadsPill({
  items,
  problems = [],
  onCancel,
  onRetry,
}: {
  items: QueueItem[];
  problems?: BackgroundProblem[];
  onCancel(id: string): void;
  onRetry(id: string): void;
}) {
  const { t } = useLingui();
  const shown = items.filter(
    (i) => i.status !== "done" && i.status !== "canceled",
  );
  if (shown.length === 0 && problems.length === 0) return null;
  return (
    <div className="absolute top-3 right-4 flex w-64 flex-col gap-2 rounded-lg border bg-card p-2 text-xs">
      {shown.map((item) => {
        const percent = item.progress?.percent;
        return (
          <div key={item.id} className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
              {item.status !== "error" && percent != null && (
                <span className="tabular-nums text-muted-foreground">
                  {`${Math.round(percent)}%`}
                </span>
              )}
              {item.status === "error" ? (
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={t`Retry ${item.label}`}
                  onClick={() => onRetry(item.id)}
                >
                  <RotateCcw />
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={t`Cancel ${item.label}`}
                  onClick={() => onCancel(item.id)}
                >
                  <X />
                </Button>
              )}
            </div>
            {item.status === "error" ? (
              <p className="text-destructive">{item.error}</p>
            ) : (
              <Progress
                value={percent == null ? undefined : Math.round(percent)}
                className="h-1.5 bg-muted"
                aria-label={t`Download progress`}
              />
            )}
          </div>
        );
      })}
      {problems.map((problem) => (
        <div key={problem.id} className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate">{problem.label}</span>
            {problem.retry && (
              <Button
                variant="ghost"
                size="sm"
                aria-label={t`Retry ${problem.label}`}
                onClick={() => onRetry(problem.id)}
              >
                <RotateCcw />
              </Button>
            )}
          </div>
          <p
            className={
              problem.retry ? "text-destructive" : "text-muted-foreground"
            }
          >
            {problem.message}
          </p>
        </div>
      ))}
    </div>
  );
}
