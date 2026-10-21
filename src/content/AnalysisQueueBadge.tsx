import { plural } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@picoframe/frame";
import { ScanSearch, X } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
import {
  analysisPercent,
  analysisProgressLabel,
  analysisRunHidden,
  cancelAnalysis,
  dismissAnalysisFailure,
  useAnalysisQueue,
} from "./replayAnalysis";

/**
 * topbar.right slot: the replay analyses that are running or waiting, and the
 * way to cancel them from any page (#1157). Each one also records its match
 * as a track (#3962).
 *
 * An analysis is asked for on a replay's page and then belongs to the app, so
 * somebody who queued three and went elsewhere needs to see them somewhere.
 * Built to match `DownloadQueueBadge` and `UploadRunBadge`: it takes no room
 * unless there is something to say.
 *
 * A failed run stays here until it is dismissed or that replay is asked for
 * again, because the person who started it may be on another page when it
 * fails.
 */
export default function AnalysisQueueBadge() {
  const { t } = useLingui();
  const queue = useAnalysisQueue();
  if (analysisRunHidden()) return null;
  const { running, queued, failures, waitingForGame } = queue;
  const jobs = (running ? 1 : 0) + queued.length;
  if (jobs === 0 && failures.length === 0) return null;

  // Every job analyses the match and records it, and the badge has room for
  // the one word.
  const failureCount = failures.length;
  const label =
    jobs === 0
      ? plural(failureCount, {
          one: "# analysis failed",
          other: "# analyses failed",
        })
      : waitingForGame
        ? t`Analysis paused`
        : plural(jobs, {
            one: "Analysing # replay",
            other: "Analysing # replays",
          });

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary hover:bg-primary/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={t`${label}. Open to see or cancel.`}
        >
          <ScanSearch
            size={14}
            className={
              running ? "animate-pulse motion-reduce:animate-none" : undefined
            }
          />
          {label}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="flex w-80 flex-col gap-3">
        {waitingForGame && (
          <p className="text-sm">
            <Trans>
              Paused while a game is running. It carries on when the game ends.
            </Trans>
          </p>
        )}
        {running && (
          <div className="flex flex-col gap-1.5">
            <Row
              name={running.name}
              note={analysisProgressLabel(running)}
              cancelLabel={t`Cancel the analysis of ${running.name}`}
              disabled={running.cancelling}
              onCancel={() => void cancelAnalysis(running.id).catch(() => {})}
            />
            {running.phase === "playing" && (
              <Progress
                value={analysisPercent(running)}
                className="h-1.5 bg-muted"
                aria-label={t`Playback of ${running.name}`}
              />
            )}
          </div>
        )}
        {queued.map((job) => (
          <Row
            key={job.id}
            name={job.name}
            note={t`Queued`}
            cancelLabel={t`Cancel the analysis of ${job.name}`}
            onCancel={() => void cancelAnalysis(job.id).catch(() => {})}
          />
        ))}
        {failures.map((failure) => (
          <Row
            key={failure.gameId}
            name={failure.name}
            note={t`Failed. Open the replay to see why.`}
            cancelLabel={t`Dismiss the failed analysis of ${failure.name}`}
            onCancel={() =>
              void dismissAnalysisFailure(failure.gameId).catch(() => {})
            }
          />
        ))}
        {jobs > 1 && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-fit self-end"
            onClick={() => void cancelAnalysis().catch(() => {})}
          >
            <Trans>Cancel all</Trans>
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}

function Row({
  name,
  note,
  cancelLabel,
  disabled,
  onCancel,
}: {
  name: string;
  note: string;
  cancelLabel: string;
  disabled?: boolean;
  onCancel: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-2">
      <div className="flex min-w-0 flex-col">
        <span className="break-all text-xs font-medium">{name}</span>
        <span className="text-xs tabular-nums text-muted-foreground">
          {note}
        </span>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="size-7 shrink-0 p-0"
        aria-label={cancelLabel}
        title={cancelLabel}
        disabled={disabled}
        onClick={onCancel}
      >
        <X className="size-4" />
      </Button>
    </div>
  );
}
