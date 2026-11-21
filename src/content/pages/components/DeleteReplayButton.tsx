import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@picoframe/frame";
import { Loader2, Trash2 } from "lucide-react";
import { useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { describeError } from "@/i18n/uiError";
import { formatBytes } from "@/lib/format";
import { contentDeleteReplay, contentDeleteReplays } from "../../bindings";
import { refreshStoredAnalyses } from "../../replayAnalysis";
import { forgetReplay } from "../../replayList";
import { refreshStoredTracks } from "../../replayTracks";
import { unfinishedWarning } from "./ClearUnfinishedButton";

const errMessage = (e: unknown) => describeError(e);

/** Delete a replay after a confirm (irreversible), then hand back to `onDeleted`. */
export function DeleteReplayButton({
  replayPath,
  onDeleted,
  unfinished = false,
}: {
  replayPath: string;
  onDeleted: () => void;
  /** An empty file: the warning says what a running game would lose, and the
   * backend leaves the file alone if it has filled in since the page opened. */
  unfinished?: boolean;
}) {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // What the delete would take with the replay besides the file, read off disk
  // when the confirm opens (#3786). Null until it answers.
  const [track, setTrack] = useState<{ bytes: number } | null>(null);

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) return;
    setTrack(null);
    contentDeleteReplays({ paths: [replayPath], apply: false }).then(
      ({ summary }) =>
        setTrack(summary.tracks > 0 ? { bytes: summary.trackBytes } : null),
      () => {},
    );
  }

  async function del() {
    setPending(true);
    setError(null);
    try {
      const { analysisDeleted, trackDeleted } = await contentDeleteReplay({
        path: replayPath,
        ...(unfinished ? { onlyUnfinished: true } : {}),
      });
      if (analysisDeleted) void refreshStoredAnalyses();
      if (trackDeleted) void refreshStoredTracks();
      forgetReplay(replayPath);
      setOpen(false);
      onDeleted();
    } catch (e) {
      setError(errMessage(e));
    } finally {
      setPending(false);
    }
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button variant="outline" className="gap-1.5">
          <Trash2 className="size-4" /> {t`Delete`}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="flex w-72 flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-medium">{t`Delete this replay?`}</h3>
          <p className="text-xs text-muted-foreground">
            <Trans>
              The file is permanently removed from your demos folder — this
              can't be undone. If this replay has been analysed, its stored
              analysis is deleted with it.
            </Trans>
          </p>
          {track && (
            <p className="text-xs text-muted-foreground">
              <Trans>
                Its recorded track is deleted too, freeing{" "}
                {formatBytes(track.bytes) ?? "0 B"}.
              </Trans>
            </p>
          )}
          {unfinished && (
            <p className="text-xs text-muted-foreground">
              {unfinishedWarning()}
            </p>
          )}
        </div>
        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setOpen(false)}
            disabled={pending}
          >
            <Trans>Cancel</Trans>
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={del}
            disabled={pending}
            className="gap-1.5"
          >
            {pending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Trash2 className="size-4" />
            )}
            <Trans>Delete</Trans>
          </Button>
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </PopoverContent>
    </Popover>
  );
}
