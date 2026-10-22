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

import { plural, t } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@picoframe/frame";
import { ChevronRight, Loader2 } from "lucide-react";
import type { ReactNode } from "react";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatNumber } from "@/lib/format";
import { basename } from "@/lib/helpers";
import { isAssimpModel } from "../../archiveOpen";
import type { LegoAtlas } from "../../atlas";
import {
  type DaeImport,
  type GlbImport,
  legoImport3do,
  legoImportDae,
  legoImportGlb,
  legoImportS3o,
  legoRead3do,
  legoReadDae,
  legoReadS3o,
  type ThreeDoImport,
} from "../../bindings";
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
       *  ordinary case and worth saying plainly. A whole sentence, because what
       *  makes an `.s3o` not one of ours is a different statement from what
       *  makes a `.3do` or a `.glb` not one. */
      refused: string;
      /** What a conversion had to do or could not do, for a `.3do` or a `.glb`.
       *  Empty for an `.s3o`, which is read rather than converted. */
      notes?: string[];
      /** More about the texture, under the texture heading. A `.glb` carries
       *  one picture where an `.s3o` names two, and what it does not carry is
       *  worth saying where somebody is reading about what it does. */
      textureNotes?: string[];
      /** Why the stored texture has no file behind it to refresh from, when the
       *  reason is not the usual one of a packed archive holding no path. */
      textureFrom?: string;
    };

/**
 * The file's own name, which is what an opened unit is called by default.
 * The last path segment (see `@/lib/basename`) with a trailing `.s3o` or `.glb`
 * stripped, since that's redundant on a name shown next to "Imported".
 */
function baseName(path: string): string {
  return basename(path).replace(/\.(s3o|glb)$/i, "");
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
  if (/\.3do$/i.test(path)) return readThreeDo(options);
  if (/\.glb$/i.test(path)) return readGlb(options);
  if (isAssimpModel(path)) return readDae(options);

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

  const { problem } = recovery;
  await options.beforeImport?.([model.texture1, model.texture2]);

  // The id is settled before the import runs, because the geometry sidecar is
  // named after it and is written by the same call.
  const id = crypto.randomUUID();
  const result = await legoImportS3o({ path, id });
  return {
    state: "imported",
    refused: t`It was not made here: ${problem}`,
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

/**
 * The same, for a `.3do`.
 *
 * Its own path because opening a `.3do` is a conversion rather than a read.
 * There is no recovery step: a `.3do` is the older format and coilbox has never
 * written one, so it can never be a coilbox export coming home. And the tiles
 * it names have to be looked up out of the model before they can be put beside
 * it, which is a different question from the one an `.s3o` header answers.
 */
async function readThreeDo(options: {
  path: string;
  name?: string;
  unitName?: string;
  source?: string;
  game?: LegoImportedGame;
  unpacked?: boolean;
  beforeImport?: (textures: string[]) => Promise<void>;
}): Promise<ImportStage> {
  const { path } = options;
  const [{ textures }, pack] = await Promise.all([
    legoRead3do({ path }),
    loadPack(),
  ]);
  await options.beforeImport?.(textures);

  const name = options.name ?? baseName(path);
  const unitName = normalisePieceName(options.unitName ?? name);
  const id = crypto.randomUUID();
  const result = await legoImport3do({ path, id });

  return {
    state: "imported",
    refused: t`It was not made here: This is a .3do, the older model format. Coilbox has never written one, so it cannot be a model coming home, and it has been converted instead.`,
    notes: conversionNotes(result),
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

/**
 * The same again, for a `.glb`.
 *
 * The way back from Blender, and the other end of `exportGlb.ts`. No recovery
 * step and no textures to put beside the file first: coilbox writes a `.glb` for
 * Blender and no Spring engine reads one, so it can never be a unit coming home
 * as parts, and a `.glb` carries its picture inside itself.
 *
 * Nothing here is `.glb` specific past the command it calls. What comes back is
 * the same shape an `.s3o` import gives, so the unit that opens is an ordinary
 * imported unit with a texture panel and no parts library.
 */
async function readGlb(options: {
  path: string;
  name?: string;
  unitName?: string;
  source?: string;
  game?: LegoImportedGame;
  unpacked?: boolean;
}): Promise<ImportStage> {
  const { path } = options;
  const pack = await loadPack();
  const name = options.name ?? baseName(path);
  const unitName = normalisePieceName(options.unitName ?? name);
  const id = crypto.randomUUID();
  const result = await legoImportGlb({ path, id });

  return {
    state: "imported",
    refused: t`A .glb is what coilbox writes for Blender, and no Spring engine reads one, so it is never a model coming home as parts. Its objects have been read as pieces exactly as they stand.`,
    notes: glbNotes(result),
    textureNotes: glbTextureNotes(result),
    textureFrom: t`It came out of the .glb itself rather than off a file, so there is nothing behind it to refresh from.`,
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

/**
 * The same again, for one of the formats the engine loads through Assimp.
 *
 * Nearest to the `.3do` path, because opening one is a conversion: there is no
 * recovery step, since coilbox has never written one of these and it can never
 * be a unit coming home. And the textures it names have to be found before the
 * import goes looking for them, which is what the probe is for. Where a `.3do`
 * names its tiles inside the model, a Collada file names its texture in a Lua
 * file beside it.
 */
async function readDae(options: {
  path: string;
  name?: string;
  unitName?: string;
  source?: string;
  game?: LegoImportedGame;
  unpacked?: boolean;
  beforeImport?: (textures: string[]) => Promise<void>;
}): Promise<ImportStage> {
  const { path } = options;
  const [{ textures }, pack] = await Promise.all([
    legoReadDae({ path }),
    loadPack(),
  ]);
  await options.beforeImport?.(textures);

  const name = options.name ?? baseName(path);
  const unitName = normalisePieceName(options.unitName ?? name);
  const id = crypto.randomUUID();
  const result = await legoImportDae({ path, id });

  return {
    state: "imported",
    refused: t`It was not made here: this is one of the formats the engine reads through Assimp, and coilbox has never written one, so it cannot be a unit coming home as parts. Its nodes have been read as pieces as they stand.`,
    notes: daeNotes(result),
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

/**
 * What reading one of the Assimp formats had to change.
 *
 * Each of these is a difference between what the format can hold and what a
 * Spring model can, and each would otherwise look like the import having
 * quietly lost something.
 */
function daeNotes(result: DaeImport): string[] {
  const notes: string[] = [];
  const { transformed, imagesUsed, droppedFaces } = result;
  if (transformed > 0) {
    notes.push(
      plural(transformed, {
        one: "# node carries a rotation or a scale, which an .s3o piece cannot, so it has been baked into the vertices. Blender writes its own up-axis turn that way, so a model exported from it reports at least one.",
        other:
          "# nodes carry a rotation or a scale, which an .s3o piece cannot, so they have been baked into the vertices. Blender writes its own up-axis turn that way, so a model exported from it reports at least one.",
      }),
    );
  }
  if (imagesUsed > 1) {
    notes.push(
      t`The file paints with ${imagesUsed} textures where a Spring unit has one, so the first was taken and the rest of the model draws with it.`,
    );
  }
  if (droppedFaces > 0) {
    notes.push(
      plural(droppedFaces, {
        one: "# face was a point or a line, which a Spring model has no way to hold, so it was left out.",
        other:
          "# faces were points or lines, which a Spring model has no way to hold, so they were left out.",
      }),
    );
  }
  return notes;
}

/**
 * What reading a `.glb` had to do, in the cases worth knowing about.
 *
 * A file that came through with nothing to say says nothing. Each of these is a
 * difference between what glTF can hold and what a Spring model can, and each
 * would otherwise look like the import losing something.
 */
function glbNotes(result: GlbImport): string[] {
  const notes: string[] = [];
  const { folded, transformed, flatShaded, skipped } = result;
  if (folded > 0) {
    notes.push(
      plural(folded, {
        one: "# piece came in as an empty holding a same-named mesh, the shape every .glb coilbox 1.12.0 or earlier wrote for a piece with geometry, so it has been folded back into one piece each. That is why the count below may read lower than Blender showed.",
        other:
          "# pieces came in as an empty holding a same-named mesh, the shape every .glb coilbox 1.12.0 or earlier wrote for a piece with geometry, so they have been folded back into one piece each. That is why the count below may read lower than Blender showed.",
      }),
    );
  }
  if (result.inventedRoot) {
    notes.push(
      t`The file had several objects at its top level and a Spring model has exactly one root piece, so a root has been added to hold them. Rename it to whatever the unit's script should call it.`,
    );
  }
  if (transformed > 0) {
    notes.push(
      plural(transformed, {
        one: "# object carries a rotation or a scale, which an .s3o piece cannot, so it has been baked into the vertices. That is what the export does on the way out anyway, and it is what Upspring does on save.",
        other:
          "# objects carry a rotation or a scale, which an .s3o piece cannot, so they have been baked into the vertices. That is what the export does on the way out anyway, and it is what Upspring does on save.",
      }),
    );
  }
  if (flatShaded > 0) {
    notes.push(
      plural(flatShaded, {
        one: "# mesh came with no normals, so they have been worked out from the faces. Fix them under Fix UVs and normals if the model lights oddly.",
        other:
          "# meshes came with no normals, so they have been worked out from the faces. Fix them under Fix UVs and normals if the model lights oddly.",
      }),
    );
  }
  if (skipped > 0) {
    notes.push(
      plural(skipped, {
        one: "# part of the file draws points or lines, which a Spring model has no way to hold, so it has been left out.",
        other:
          "# parts of the file draw points or lines, which a Spring model has no way to hold, so they have been left out.",
      }),
    );
  }
  return notes;
}

/**
 * What a `.glb` could not carry about the unit's textures.
 *
 * Both of these are losses that look fine here and wrong in the game, which is
 * exactly the kind worth spelling out at the moment somebody is deciding whether
 * to open the file.
 */
function glbTextureNotes(result: GlbImport): string[] {
  const notes: string[] = [];
  const { imagesUsed } = result;
  if (imagesUsed > 1) {
    notes.push(
      t`The file paints with ${imagesUsed} pictures and a Spring model has one texture, so the first was taken and the rest were left. Pieces mapped onto one of the others will draw the wrong thing.`,
    );
  }
  if (result.texture.key && !result.teamMask) {
    notes.push(
      t`Its picture is fully opaque. An .s3o reads that picture's alpha as the team-colour mask, and fully opaque means every pixel of the model is painted in the player's colour, so the alpha has been written to nothing instead: the model keeps its own colours and has no team-colour markings. The .glb export drops the mask on the way out, so this is what a coilbox model that has been to Blender and back looks like. Point the model at the game's own texture on the Texture tab to get the markings back.`,
    );
  }
  notes.push(
    t`A .glb has one picture where an .s3o has two. The second is the shading map, holding glow in red, shine in green and in alpha the cut-out that decides whether a pixel is drawn at all, and it is not in this file. The model opens without one.`,
  );
  return notes;
}

/**
 * What the conversion did, in the cases worth knowing about.
 *
 * A unit that converted cleanly says nothing, because there is nothing to
 * decide. The two that are worth saying are both about faces that came out
 * plain, and both would otherwise look like a bug in the model.
 */
function conversionNotes(result: ThreeDoImport): string[] {
  const notes: string[] = [];
  const { tiles, paletteFaces, droppedPieces, basePlateFaces } = result;
  const found = tiles - result.missingTextures.length;
  if (result.sheetReused) {
    notes.push(
      t`Its texture tiles are already on a sheet a batch conversion of this game left behind, and this model has been mapped onto that sheet rather than getting one of its own.`,
    );
  } else {
    notes.push(
      t`Its ${tiles} texture tiles have been packed into one sheet and every face given coordinates onto it, which is what makes it an ordinary model that exports as an .s3o.`,
    );
  }
  if (result.missingTextures.length > 0) {
    const missing = result.missingTextures.join(", ");
    notes.push(
      t`${found} of ${tiles} were found. Nothing in the game matched ${missing}, so the faces using them are drawn plain.`,
    );
  }
  if (paletteFaces > 0) {
    notes.push(
      plural(paletteFaces, {
        one: "# face names a Total Annihilation palette entry this import could not resolve to a colour, because there was no palette.pal beside the model or the entry is outside the 256 it holds, so it is drawn plain grey.",
        other:
          "# faces name a Total Annihilation palette entry this import could not resolve to a colour, because there was no palette.pal beside the model or the entry is outside the 256 it holds, so they are drawn plain grey.",
      }),
    );
  }
  if (droppedPieces > 0) {
    notes.push(
      plural(droppedPieces, {
        one: "# empty child piece shared an earlier sibling's name and drew nothing, so nothing could ever have addressed it by that name. It has been left out.",
        other:
          "# empty child pieces shared an earlier sibling's name and drew nothing, so nothing could ever have addressed them by that name. They have been left out.",
      }),
    );
  }
  if (basePlateFaces > 0) {
    notes.push(
      plural(basePlateFaces, {
        one: "# base-plate face, a flat panel some exporters left facing straight down to mark the selection box rather than real geometry, has been dropped.",
        other:
          "# base-plate faces, a flat panel some exporters left facing straight down to mark the selection box rather than real geometry, have been dropped.",
      }),
    );
  }
  return notes;
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
  children,
  pending,
}: {
  stage: ImportStage;
  onAtlasChange: (atlas: string | null) => void;
  onAccept: () => void;
  /** More about the unit, drawn above the button that opens it. */
  children?: ReactNode;
  /** Why the unit cannot be opened yet, shown on the button while it waits.
   *  Something still being read would be left off it otherwise. */
  pending?: string | null;
}) {
  const { t } = useLingui();
  if (stage.state === "reading") {
    return (
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" aria-hidden />
        <Trans>Reading the model.</Trans>
      </p>
    );
  }
  if (stage.state === "failed") {
    return <p className="text-xs text-destructive">{stage.message}</p>;
  }
  if (stage.state !== "recovered" && stage.state !== "imported") return null;

  const name =
    stage.state === "recovered"
      ? stage.recovery.project.name
      : stage.imported.project.name;
  return (
    <>
      {stage.state === "recovered" ? (
        <Recovered stage={stage} onAtlasChange={onAtlasChange} />
      ) : (
        <Imported stage={stage} />
      )}
      {children}
      <div className="border-t border-border/60 pt-4">
        <Button onClick={onAccept} disabled={Boolean(pending)}>
          {pending ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden />
              {pending}
            </>
          ) : stage.state === "recovered" ? (
            t`Recover ${name}`
          ) : (
            t`Open ${name}`
          )}
        </Button>
      </div>
    </>
  );
}

function Recovered({
  stage,
  onAtlasChange,
}: {
  stage: Extract<ImportStage, { state: "recovered" }>;
  onAtlasChange: (atlas: string | null) => void;
}) {
  const { t } = useLingui();
  const pieceCount = stage.recovery.project.pieces.length;
  const { matched, empty } = stage.recovery;
  const { texture } = stage;
  const packId = stage.named?.packId;
  return (
    <>
      <div className="flex flex-col gap-2 border-t border-border/60 pt-4">
        <span className="text-sm font-medium">
          <Trans>This model came out of coilbox</Trans>
        </span>
        <p className="text-xs text-muted-foreground">
          {plural(pieceCount, { one: "# piece.", other: "# pieces." })}{" "}
          <Trans>
            {matched} made of parts, and {empty} with no geometry, which is how
            a model carries hierarchy, flares and aim points.
          </Trans>
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">
          <Trans>Atlas</Trans>
        </span>
        <p className="text-xs text-muted-foreground">
          <Trans>
            The model names <code>{texture}</code>.
          </Trans>{" "}
          {stage.named ? (
            <Trans>That is the {packId} pack's atlas.</Trans>
          ) : (
            <Trans>
              No installed pack ships that texture, so confirm which atlas this
              model samples.
            </Trans>
          )}
        </p>
        {stage.atlases.length > 1 ? (
          <Select
            value={stage.atlas ?? stage.atlases[0].tex1}
            onValueChange={(value) =>
              onAtlasChange(value === stage.atlases[0].tex1 ? null : value)
            }
          >
            <SelectTrigger size="sm" aria-label={t`Atlas`}>
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
        <span className="text-sm font-medium">
          <Trans>What does not come back</Trans>
        </span>
        <p className="text-xs text-muted-foreground">
          <Trans>
            A model holds piece names, the tree they hang in and where each one
            sits. Everything else the project had was never in the file.
          </Trans>
        </p>
        <ul className="list-disc pl-4 text-xs text-muted-foreground">
          {NOT_IN_AN_EXPORT.map((lost) => (
            <li key={lost} className="mt-1">
              {lost}
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}

/**
 * A model opened as its own geometry: the few facts somebody opening it needs
 * up front, and everything else folded away under the details.
 *
 * A missing texture stays up front. It changes what the unit looks like the
 * moment it opens, which is not a detail.
 */
function Imported({
  stage,
}: {
  stage: Extract<ImportStage, { state: "imported" }>;
}) {
  const { project, meshes, vertices, triangles, converted, bytes } =
    stage.imported;
  const imported = project.imported;
  const missingTexture = imported?.missingTexture;
  const pieceCount = project.pieces.length;

  const triangleCount = formatNumber(triangles);
  const vertexCount = formatNumber(vertices);
  const kibibytes = formatNumber(Math.max(1, Math.round(bytes / 1024)));

  const details: string[] = [...(stage.notes ?? [])];
  if (converted > 0) {
    details.push(
      plural(converted, {
        one: "# piece was drawn as quads or a triangle strip and has been converted to triangles, which is what the engine does on load anyway.",
        other:
          "# pieces were drawn as quads or a triangle strip and have been converted to triangles, which is what the engine does on load anyway.",
      }),
    );
  }
  if (imported?.texture) {
    const textureName = imported.texture.name;
    details.push(
      imported.texture.source
        ? t`${textureName} was copied into coilbox's own store, so the unit keeps working if the game folder goes away. It can be refreshed after editing it elsewhere.`
        : [
            t`${textureName} was copied into coilbox's own store, so the unit keeps working if the game folder goes away.`,
            stage.textureFrom ??
              t`There is no file behind it to refresh from, because a packed archive holds no path to hand back.`,
          ].join(" "),
    );
  }
  if (imported?.texture2) {
    const shadingMap = imported.texture2.name;
    details.push(
      t`${shadingMap} is the shading map, which the engine reads as glow in red and shine in green. It is kept with the unit and written back out by the export, though nothing here draws it.`,
    );
  } else if (imported?.missingTexture2) {
    const shadingMap = imported.missingTexture2;
    details.push(
      t`The shading map, ${shadingMap}, was not found. The unit looks the same here either way, but the export will have no glow or shine to write out.`,
    );
  }
  details.push(...(stage.textureNotes ?? []));
  details.push(stage.refused);

  return (
    <section className="flex flex-col gap-2 border-t border-border/60 pt-4">
      <h3 className="text-sm font-medium">
        <Trans>Model</Trans>
      </h3>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
        <dt className="text-muted-foreground">
          <Trans>Pieces</Trans>
        </dt>
        <dd>
          <Trans>
            {pieceCount}, {meshes} with geometry
          </Trans>
        </dd>
        <dt className="text-muted-foreground">
          <Trans>Size</Trans>
        </dt>
        <dd>
          <Trans>
            {triangleCount} triangles, {vertexCount} vertices, {kibibytes} KiB
          </Trans>
        </dd>
        <dt className="text-muted-foreground">
          <Trans>Texture</Trans>
        </dt>
        <dd className="min-w-0">
          {imported?.texture ? (
            <code className="break-all">{imported.texture.name}</code>
          ) : imported?.missingTexture ? (
            <span className="text-amber-500">
              <Trans>
                <code className="break-all">{missingTexture}</code> was not
                found, so it opens untextured
              </Trans>
            </span>
          ) : (
            <span className="text-muted-foreground">
              <Trans>None named, so it opens untextured</Trans>
            </span>
          )}
        </dd>
      </dl>
      <Collapsible>
        <CollapsibleTrigger className="group flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <ChevronRight
            className="size-3.5 transition-transform group-data-[state=open]:rotate-90"
            aria-hidden
          />
          <Trans>Import details</Trans>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <ul className="mt-2 flex list-disc flex-col gap-1 pl-4 text-xs text-muted-foreground">
            {details.map((detail) => (
              <li key={detail}>{detail}</li>
            ))}
          </ul>
        </CollapsibleContent>
      </Collapsible>
    </section>
  );
}
