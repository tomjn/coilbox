import { Plural, useLingui } from "@lingui/react/macro";
import { Button } from "@picoframe/frame";
import { Images } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
import {
  type RunningUpload,
  stopUploadRun,
  useRunningUploads,
} from "./runningUploads";

/**
 * topbar.right slot: what a picture backfill is doing, and the way to stop it
 * (issue #1686).
 *
 * The topbar rather than the blueprint page. The run is started by opening a
 * layout, so the person is on that page, but the page is about the layout and a
 * progress bar on it would be furniture belonging to something else. The topbar
 * is where coilbox already puts work it is doing on its own: the download queue,
 * a game update, an app update, a game in progress. All of them appear only while
 * there is something to say and take no room otherwise, which is exactly the
 * shape a backfill needs. `DownloadQueueBadge` is the nearest relative and this
 * is built to match it.
 *
 * Returns null when nothing is running, which is almost always. `./runningUploads`
 * holds the rule about which runs get here at all: a run that draws pictures, and
 * not one that only asks the hub what it already has.
 *
 * The stop button is the point of the whole thing. Somebody who turned the switch
 * on and then thought better of it had no way at all to end a run in progress,
 * short of closing the app, and that did not take back what had already gone
 * either. Neither does this, and it says so before the button is pressed rather
 * than afterwards.
 */
export default function UploadRunBadge() {
  const { t } = useLingui();
  const runs = useRunningUploads();
  if (runs.length === 0) return null;

  // A send somebody pressed a button for is named for what it sends, since it
  // carries facts as well as pictures. A backfill keeps its picture wording.
  const manual = runs.some((run) => run.kind !== "pictures");
  const drawing = runs.some((run) => run.phase === "drawing");
  const label = manual
    ? t`Sending to hub`
    : drawing
      ? t`Making pictures`
      : t`Sending pictures`;
  const described = manual
    ? t`Sending to the hub. Open to stop.`
    : drawing
      ? t`Making pictures for the hub. Open to stop.`
      : t`Sending pictures for the hub. Open to stop.`;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary hover:bg-primary/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={described}
        >
          <Images
            size={14}
            className="animate-pulse motion-reduce:animate-none"
          />
          {label}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-4">
        {runs.map((run) => (
          <UploadRunRow key={run.opId} run={run} />
        ))}
      </PopoverContent>
    </Popover>
  );
}

/** One run: what it is doing, how far it has got, and the button that ends it. */
function UploadRunRow({ run }: { run: RunningUpload }) {
  const { t } = useLingui();
  const percent =
    run.total > 0 ? Math.min(100, Math.round((run.done / run.total) * 100)) : 0;
  const { subject, done, total, sent } = run;
  const manual = run.kind !== "pictures";
  const doing =
    run.phase === "reading"
      ? t`Coilbox is reading ${subject} to send to the hub.`
      : run.phase === "drawing"
        ? manual
          ? t`Coilbox is making pictures of ${subject}'s units for the hub.`
          : t`Coilbox is making pictures of ${subject}'s units. Nothing has been sent yet.`
        : manual
          ? t`Coilbox is sending ${subject} to the hub.`
          : t`Coilbox is sending ${subject}'s pictures to the hub.`;
  const counted =
    run.phase === "drawing"
      ? t`${done} of ${total} made`
      : t`${done} of ${total} sent`;

  return (
    <div className="space-y-2">
      <p className="text-sm">{doing}</p>
      {total > 0 && (
        <>
          <Progress
            value={percent}
            className="h-1.5 bg-muted"
            aria-label={t`${subject} progress`}
          />
          <p className="text-xs tabular-nums text-muted-foreground">
            {counted}
          </p>
        </>
      )}
      {run.sent > 0 && (
        // Above the button rather than below it. A stop is not an undo, and the
        // person who needs that is the one deciding whether to press, not the
        // one who already has.
        <p className="text-xs text-muted-foreground">
          <Plural
            value={sent}
            one="One picture has already gone, and it stays on the hub."
            other="# pictures have already gone, and they stay on the hub."
          />
        </p>
      )}
      <Button
        variant="outline"
        size="sm"
        className="w-full"
        disabled={run.stopping}
        onClick={() => void stopUploadRun(run.opId)}
      >
        {run.stopping
          ? t`Stopping…`
          : manual
            ? t`Stop sending`
            : t`Stop sending pictures`}
      </Button>
    </div>
  );
}
