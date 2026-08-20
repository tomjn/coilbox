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
  const runs = useRunningUploads();
  if (runs.length === 0) return null;

  const drawing = runs.some((run) => run.phase === "drawing");
  const label = drawing ? "Making pictures" : "Sending pictures";

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary hover:bg-primary/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={`${label} for the hub. Open to stop.`}
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
  const percent =
    run.total > 0 ? Math.min(100, Math.round((run.done / run.total) * 100)) : 0;
  const doing =
    run.phase === "drawing"
      ? `Coilbox is making pictures of ${run.game}'s units. Nothing has been sent yet.`
      : `Coilbox is sending ${run.game}'s pictures to the hub.`;
  const counted =
    run.phase === "drawing"
      ? `${run.done} of ${run.total} made`
      : `${run.done} of ${run.total} sent`;

  return (
    <div className="space-y-2">
      <p className="text-sm">{doing}</p>
      <Progress
        value={percent}
        className="h-1.5 bg-muted"
        aria-label={`${run.game} pictures`}
      />
      <p className="text-xs tabular-nums text-muted-foreground">{counted}</p>
      {run.sent > 0 && (
        // Above the button rather than below it. A stop is not an undo, and the
        // person who needs that is the one deciding whether to press, not the
        // one who already has.
        <p className="text-xs text-muted-foreground">
          {run.sent === 1
            ? "One picture has already gone, and it stays on the hub."
            : `${run.sent} pictures have already gone, and they stay on the hub.`}
        </p>
      )}
      <Button
        variant="outline"
        size="sm"
        className="w-full"
        disabled={run.stopping}
        onClick={() => void stopUploadRun(run.opId)}
      >
        {run.stopping ? "Stopping…" : "Stop sending pictures"}
      </Button>
    </div>
  );
}
