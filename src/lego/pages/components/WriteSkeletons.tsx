import { plural } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { Button } from "@picoframe/frame";
import { useState } from "react";
import { appFileIO } from "@/blueprint/fileIO";
import { describeError } from "@/i18n/uiError";
import { useLegoProjects } from "@/lego/projects";
import {
  type SkeletonWriteResult,
  writeSkeletonFiles,
} from "@/lego/skeletonFile";

/**
 * The Skeletons drawer's button for saved models (issue #5181): write the body plan of every
 * unit the builder has saved with a skeleton into the content root, one file
 * for each game, so the widget labels their bones in game. Units already in a
 * file are updated and the rest of the file is kept.
 */
export function WriteSkeletons({
  rootPath,
  busy,
}: {
  rootPath: string;
  busy: boolean;
}) {
  const { t } = useLingui();
  const { projects, loading, error: loadError } = useLegoProjects();
  const [working, setWorking] = useState(false);
  const [result, setResult] = useState<SkeletonWriteResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const write = async () => {
    setWorking(true);
    setError(null);
    setResult(null);
    try {
      setResult(await writeSkeletonFiles(appFileIO, rootPath, projects));
    } catch (e) {
      setError(describeError(e));
    } finally {
      setWorking(false);
    }
  };

  const loadMessage = loadError ? describeError(loadError) : "";
  const unitCount =
    result?.written.reduce((n, w) => n + w.units.length, 0) ?? 0;
  const fileCount = result?.written.length ?? 0;
  const unplacedCount = result?.unplaced.length ?? 0;

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        disabled={busy || working || loading || !!loadError}
        onClick={() => void write()}
      >
        {working ? t`Working…` : t`Write saved models`}
      </Button>
      {(result || error || loadError) && (
        <p role="status" className="w-full text-xs text-muted-foreground">
          {error
            ? error
            : loadError
              ? t`The saved units could not be read: ${loadMessage}`
              : result && fileCount > 0
                ? t`Wrote ${plural(unitCount, { one: "# unit", other: "# units" })} to ${plural(fileCount, { one: "# file", other: "# files" })}.`
                : result && result.withSkeleton === 0
                  ? t`No saved unit has a skeleton.`
                  : t`No skeleton has changed since the last write.`}
          {unplacedCount > 0 &&
            ` ${t`${plural(unplacedCount, { one: "# unit left out: its game has no short name coilbox knows.", other: "# units left out: their games have no short name coilbox knows." })}`}`}
        </p>
      )}
    </>
  );
}
