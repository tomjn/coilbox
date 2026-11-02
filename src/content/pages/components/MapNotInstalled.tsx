import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@picoframe/frame";
import { ArrowLeft, Download } from "lucide-react";
import { Link } from "react-router";
import { useWriteRootPath } from "../../../downloads/config";
import {
  QueueProgress,
  StartingBar,
} from "../../../downloads/pages/components/ProgressBar";
import { useQueuedDownload } from "../../../downloads/useQueuedDownload";

/**
 * The map page for a map that is not installed, which is where a shared map link
 * lands for somebody without the map (issue #286). It offers the download, and
 * the page rescans and shows the map once that finishes.
 */
export function MapNotInstalled({
  mapName,
  onDownloaded,
}: {
  mapName: string;
  onDownloaded: () => void;
}) {
  const { t } = useLingui();
  const writePath = useWriteRootPath("maps");
  const download = useQueuedDownload(
    writePath
      ? {
          kind: "mapAnySource",
          label: t`Map: ${mapName}`,
          args: { mapName, writePath },
        }
      : null,
  );

  const start = async () => {
    const settled = await download.start();
    if (settled?.status === "done") onDownloaded();
  };

  return (
    <div className="flex flex-col gap-4 p-4">
      <Link
        to="/library/maps"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline"
      >
        <ArrowLeft className="size-3.5" /> <Trans>Maps</Trans>
      </Link>
      <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-10 text-center">
        <h1 className="break-words text-lg font-semibold">{mapName}</h1>
        <p className="text-sm text-muted-foreground">
          <Trans>This map is not installed.</Trans>
        </p>
        {download.status === "active" ? (
          download.progress ? (
            <QueueProgress item={download} className="w-full max-w-xs" />
          ) : (
            <StartingBar className="w-full max-w-xs" />
          )
        ) : (
          <Button
            size="sm"
            className="gap-1.5"
            disabled={!writePath || download.busy}
            title={
              writePath ? undefined : t`Set a download folder to install maps.`
            }
            onClick={() => void start()}
          >
            <Download className="size-4" />
            {download.status === "queued" ? t`Queued…` : t`Download`}
          </Button>
        )}
        {download.error && (
          <p className="break-words text-xs text-destructive">
            {download.error}
          </p>
        )}
      </div>
    </div>
  );
}
