/**
 * The archive browser's preview of a `.3do` or `.s3o` member (issue #698).
 *
 * Every other previewable member is decoded by unitsync's archive preview
 * command, which knows images, clips and text, so a model used to arrive as a
 * byte count. The read here is the unit viewer's, `unitsync_unit_model`, asked
 * for the member that was clicked rather than for a unitdef's `objectname`. That
 * keeps one reader for both formats and one route for their textures, which are
 * copied out of the archive into the cache the asset protocol serves.
 */

import {
  MODEL_PREVIEW_CAP,
  type ModelFormat,
  modelTooLargeToPreview,
} from "../../archiveModel";
import { useUnitsyncUnitModel } from "../../config";
import { formatBytes } from "../../format";
import { countPieces, countTriangles } from "../../unitModel";
import { ModelNotes, ModelViewport } from "./ModelViewport";
import { Centered } from "./states";

export function ArchiveModelPreview({
  enginePath,
  dataDir,
  archive,
  path,
  format,
  size,
}: {
  enginePath?: string;
  dataDir?: string;
  archive: string;
  /** The member's path inside `archive`, which is what gets read. */
  path: string;
  format: ModelFormat;
  /** The member's size, when the preview read reported one. */
  size?: number;
}) {
  // A model past the cap is never asked for: the read comes back as one JSON
  // message of floats, so a file that big would stall the window rather than
  // draw late.
  const tooLarge = modelTooLargeToPreview(size);
  const { model, loading, failed } = useUnitsyncUnitModel(
    enginePath,
    dataDir,
    archive,
    tooLarge ? undefined : path,
  );

  if (tooLarge) {
    return (
      <Centered>
        This model is {formatBytes(size)}, past the{" "}
        {formatBytes(MODEL_PREVIEW_CAP)} a preview reads. Download it to look at
        it.
      </Centered>
    );
  }
  if (!enginePath || !dataDir) {
    return (
      <Centered>
        No engine is selected, so there is nothing to read this model with.
      </Centered>
    );
  }
  if (loading) {
    return <Centered>Reading this model out of {archive}.</Centered>;
  }
  if (failed) {
    return <Centered>Could not reach unitsync to read this model.</Centered>;
  }
  if (!model) return <Centered>Could not read this file.</Centered>;

  const triangles = model.root ? countTriangles(model.root) : 0;
  if (!model.root || triangles === 0) {
    return (
      <Centered>
        {model.errors[0] ??
          "Nothing drawable came out of this file: it has pieces but no faces."}
      </Centered>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-auto rounded-lg border border-border/50 bg-card">
      <ModelViewport model={model} className="min-h-56 flex-1" />
      <dl className="grid shrink-0 grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 border-t border-border/50 px-3 py-2 text-xs">
        <dt className="text-muted-foreground">Format</dt>
        <dd>{format === "3do" ? "3do (Total Annihilation)" : "s3o"}</dd>

        <dt className="text-muted-foreground">Size</dt>
        <dd>
          {triangles.toLocaleString()} triangles in{" "}
          {countPieces(model.root).toLocaleString()} pieces
          {size != null ? `, ${formatBytes(size)} on disk` : ""}
        </dd>

        <dt className="text-muted-foreground">Textures</dt>
        <dd className="break-all font-mono">
          {model.textures
            .filter((t) => !t.teamColour)
            .map((t) => t.name)
            .join(", ") || "none"}
        </dd>
      </dl>
      <ModelNotes model={model} archive={archive} />
    </div>
  );
}
