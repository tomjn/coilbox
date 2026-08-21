import { Button, cn } from "@picoframe/frame";
import { Download, Undo2 } from "lucide-react";
import { useState } from "react";
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
 *
 * Once the map is usable the stand-in has outlived its reason, and `onRestore`
 * is how it ends (issue #1834). Never on its own: a map turning up is not a
 * reason to move a battle somebody has already fought around, so the swap
 * happens when it is asked for. Pressing Download here is that asking, so the
 * swap follows the download it started. A map that arrived some other way gets
 * a button instead.
 */
export function SubstitutedMapNote({
  original,
  className,
  onRestore,
}: {
  /** The map the challenge names. Nothing renders without one. */
  original: string | undefined;
  className?: string;
  /**
   * Move this node onto `original`, for a surface that can write the change
   * back. Without it the note only reports, and says so.
   */
  onRestore?: () => void | Promise<void>;
}) {
  if (!original) return null;
  return (
    <SubstitutedMap
      original={original}
      className={className}
      onRestore={onRestore}
    />
  );
}

/** The note proper, split out so the hooks below run only for a real stand-in. */
function SubstitutedMap({
  original,
  className,
  onRestore,
}: {
  original: string;
  className?: string;
  onRestore?: () => void | Promise<void>;
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
  // resolved, so the stand-in can end wherever the surface can end it.
  const arrived = installed === true && !hidden;
  const [restoring, setRestoring] = useState(false);

  const restore = async () => {
    if (!onRestore) return;
    setRestoring(true);
    try {
      await onRestore();
    } finally {
      setRestoring(false);
    }
  };

  const download = async () => {
    const settled = await mapDl.start();
    if (settled?.status !== "done") return;
    // The queue drops the cached scan on a finished map, but this component
    // holds its own copy of the result and has to ask for a fresh one.
    await scan.run(true);
    // The download was a request for this map on this node, so take it. Unless
    // the map was hidden from the modes before it was ever installed, in which
    // case fetching it has not made it usable and the swap would put the node
    // on a map the player has switched off.
    if (!isExcluded(original)) await restore();
  };

  return (
    <div className={cn("text-[10px] text-muted-foreground", className)}>
      <span className="block">
        {arrived
          ? onRestore
            ? `Stands in for ${original}, which you now have.`
            : `Stands in for ${original}. You have that map now, but this battle keeps the stand-in.`
          : `Stands in for ${original}, which is not available here.`}
      </span>
      {arrived && onRestore && (
        <Button
          size="sm"
          variant="outline"
          className="mt-1 h-7 gap-1.5 px-2 text-xs"
          disabled={restoring}
          // The sentence above names the map, so the button label stays short
          // enough to fit the narrowest panel it appears on.
          aria-label={`Use ${original}`}
          onClick={restore}
        >
          <Undo2 className="size-3.5" aria-hidden />
          {restoring ? "Switching…" : "Use it"}
        </Button>
      )}
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
