/**
 * What the file an asset field names actually looks like, on the field itself
 * (issue #2694).
 *
 * The Assets section listed a unit's model, script and build picture as paths in
 * text boxes. Browsing for a different one shows you every file in the archive
 * (issue #2648), but the one file the page could not show you was the one the
 * unit already has, which is the one the page is about.
 *
 * Three kinds, three answers, because they cost three different amounts:
 *
 *   - A picture is one small read the worker caches per member, so it is drawn
 *     as a thumbnail without being asked.
 *   - A model is a JSON message of every vertex plus a WebGL context, and
 *     Beyond All Reason has 564 units to move between, so it opens on demand.
 *     The builder link does not wait for it: opening the model in the builder
 *     and looking at it here are two different things to want.
 *   - A script gets no pane. It is source, the Browse drawer already shows it,
 *     and a code listing in a field row would be taller than the section.
 *
 * All three say which archive member the value resolved to, which is the thing
 * none of them could say before: `objectname = "ARMCOM"` is a `.3do` and
 * SplinterFaction's `script = "fedengineer_lus.lua"` is three folders below
 * `scripts/`. It is also what decides whether the builder link appears, since
 * the builder reads `.s3o` and `.3do` and the engine reads seven more formats.
 *
 * Nothing here reads an archive of its own. The picture comes back through the
 * archive browser's member preview and the model through the unit viewer's own
 * reader, the same two the picker uses, so a file looks the same in all three
 * places.
 */
import { Button, buttonVariants, cn } from "@picoframe/frame";
import { Blocks, ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import {
  MODEL_PREVIEW_CAP,
  modelTooLargeToPreview,
} from "@/content/archiveModel";
import { useUnitsyncArchiveFile, useUnitsyncUnitModel } from "@/content/config";
import { ModelViewport } from "@/content/pages/components/ModelViewport";
import { builderOpenUrl, openableInBuilder } from "@/lego/archiveOpen";
import { formatBytes } from "@/lib/format";
import type { AssetBrowsing, AssetField } from "../../assetFields";

/** The member's own size, so a model past the preview cap is never asked for.
 *  Off the listing the page already holds rather than a read of its own. */
function sizeOf(assets: AssetBrowsing, member: string): number | undefined {
  return assets.index.files.find((entry) => entry.path === member)?.size;
}

/** The line every kind carries: the archive member the field's value reached. */
function Resolved({ member }: { member: string }) {
  return (
    <span className="truncate font-mono text-[10px] text-muted-foreground">
      {member}
    </span>
  );
}

/** A picture, at the size of a build icon. Drawn without being asked. */
function PicturePreview({
  member,
  assets,
}: {
  member: string;
  assets: AssetBrowsing;
}) {
  const { data, loading } = useUnitsyncArchiveFile(
    assets.enginePath,
    assets.dataDir,
    assets.archive,
    member,
  );

  if (loading)
    return (
      <span
        aria-hidden
        className="size-12 shrink-0 animate-pulse rounded bg-muted"
      />
    );
  if (data?.kind === "image" && data.dataUrl)
    return (
      <img
        src={data.dataUrl}
        // Decorative: the path beside it already names the file, and there is
        // nothing to say about what a build picture depicts. `UnitIcon` does
        // the same.
        alt=""
        className="size-12 shrink-0 rounded border border-border/50 object-contain"
      />
    );
  // A file that is there and would not decode. The game can still read it, so
  // this is coilbox's gap rather than a broken path, and the warning the row
  // draws for a broken path would be the wrong thing to say.
  return (
    <span
      title="Coilbox cannot draw this picture. The game can still read it."
      className="flex size-12 shrink-0 items-center justify-center rounded border border-border/50 bg-muted text-center text-[9px] leading-tight text-muted-foreground"
    >
      no preview
    </span>
  );
}

/** The model, once somebody asks for it, and the way into the builder. */
function ModelPreview({
  member,
  assets,
  label,
}: {
  member: string;
  assets: AssetBrowsing;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const size = sizeOf(assets, member);
  const tooLarge = modelTooLargeToPreview(size);
  const { model, loading, failed } = useUnitsyncUnitModel(
    assets.enginePath,
    assets.dataDir,
    assets.archive,
    open && !tooLarge ? member : undefined,
  );
  const openable = openableInBuilder(member);

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex min-w-0 items-center gap-1.5">
        <Button
          variant="ghost"
          size="sm"
          className="h-6 shrink-0 gap-1 px-1.5 text-[11px]"
          onClick={() => setOpen((was) => !was)}
          aria-expanded={open}
          // A section can hold more than one model field, so the button says
          // which one it opens rather than leaving several identical "Show
          // model" buttons for a screen reader to tell apart.
          aria-label={`${open ? "Hide" : "Show"} the ${label} model`}
        >
          {open ? (
            <ChevronDown className="size-3" />
          ) : (
            <ChevronRight className="size-3" />
          )}
          {open ? "Hide model" : "Show model"}
        </Button>
        {/* Not behind the preview. Somebody who wants the model in the builder
            has no reason to draw it here first, and the read they would be
            waiting for is the expensive one. */}
        {openable && (
          <Link
            to={builderOpenUrl({
              archive: assets.archive,
              member,
              name: assets.archiveLabel,
            })}
            className={cn(
              buttonVariants({ variant: "ghost", size: "sm" }),
              "h-6 shrink-0 gap-1 px-1.5 text-[11px]",
            )}
            title={`Open ${member} in the unit builder`}
          >
            <Blocks className="size-3" />
            Open in the builder
          </Link>
        )}
      </div>
      {/* Under the buttons rather than beside them. The column is narrow enough
          that two buttons leave a path with four characters of room, and this
          line is the whole answer to what `objectname = "ARMCOM"` resolved to. */}
      <Resolved member={member} />
      {/* Said only where it is a surprise: a model the engine draws with a
          parser of its own, which the builder has no reader for. A field with
          no model at all says nothing here, because the row's own warning
          already has. Worded without a list of what the builder does read,
          since that list has grown once already. */}
      {!openable && (
        <span className="text-[10px] text-muted-foreground">
          The engine draws this one, and the builder cannot open it.
        </span>
      )}
      {open &&
        (tooLarge ? (
          <span className="text-[10px] text-muted-foreground">
            This model is {formatBytes(size)}, past the{" "}
            {formatBytes(MODEL_PREVIEW_CAP)} a preview reads.
          </span>
        ) : loading ? (
          <span className="text-[10px] text-muted-foreground">
            Reading this model out of {assets.archiveLabel}.
          </span>
        ) : failed ? (
          <span className="text-[10px] text-muted-foreground">
            Could not reach unitsync to read this model.
          </span>
        ) : model?.root ? (
          <ModelViewport
            model={model}
            className="h-48 w-full max-w-sm rounded border border-border/50 bg-card"
          />
        ) : (
          <span className="text-[10px] text-muted-foreground">
            Nothing drawable came out of this file.
          </span>
        ))}
    </div>
  );
}

/**
 * The file an asset field currently names, shown.
 *
 * `member` is the archive member the value resolved to, which the row has
 * already worked out to decide whether to warn about the path. Absent for a
 * field with nothing written in it and for one whose path reaches no file, and
 * this draws nothing in either case: the row says so already.
 */
export function AssetPreview({
  field,
  member,
  assets,
  label,
}: {
  field: AssetField;
  member: string;
  assets: AssetBrowsing;
  /** The field's own label, so the viewport has a name to be announced by. */
  label: string;
}) {
  if (field.kind.id === "model")
    return <ModelPreview member={member} assets={assets} label={label} />;
  if (field.kind.id === "picture")
    return (
      <div className="flex min-w-0 items-center gap-2">
        <PicturePreview member={member} assets={assets} />
        <Resolved member={member} />
      </div>
    );
  return <Resolved member={member} />;
}
