/**
 * Open somebody else's `.s3o` and edit it as raw geometry.
 *
 * Two things can be done with an `.s3o`, and this tries both in order. A model
 * coilbox itself exported can be taken back apart into real parts, which is
 * `importS3o.ts` and is strictly better: the result is an ordinary unit with a
 * parts library and an atlas. Anything else keeps its meshes exactly as they
 * are and becomes a unit with no parts and no atlas, which is what this is
 * mostly for.
 *
 * Trying recovery first is what makes one button enough. Recovering is a test
 * the file either passes or fails outright, since either every piece is made of
 * parts or none are, so there is nothing to ask and nothing to get wrong. A
 * file that fails it is imported raw, and the drawer says which of the two
 * happened rather than leaving it to be guessed at.
 */

import { Button } from "@picoframe/frame";
import { open } from "@tauri-apps/plugin-dialog";
import { FileUp, X } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { useState } from "react";

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
import { type LegoProject, normalisePieceName } from "../../model";
import { loadPack } from "../../pack";
import { projectFromImport, type RawImport } from "../../rawImport";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The unit, for the page to save and open. Its geometry sidecar and its
   *  textures are already on disk by the time this fires. */
  onOpened: (project: LegoProject) => void;
}

type Stage =
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
    }
  | {
      state: "imported";
      imported: RawImport;
      /** Why the file could not be taken apart into parts, which is the
       *  ordinary case and worth saying plainly. */
      refused: string;
    };

/** The file's own name, which is what the opened unit is called. */
function baseName(path: string): string {
  const file = path.split(/[\\/]/).at(-1) ?? path;
  return file.replace(/\.s3o$/i, "");
}

export function ImportDrawer({ open: isOpen, onOpenChange, onOpened }: Props) {
  const [stage, setStage] = useState<Stage>({ state: "idle" });
  const [atlas, setAtlas] = useState<string | null>(null);

  async function choose() {
    const picked = await open({
      multiple: false,
      title: "Choose a model",
      filters: [{ name: "Spring model", extensions: ["s3o"] }],
    });
    if (typeof picked !== "string") return;

    setStage({ state: "reading" });
    try {
      const [model, pack] = await Promise.all([
        legoReadS3o({ path: picked }),
        loadPack(),
      ]);
      const unit = baseName(picked);
      const recovery = recoverProject(model, pack, {
        name: unit,
        unitName: normalisePieceName(unit),
        now: new Date().toISOString(),
        newId: () => crypto.randomUUID(),
      });
      if (recovery.ok) {
        const atlases = pack.library.atlases;
        const named = recoveredAtlas(model.texture1, atlases);
        // The base pack's atlas is stored as no atlas at all, which is what a
        // unit built before atlas packs existed holds.
        setAtlas(named && named !== atlases[0] ? named.tex1 : null);
        setStage({
          state: "recovered",
          recovery: recovery.recovery,
          texture: model.texture1,
          named,
          atlases,
        });
        return;
      }

      // The id is settled before the import runs, because the geometry sidecar
      // is named after it and is written by the same call.
      const id = crypto.randomUUID();
      const result = await legoImportS3o({ path: picked, id });
      setStage({
        state: "imported",
        refused: recovery.problem,
        imported: projectFromImport(result, {
          id,
          source: picked,
          name: unit,
          unitName: normalisePieceName(unit),
          packId: pack.manifest.id,
          packVersion: pack.manifest.version,
          now: new Date().toISOString(),
          newId: () => crypto.randomUUID(),
        }),
      });
    } catch (error) {
      setStage({
        state: "failed",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  function accept() {
    if (stage.state === "recovered") {
      onOpened({
        ...stage.recovery.project,
        ...(atlas ? { atlas } : {}),
      });
    } else if (stage.state === "imported") {
      onOpened(stage.imported.project);
    }
  }

  return (
    <DialogPrimitive.Root open={isOpen} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/55 backdrop-blur-[1px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content className="fixed inset-y-0 right-0 z-50 flex w-[460px] max-w-[92vw] flex-col border-l border-border bg-background shadow-xl duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right">
          <div className="flex items-center justify-between border-b border-border/60 px-5 py-4">
            <DialogPrimitive.Title className="text-base font-semibold">
              Open a model
            </DialogPrimitive.Title>
            <DialogPrimitive.Close asChild>
              <Button variant="ghost" size="icon" aria-label="Close">
                <X className="size-4" />
              </Button>
            </DialogPrimitive.Close>
          </div>

          <div className="flex flex-col gap-5 overflow-y-auto px-5 py-4">
            <div className="flex flex-col gap-2">
              <p className="text-xs text-muted-foreground">
                Any <code>.s3o</code>. One this builder exported comes back as
                the project it was exported from, with its parts and its atlas.
                Any other model keeps its meshes as they are and opens as a unit
                with no parts, drawn with its own texture.
              </p>
              <Button variant="outline" size="sm" onClick={() => void choose()}>
                <FileUp className="size-4" /> Choose a model
              </Button>
            </div>

            {stage.state === "reading" ? (
              <p className="text-xs text-muted-foreground">
                Reading the model.
              </p>
            ) : null}

            {stage.state === "failed" ? (
              <p className="text-xs text-destructive">{stage.message}</p>
            ) : null}

            {stage.state === "recovered" ? (
              <>
                <div className="flex flex-col gap-2 border-t border-border/60 pt-4">
                  <span className="text-sm font-medium">
                    This unit came out of coilbox
                  </span>
                  <p className="text-xs text-muted-foreground">
                    {stage.recovery.project.pieces.length} pieces.{" "}
                    {stage.recovery.matched} made of parts, and{" "}
                    {stage.recovery.empty} with no geometry, which is how a
                    model carries hierarchy, flares and aim points.
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
                      value={atlas ?? stage.atlases[0].tex1}
                      onValueChange={(value) =>
                        setAtlas(value === stage.atlases[0].tex1 ? null : value)
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
                  <span className="text-sm font-medium">
                    What does not come back
                  </span>
                  <p className="text-xs text-muted-foreground">
                    A model holds piece names, the tree they hang in and where
                    each one sits. Everything else the project had was never in
                    the file.
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
                  <Button onClick={accept}>
                    Recover {stage.recovery.project.name}
                  </Button>
                </div>
              </>
            ) : null}

            {stage.state === "imported" ? (
              <Imported stage={stage} onAccept={accept} />
            ) : null}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** What a raw import found, and what it means for editing the unit. */
function Imported({
  stage,
  onAccept,
}: {
  stage: { state: "imported"; imported: RawImport; refused: string };
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
            goes away. You can point it at a different file later, or refresh it
            after editing it elsewhere.
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            {imported?.missingTexture
              ? `The model names ${imported.missingTexture}, and no such file was found beside it. The unit opens untextured, and you can point it at the file yourself.`
              : "The model names no texture, so the unit opens untextured."}
          </p>
        )}
        {imported?.teamMask ? (
          <p className="text-xs text-muted-foreground">
            <code>{imported.teamMask.name}</code> is the team-colour mask, which
            marks the regions the engine paints in the player's colour.
          </p>
        ) : imported?.missingTeamMask ? (
          <p className="text-xs text-muted-foreground">
            The team-colour mask, <code>{imported.missingTeamMask}</code>, was
            not found. Without it the regions it marks show black, since that is
            what they are in the texture above.
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
