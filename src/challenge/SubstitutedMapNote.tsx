import { Button, cn } from "@picoframe/frame";
import { Download } from "lucide-react";
import { useUnitsyncScan } from "@/content/config";
import { useMapEligibility } from "@/content/mapEligibility";
import { useWriteRootPath } from "@/downloads/config";
import { QueueProgress } from "@/downloads/pages/components/ProgressBar";
import { useQueuedDownload } from "@/downloads/useQueuedDownload";
import { usePreferredTarget } from "@/play/config";

/**
 * Say that a node is not on the map its challenge names, and offer to fix it
 * where that is possible (issues #1393 and #1833).
 *
 * A shared challenge names the map for every node so everybody who opens it
 * plays the same battlefields. When one of those maps is not available here,
 * coilbox substitutes rather than refusing the import, and this is the line
 * that keeps the substitution from being invisible. Shown wherever the map name
 * is, in both conquest and warpath.
 *
 * Two different things make a map unavailable and only one of them is a
 * download. The map can be absent from this install, which a download fixes,
 * or it can be installed and hidden from the two modes that pick maps for the
 * player, which a download does not: fetching it again lands the same file
 * behind the same exclusion. So the offer appears only once the scan has said
 * which of the two it is, and the sentence stays cause-neutral until then.
 */
export function SubstitutedMapNote({
  original,
  className,
}: {
  /** The map the challenge names. Nothing renders without one. */
  original: string | undefined;
  className?: string;
}) {
  if (!original) return null;
  return <SubstitutedMap original={original} className={className} />;
}

/** The note proper, split out so the hooks below run only for a real stand-in. */
function SubstitutedMap({
  original,
  className,
}: {
  original: string;
  className?: string;
}) {
  const { target } = usePreferredTarget();
  const scan = useUnitsyncScan(target?.enginePath, target?.dataDir);
  const { isExcluded } = useMapEligibility();
  const writePath = useWriteRootPath();
  const mapDl = useQueuedDownload({
    // The challenge carries a map name and nothing else, so there is no picked
    // source to pin: resolve it across every source in policy order.
    kind: "mapAnySource",
    label: `Map: ${original}`,
    args: { mapName: original, writePath },
  });

  // Undefined until the scan lands. An empty install and an unread one look the
  // same from here, and offering a download for a map somebody already has is
  // the worse of the two mistakes.
  const installed = scan.data
    ? scan.data.maps.some((m) => m.name === original)
    : undefined;
  const hidden = installed === true && isExcluded(original);
  // Installed, allowed, and still not used: the map arrived after this node
  // resolved. Restoring it is issue #1834's decision, not this note's.
  const arrived = installed === true && !hidden;

  const download = async () => {
    const settled = await mapDl.start();
    if (settled?.status !== "done") return;
    // The queue drops the cached scan on a finished map, but this component
    // holds its own copy of the result and has to ask for a fresh one.
    await scan.run(true);
  };

  return (
    <div className={cn("text-[10px] text-muted-foreground", className)}>
      <span className="block">
        {arrived
          ? `Stands in for ${original}. You have that map now, but this battle keeps the stand-in.`
          : `Stands in for ${original}, which is not available here.`}
      </span>
      {hidden && (
        <span className="block">
          You have this map, but it is hidden from warpath and galactic
          conquest.
        </span>
      )}
      {installed === false &&
        (mapDl.progress ? (
          <QueueProgress item={mapDl} className="mt-1" />
        ) : (
          <Button
            size="sm"
            variant="outline"
            className="mt-1 h-7 gap-1.5 px-2 text-xs"
            disabled={mapDl.busy}
            // The sentence above names the map, so the button label stays short
            // enough to fit the narrowest panel it appears on.
            aria-label={`Download ${original}`}
            onClick={download}
          >
            <Download className="size-3.5" aria-hidden />
            {mapDl.status === "queued"
              ? "Queued…"
              : mapDl.busy
                ? "Downloading…"
                : "Download"}
          </Button>
        ))}
      {mapDl.error && (
        <span className="block text-destructive">{mapDl.error}</span>
      )}
    </div>
  );
}
