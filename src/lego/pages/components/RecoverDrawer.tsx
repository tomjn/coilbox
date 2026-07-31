/**
 * Get a project back from a unit coilbox exported.
 *
 * Framed as recovering a lost project rather than importing a model, because
 * that is what it reliably is: an `.s3o` whose geometry did not come out of the
 * parts pack cannot be turned into pieces at all, so this only ever opens a
 * file coilbox itself wrote. `importS3o.ts` has the reasoning and does the work.
 *
 * The two things the file cannot answer are asked here. Which atlas the unit
 * samples, because the header names a texture and a texture can be renamed, and
 * whether losing everything a baked model does not carry is acceptable, which
 * is why that list is on screen before the button rather than after it.
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
import { legoReadS3o } from "../../bindings";
import {
  NOT_IN_AN_EXPORT,
  recoveredAtlas,
  recoverProject,
  type S3oRecovery,
} from "../../importS3o";
import { type LegoProject, normalisePieceName } from "../../model";
import { loadPack } from "../../pack";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The rebuilt unit, for the page to save and open. */
  onRecovered: (project: LegoProject) => void;
}

type Stage =
  | { state: "idle" }
  | { state: "reading" }
  | { state: "failed"; message: string }
  | {
      state: "ready";
      recovery: S3oRecovery;
      /** The texture the file's header names, which may be anybody's. */
      texture: string;
      /** The installed atlas that texture is, if it is one of ours. */
      named: LegoAtlas | null;
      /** Every atlas installed, for confirming which one this unit samples. */
      atlases: LegoAtlas[];
    };

/** The file's own name, which is what the recovered unit is called. */
function baseName(path: string): string {
  const file = path.split(/[\\/]/).at(-1) ?? path;
  return file.replace(/\.s3o$/i, "");
}

export function RecoverDrawer({
  open: isOpen,
  onOpenChange,
  onRecovered,
}: Props) {
  const [stage, setStage] = useState<Stage>({ state: "idle" });
  const [atlas, setAtlas] = useState<string | null>(null);

  async function choose() {
    const picked = await open({
      multiple: false,
      title: "Choose an exported unit",
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
      const result = recoverProject(model, pack, {
        name: unit,
        unitName: normalisePieceName(unit),
        now: new Date().toISOString(),
        newId: () => crypto.randomUUID(),
      });
      if (!result.ok) {
        setStage({ state: "failed", message: result.problem });
        return;
      }
      const atlases = pack.library.atlases;
      const named = recoveredAtlas(model.texture1, atlases);
      // The base pack's atlas is stored as no atlas at all, which is what a
      // unit built before atlas packs existed holds.
      setAtlas(named && named !== atlases[0] ? named.tex1 : null);
      setStage({
        state: "ready",
        recovery: result.recovery,
        texture: model.texture1,
        named,
        atlases,
      });
    } catch (error) {
      setStage({
        state: "failed",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  function recover() {
    if (stage.state !== "ready") return;
    onRecovered({
      ...stage.recovery.project,
      ...(atlas ? { atlas } : {}),
    });
  }

  return (
    <DialogPrimitive.Root open={isOpen} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/55 backdrop-blur-[1px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content className="fixed inset-y-0 right-0 z-50 flex w-[460px] max-w-[92vw] flex-col border-l border-border bg-background shadow-xl duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right">
          <div className="flex items-center justify-between border-b border-border/60 px-5 py-4">
            <DialogPrimitive.Title className="text-base font-semibold">
              Recover a unit
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
                Open an <code>.s3o</code> this builder exported and get the
                project back. Only a model built from the parts library can be
                taken apart again, so a unit modelled elsewhere is refused
                rather than half read.
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

            {stage.state === "ready" ? (
              <>
                <div className="flex flex-col gap-2 border-t border-border/60 pt-4">
                  <span className="text-sm font-medium">What came back</span>
                  <p className="text-xs text-muted-foreground">
                    {stage.recovery.project.pieces.length} pieces.{" "}
                    {stage.recovery.matched} made of parts, and{" "}
                    {stage.recovery.empty} with no geometry, which is how a
                    model carries hierarchy, flares and aim points.
                  </p>
                </div>

                <div className="flex flex-col gap-2">
                  <span className="text-sm font-medium">Texture</span>
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
                  <Button onClick={recover}>
                    Recover {stage.recovery.project.name}
                  </Button>
                </div>
              </>
            ) : null}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
