import { useLingui } from "@lingui/react/macro";
import { Button } from "@picoframe/frame";
import { RotateCcw, X } from "lucide-react";
import type { ReactNode } from "react";
import type { QueueItem } from "@/downloads/DownloadQueueProvider";
import type { BackgroundProblem } from "./useBackgroundDownloads";

/**
 * The background downloads, one compact line each in the wizard's footer:
 * the label, then the percentage or the error, and a cancel control while it
 * runs or a retry control when it fails. A download that never reached the
 * queue shows its problem, with a retry control when trying again can help.
 * Finished and cancelled entries leave. The lines sit side by side so the
 * footer keeps its height. Long text is cut short on screen, with the full
 * text as its title.
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
    <div
      data-testid="downloads-pill"
      className="flex min-w-0 items-center gap-2 overflow-hidden text-xs"
    >
      {shown.map((item) => {
        const percent = item.progress?.percent;
        const failed = item.status === "error";
        return (
          <Line key={item.id} label={item.label}>
            {failed ? (
              <Status text={item.error ?? ""} tone="text-destructive" />
            ) : (
              percent != null && (
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {`${Math.round(percent)}%`}
                </span>
              )
            )}
            {failed ? (
              <Control
                label={t`Retry ${item.label}`}
                onClick={() => onRetry(item.id)}
              >
                <RotateCcw />
              </Control>
            ) : (
              <Control
                label={t`Cancel ${item.label}`}
                onClick={() => onCancel(item.id)}
              >
                <X />
              </Control>
            )}
          </Line>
        );
      })}
      {problems.map((problem) => (
        <Line key={problem.id} label={problem.label}>
          <Status
            text={problem.message}
            tone={problem.retry ? "text-destructive" : "text-muted-foreground"}
          />
          {problem.retry && (
            <Control
              label={t`Retry ${problem.label}`}
              onClick={() => onRetry(problem.id)}
            >
              <RotateCcw />
            </Control>
          )}
        </Line>
      ))}
    </div>
  );
}

function Line({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex h-8 min-w-0 max-w-72 items-center gap-1.5 rounded-md border bg-card pr-1 pl-2.5">
      <span title={label} className="min-w-0 shrink truncate">
        {label}
      </span>
      {children}
    </div>
  );
}

function Status({ text, tone }: { text: string; tone: string }) {
  return (
    <span title={text} className={`min-w-0 flex-1 truncate ${tone}`}>
      {text}
    </span>
  );
}

function Control({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick(): void;
  children: ReactNode;
}) {
  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-6 shrink-0"
      aria-label={label}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}
