/**
 * Open somebody else's `.s3o` by pointing at the file.
 *
 * The oldest way in and still the only one that reaches a model outside a game
 * coilbox can see: a loose export, a file somebody sent you, a model half way
 * out of a modelling tool. {@link GameModelDrawer} is the other way, for a model
 * that is inside a game, where a path is the wrong thing to be asked for.
 *
 * What a read turns into, and how it is reported, is `ImportResult.tsx` and is
 * the same for both.
 */

import { Button } from "@picoframe/frame";
import { open } from "@tauri-apps/plugin-dialog";
import { FileUp, X } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { useState } from "react";

import type { LegoProject } from "../../model";
import {
  ImportResult,
  type ImportStage,
  readModel,
  stageProject,
} from "./ImportResult";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The unit, for the page to save and open. Its geometry sidecar and its
   *  textures are already on disk by the time this fires. */
  onOpened: (project: LegoProject) => void;
}

export function ImportDrawer({ open: isOpen, onOpenChange, onOpened }: Props) {
  const [stage, setStage] = useState<ImportStage>({ state: "idle" });

  async function choose() {
    const picked = await open({
      multiple: false,
      title: "Choose a model",
      filters: [{ name: "Spring model", extensions: ["s3o"] }],
    });
    if (typeof picked !== "string") return;

    setStage({ state: "reading" });
    try {
      setStage(await readModel({ path: picked }));
    } catch (error) {
      setStage({
        state: "failed",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  function accept() {
    const project = stageProject(stage);
    if (project) onOpened(project);
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

            <ImportResult
              stage={stage}
              onAtlasChange={(atlas) =>
                setStage((current) =>
                  current.state === "recovered"
                    ? { ...current, atlas }
                    : current,
                )
              }
              onAccept={accept}
            />
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
