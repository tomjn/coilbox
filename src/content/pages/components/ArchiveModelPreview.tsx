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

import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@picoframe/frame";
import { Blocks } from "lucide-react";
import { useNavigate } from "react-router";

import { builderOpenUrl } from "@/lego/archiveOpen";
import { formatBytes } from "@/lib/format";
import {
  MODEL_PREVIEW_CAP,
  type ModelFormat,
  modelTooLargeToPreview,
} from "../../archiveModel";
import { useUnitsyncUnitModel } from "../../config";
import { countPieces, countTriangles, modelFormatLabel } from "../../unitModel";
import { ModelReadFailed } from "./ModelReadFailed";
import { ModelNotes, ModelViewport } from "./ModelViewport";
import { Centered } from "./states";

export function ArchiveModelPreview({
  enginePath,
  dataDir,
  archive,
  archiveLabel,
  path,
  format,
  size,
}: {
  enginePath?: string;
  dataDir?: string;
  archive: string;
  /** The game or map behind the archive's file name, for the builder to file an
   *  opened unit under. */
  archiveLabel?: string;
  /** The member's path inside `archive`, which is what gets read. */
  path: string;
  format: ModelFormat;
  /** The member's size, when the preview read reported one. */
  size?: number;
}) {
  const { t } = useLingui();
  const navigate = useNavigate();
  // A model past the cap is never asked for: the read comes back as one JSON
  // message of floats, so a file that big would stall the window rather than
  // draw late.
  const tooLarge = modelTooLargeToPreview(size);
  const { model, loading, failed, error, retry } = useUnitsyncUnitModel(
    enginePath,
    dataDir,
    archive,
    tooLarge ? undefined : path,
  );

  const modelSize = formatBytes(size);
  const previewCap = formatBytes(MODEL_PREVIEW_CAP);
  if (tooLarge) {
    return (
      <Centered>
        <Trans>
          This model is {modelSize}, past the {previewCap} a preview reads.
          Download it to look at it.
        </Trans>
      </Centered>
    );
  }
  if (!enginePath || !dataDir) {
    return (
      <Centered>
        <Trans>
          No engine is selected, so there is nothing to read this model with.
        </Trans>
      </Centered>
    );
  }
  if (loading) {
    return (
      <Centered>
        <Trans>Reading this model out of {archive}.</Trans>
      </Centered>
    );
  }
  if (failed) {
    return (
      <Centered>
        <ModelReadFailed
          error={error}
          fallback={t`Could not reach unitsync to read this model.`}
          onRetry={retry}
        />
      </Centered>
    );
  }
  if (!model)
    return (
      <Centered>
        <Trans>Could not read this file.</Trans>
      </Centered>
    );

  const triangles = model.root ? countTriangles(model.root) : 0;
  const pieces = model.root ? countPieces(model.root) : 0;
  const onDisk = size != null ? formatBytes(size) : "";
  if (!model.root || triangles === 0) {
    return (
      <Centered>
        {model.errors[0] ??
          t`Nothing drawable came out of this file: it has pieces but no faces.`}
      </Centered>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-auto rounded-lg border border-border/50 bg-card">
      <ModelViewport model={model} className="min-h-56 flex-1" />
      <dl className="grid shrink-0 grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 border-t border-border/50 px-3 py-2 text-xs">
        <dt className="text-muted-foreground">
          <Trans>Format</Trans>
        </dt>
        <dd>{modelFormatLabel(format)}</dd>

        <dt className="text-muted-foreground">
          <Trans>Size</Trans>
        </dt>
        <dd>
          {size != null ? (
            <Trans>
              <Plural value={triangles} one="# triangle" other="# triangles" />{" "}
              in <Plural value={pieces} one="# piece" other="# pieces" />,{" "}
              {onDisk} on disk
            </Trans>
          ) : (
            <Trans>
              <Plural value={triangles} one="# triangle" other="# triangles" />{" "}
              in <Plural value={pieces} one="# piece" other="# pieces" />
            </Trans>
          )}
        </dd>

        <dt className="text-muted-foreground">
          <Trans>Textures</Trans>
        </dt>
        <dd className="break-all font-mono">
          {model.textures
            .filter((tex) => !tex.teamColour)
            .map((tex) => tex.name)
            .join(", ") || t`none`}
        </dd>
      </dl>
      <div className="flex shrink-0 items-center gap-3 border-t border-border/50 px-3 py-2">
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5"
          onClick={() =>
            navigate(
              builderOpenUrl({
                archive,
                member: path,
                ...(archiveLabel ? { name: archiveLabel } : {}),
              }),
            )
          }
        >
          <Blocks className="size-3.5" /> <Trans>Open in the builder</Trans>
        </Button>
        <span className="text-xs text-muted-foreground">
          {format === "3do" ? (
            <Trans>
              Converts its geometry and texture tiles into a unit of their own,
              so updating {archive} later cannot change it.
            </Trans>
          ) : (
            <Trans>
              Takes its own copy of the geometry and texture, so updating{" "}
              {archive} later cannot change the unit.
            </Trans>
          )}
        </span>
      </div>
      <ModelNotes model={model} archive={archive} />
    </div>
  );
}
