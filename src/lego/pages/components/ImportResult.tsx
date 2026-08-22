/**
 * Reading somebody else's `.s3o`, and saying what came of it.
 *
 * Two ways in share this: the file dialog in {@link ImportDrawer}, and the game
 * picker in {@link GameModelDrawer}, which finds a model by unit name instead of
 * by path. Both end at the same two outcomes, so both report them the same way
 * rather than each writing its own account of what a raw import is.
 *
 * A model coilbox itself exported can be taken back apart into real parts, which
 * is `importS3o.ts` and is strictly better: the result is an ordinary unit with a
 * parts library and an atlas. Anything else keeps its meshes exactly as they are
 * and becomes a unit with no parts and no atlas, which is the ordinary case.
 * Recovery is tried first because it is a test the file either passes or fails
 * outright, so there is nothing to ask and nothing to get wrong.
 */

import { Button } from "@picoframe/frame";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { LegoAtlas } from "../../atlas";
import { legoImportS3o, legoReadS3o } from "../../bindings";
import {
  NOT_IN_AN_EXPORT,
  recoveredAtlas,
  recoverProject,
  type S3oRecovery,
} from "../../importS3o";
import {
  type LegoImportedGame,
  type LegoProject,
  normalisePieceName,
} from "../../model";
import { loadPack } from "../../pack";
import { projectFromImport, type RawImport } from "../../rawImport";

/** How far a read got, and what it turned into. */
export type ImportStage =
  | { state: "idle" }
  | { state: "reading" }
  | { state: "failed"; message: string }
  | {
      state: "recovered";
      recovery: S3oRecovery;
      /** The texture the file's header names, which may be anybody's. */
      texture: string;
      /** The installed atlas that texture is, if it is one of ours. */
      named: LegoAtlas | null;
      /** Every atlas installed, for confirming which one this unit samples. */
      atlases: LegoAtlas[];
      /** What the atlas picker should start on, or null for the base pack's. */
      atlas: string | null;
    }
  | {
      state: "imported";
      imported: RawImport;
      /** Why the file could not be taken apart into parts, which is the
       *  ordinary case and worth saying plainly. */
      refused: string;
    };

/** The file's own name, which is what an opened unit is called by default. */
export function baseName(path: string): string {
  const file = path.split(/[\\/]/).at(-1) ?? path;
  return file.replace(/\.s3o$/i, "");
}

/**
 * Read a model and turn it into either a recovered project or a raw import.
 *
 * `beforeImport` is the one hook a caller gets, and it exists for a model
 * unpacked out of a packed archive: the header names its textures, and they have
 * to be put beside the file before `lego_import_s3o` goes looking for them.
 * Nothing to do for a model read where it lives.
 */
export async function readModel(options: {
  path: string;
  /** What to call the unit. The file's own name when left out. */
  name?: string;
  /** The exported file's base name. Derived from {@link name} when left out. */
  unitName?: string;
  /** Where the unit records having come from. {@link path} when left out, which
   *  is wrong for a model unpacked out of an archive: that path is a temp file
   *  that says nothing about where the model lives. */
  source?: string;
  /** Recorded on the project when the model was picked out of a game. */
  game?: LegoImportedGame;
  /** Whether {@link path} is a copy unpacked into a temp folder rather than a
   *  file where it lives. The textures were unpacked beside it, so none of them
   *  is somewhere to refresh from either (#1903). */
  unpacked?: boolean;
  beforeImport?: (textures: string[]) => Promise<void>;
}): Promise<ImportStage> {
  const { path } = options;
  const [model, pack] = await Promise.all([legoReadS3o({ path }), loadPack()]);
  const name = options.name ?? baseName(path);
  const unitName = normalisePieceName(options.unitName ?? name);
  const recovery = recoverProject(model, pack, {
    name,
    unitName,
    now: new Date().toISOString(),
    newId: () => crypto.randomUUID(),
  });
  if (recovery.ok) {
    const atlases = pack.library.atlases;
    const named = recoveredAtlas(model.texture1, atlases);
    return {
      state: "recovered",
      recovery: recovery.recovery,
      texture: model.texture1,
      named,
      atlases,
      // The base pack's atlas is stored as no atlas at all, which is what a
      // unit built before atlas packs existed holds.
      atlas: named && named !== atlases[0] ? named.tex1 : null,
    };
  }

  await options.beforeImport?.([model.texture1, model.texture2]);

  // The id is settled before the import runs, because the geometry sidecar is
  // named after it and is written by the same call.
  const id = crypto.randomUUID();
  const result = await legoImportS3o({ path, id });
  return {
    state: "imported",
    refused: recovery.problem,
    imported: projectFromImport(result, {
      id,
      source: options.source ?? path,
      ...(options.game ? { game: options.game } : {}),
      ...(options.unpacked ? { unpacked: true } : {}),
      name,
      unitName,
      packId: pack.manifest.id,
      packVersion: pack.manifest.version,
      now: new Date().toISOString(),
      newId: () => crypto.randomUUID(),
    }),
  };
}

/** The project a finished stage produces, or null while there is not one yet. */
export function stageProject(stage: ImportStage): LegoProject | null {
  if (stage.state === "recovered") {
    return {
      ...stage.recovery.project,
      ...(stage.atlas ? { atlas: stage.atlas } : {}),
    };
  }
  if (stage.state === "imported") return stage.imported.project;
  return null;
}

/** What a read found, and what it means for editing the unit. */
export function ImportResult({
  stage,
  onAtlasChange,
  onAccept,
}: {
  stage: ImportStage;
  onAtlasChange: (atlas: string | null) => void;
  onAccept: () => void;
}) {
  if (stage.state === "reading") {
    return <p className="text-xs text-muted-foreground">Reading the model.</p>;
  }
  if (stage.state === "failed") {
    return <p className="text-xs text-destructive">{stage.message}</p>;
  }
  if (stage.state === "recovered") {
    return (
      <Recovered
        stage={stage}
        onAtlasChange={onAtlasChange}
        onAccept={onAccept}
      />
    );
  }
  if (stage.state === "imported") {
    return <Imported stage={stage} onAccept={onAccept} />;
  }
  return null;
}

function Recovered({
  stage,
  onAtlasChange,
  onAccept,
}: {
  stage: Extract<ImportStage, { state: "recovered" }>;
  onAtlasChange: (atlas: string | null) => void;
  onAccept: () => void;
}) {
  return (
    <>
      <div className="flex flex-col gap-2 border-t border-border/60 pt-4">
        <span className="text-sm font-medium">
          This unit came out of coilbox
        </span>
        <p className="text-xs text-muted-foreground">
          {stage.recovery.project.pieces.length} pieces.{" "}
          {stage.recovery.matched} made of parts, and {stage.recovery.empty}{" "}
          with no geometry, which is how a model carries hierarchy, flares and
          aim points.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">Atlas</span>
        <p className="text-xs text-muted-foreground">
          The model names <code>{stage.texture}</code>.{" "}
          {stage.named
            ? `That is the ${stage.named.packId} pack's atlas.`
            : "No installed pack ships that texture, so confirm which atlas this unit samples."}
        </p>
        {stage.atlases.length > 1 ? (
          <Select
            value={stage.atlas ?? stage.atlases[0].tex1}
            onValueChange={(value) =>
              onAtlasChange(value === stage.atlases[0].tex1 ? null : value)
            }
          >
            <SelectTrigger size="sm" aria-label="Atlas">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {stage.atlases.map((option) => (
                <SelectItem key={option.tex1} value={option.tex1}>
                  {option.packId}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">What does not come back</span>
        <p className="text-xs text-muted-foreground">
          A model holds piece names, the tree they hang in and where each one
          sits. Everything else the project had was never in the file.
        </p>
        <ul className="list-disc pl-4 text-xs text-muted-foreground">
          {NOT_IN_AN_EXPORT.map((lost) => (
            <li key={lost} className="mt-1">
              {lost}
            </li>
          ))}
        </ul>
      </div>

      <div className="border-t border-border/60 pt-4">
        <Button onClick={onAccept}>
          Recover {stage.recovery.project.name}
        </Button>
      </div>
    </>
  );
}

function Imported({
  stage,
  onAccept,
}: {
  stage: Extract<ImportStage, { state: "imported" }>;
  onAccept: () => void;
}) {
  const { project, meshes, vertices, triangles, converted, bytes } =
    stage.imported;
  const imported = project.imported;

  return (
    <>
      <div className="flex flex-col gap-2 border-t border-border/60 pt-4">
        <span className="text-sm font-medium">What came in</span>
        <p className="text-xs text-muted-foreground">
          {project.pieces.length} pieces, {meshes} of them with geometry.{" "}
          {vertices.toLocaleString()} vertices and {triangles.toLocaleString()}{" "}
          triangles, stored beside the unit as{" "}
          {Math.max(1, Math.round(bytes / 1024)).toLocaleString()} KiB.
        </p>
        {converted > 0 ? (
          <p className="text-xs text-muted-foreground">
            {converted} {converted === 1 ? "piece was" : "pieces were"} drawn as
            quads or a triangle strip and {converted === 1 ? "has" : "have"}{" "}
            been converted to triangles, which is what the engine does on load
            anyway.
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">Texture</span>
        {imported?.texture ? (
          <p className="text-xs text-muted-foreground">
            Drawn with <code>{imported.texture.name}</code>, copied into
            coilbox's own store so the unit keeps working if the game folder
            goes away. You can point it at a different file later
            {imported.texture.source
              ? ", or refresh it after editing it elsewhere."
              : ". There is no file behind this one to refresh from, because a packed archive holds no path to hand back."}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            {imported?.missingTexture
              ? `The model names ${imported.missingTexture}, and no such file was found beside it. The unit opens untextured, and you can point it at the file yourself.`
              : "The model names no texture, so the unit opens untextured."}
          </p>
        )}
        {imported?.texture2 ? (
          <p className="text-xs text-muted-foreground">
            <code>{imported.texture2.name}</code> is the shading map, which the
            engine reads as glow in red and shine in green. Kept with the unit
            and written back out by the export, though nothing here draws it.
          </p>
        ) : imported?.missingTexture2 ? (
          <p className="text-xs text-muted-foreground">
            The shading map, <code>{imported.missingTexture2}</code>, was not
            found. Nothing here draws it, so the unit looks the same either way,
            but the export will have no glow or shine to write out.
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">What you can do with it</span>
        <p className="text-xs text-muted-foreground">
          Move, turn, rename and reparent its pieces, animate it, give it a unit
          definition and a collision volume, and export it again.
        </p>
        <p className="text-xs text-muted-foreground">
          Not add lego parts to it. Its UV map points onto its own texture
          rather than onto the parts pack's sheet, so a part dropped in would
          sample the wrong image. The parts library and the atlas picker are
          hidden for this unit for that reason.
        </p>
        <p className="text-xs text-muted-foreground">
          It was not made here: {stage.refused}
        </p>
      </div>

      <div className="border-t border-border/60 pt-4">
        <Button onClick={onAccept}>Open {project.name}</Button>
      </div>
    </>
  );
}
