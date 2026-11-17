import { useLingui } from "@lingui/react/macro";
import { Button } from "@picoframe/frame";
import { ArrowUp } from "lucide-react";
import { useEffect } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
import { formatBytes } from "@/lib/format";
import {
  type ArchiveUploadState,
  cancelArchiveUpload,
} from "../archiveUploads";
import { followArchiveUploads, labelOf, useArchiveUploads } from "./store";

/**
 * topbar.right slot: the map and game archives being uploaded to the hub, and the
 * way to stop one (issue #5259).
 *
 * In the topbar for the reason `UploadRunBadge` is: it is where coilbox shows
 * work it is doing, and it takes no room when there is none. Mounted for the life
 * of the app, so it is also what starts following the uploads Rust is running.
 * Leaving a detail page does not stop an upload and does not remove this.
 */
export default function ArchiveUploadBadge() {
  const { t } = useLingui();
  const running = useArchiveUploads().filter((one) => one.phase !== "done");
  useEffect(() => {
    void followArchiveUploads();
  }, []);
  if (running.length === 0) return null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary hover:bg-primary/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={t`Uploading to the hub. Open to stop.`}
        >
          <ArrowUp
            size={14}
            className="animate-pulse motion-reduce:animate-none"
          />
          {t`Uploading to hub`}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-4">
        {running.map((upload) => (
          <ArchiveUploadRow key={upload.opId} upload={upload} />
        ))}
      </PopoverContent>
    </Popover>
  );
}

/** One upload: what it is doing, how far it has got, and the button that stops it. */
function ArchiveUploadRow({ upload }: { upload: ArchiveUploadState }) {
  const { t } = useLingui();
  const name = labelOf(upload);
  const percent =
    upload.size > 0
      ? Math.min(100, Math.round((upload.sent / upload.size) * 100))
      : 0;
  const sent = formatBytes(upload.sent);
  const size = formatBytes(upload.size);
  const doing =
    upload.phase === "reserving"
      ? t`Coilbox is asking the hub where to send ${name}.`
      : upload.phase === "waiting"
        ? t`The mirror has all of ${name}. Waiting for the hub to list it.`
        : t`Coilbox is uploading ${name} to the hub's mirror.`;

  return (
    <div className="space-y-2">
      <p className="text-sm">{doing}</p>
      {upload.phase === "sending" && (
        <>
          <Progress
            value={percent}
            className="h-1.5 bg-muted"
            aria-label={t`${name} progress`}
          />
          <p className="text-xs tabular-nums text-muted-foreground">
            {t`${sent} of ${size} sent`}
          </p>
        </>
      )}
      <p className="text-xs text-muted-foreground">
        {t`Stopping keeps what the mirror has. Uploading it again carries on from there.`}
      </p>
      <Button
        variant="outline"
        size="sm"
        className="w-full"
        onClick={() => void cancelArchiveUpload(upload.opId)}
      >
        {t`Stop uploading`}
      </Button>
    </div>
  );
}
