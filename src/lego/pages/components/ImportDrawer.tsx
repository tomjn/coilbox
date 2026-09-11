/**
 * Open somebody else's model by pointing at the file.
 *
 * The oldest way in and still the only one that reaches a model outside a game
 * coilbox can see: a loose export, a file somebody sent you, a model half way
 * out of a modelling tool, a `.glb` on its way back from Blender.
 * {@link GameModelDrawer} is the other way, for a model that is inside a game,
 * where a path is the wrong thing to be asked for.
 *
 * Asking is the whole of the first step, so the file picker opens the moment
 * this is opened and the drawer itself stays out of the way until there is a
 * read to report. A panel whose only control was a button that opened the
 * picker was a click in front of the picker and nothing else.
 *
 * What a read turns into, and how it is reported, is `ImportResult.tsx` and is
 * the same for both.
 */

import { Button } from "@picoframe/frame";
import { open } from "@tauri-apps/plugin-dialog";
import { X } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { useEffect, useState } from "react";

import { BUILDER_MODEL_EXTS } from "../../archiveOpen";
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
  /** The model, for the page to save and open. Its geometry sidecar and its
   *  textures are already on disk by the time this fires. */
  onOpened: (project: LegoProject) => void;
}

export function ImportDrawer({ open: isOpen, onOpenChange, onOpened }: Props) {
  const [stage, setStage] = useState<ImportStage>({ state: "idle" });

  // Opening is the ask, so the picker goes up straight away. Closing forgets
  // the last read, so opening again starts from nothing rather than showing
  // the file before it.
  useEffect(() => {
    setStage({ state: "idle" });
    if (!isOpen) return;

    let live = true;
    void (async () => {
      const picked = await open({
        multiple: false,
        title: "Choose a model",
        // `.glb` on the end rather than in the shared list: the builder opens
        // one picked by hand, as the way back from Blender, but no game ships
        // one for the engine to draw, so the game picker never offers it.
        filters: [
          { name: "Model", extensions: [...BUILDER_MODEL_EXTS, "glb"] },
        ],
      });
      if (!live) return;
      // Nothing was chosen, so there is nothing to report and no reason to
      // leave an empty drawer standing open behind the picker.
      if (typeof picked !== "string") {
        onOpenChange(false);
        return;
      }

      setStage({ state: "reading" });
      try {
        const read = await readModel({ path: picked });
        if (live) setStage(read);
      } catch (error) {
        if (!live) return;
        setStage({
          state: "failed",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    })();
    return () => {
      live = false;
    };
  }, [isOpen, onOpenChange]);

  function accept() {
    const project = stageProject(stage);
    if (project) onOpened(project);
  }

  return (
    // Not while the picker is still up: there would be nothing in it yet.
    <DialogPrimitive.Root
      open={isOpen && stage.state !== "idle"}
      onOpenChange={onOpenChange}
    >
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
