/**
 * Write a unit out as an s3o.
 *
 * The destination is a game folder, chosen once and remembered on the project,
 * so exporting again after a change is one click. The model lands in
 * `objects3d/` and the pack's atlas, if asked for, in `unittextures/`.
 *
 * The atlas is shared. Every unit built from a pack names the same texture
 * file, so five units need one PNG installed, not five.
 */

import { Button } from "@picoframe/frame";
import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpen, X } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { useState } from "react";

import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { legoExport, legoOpenPath } from "../../bindings";
import type { LegoProject } from "../../model";
import type { LoadedPack } from "../../pack";
import { buildS3o } from "../../s3oBuild";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: LegoProject;
  pack: LoadedPack;
  /** Remembered on the document, so the next export does not ask again. */
  onRemember: (settings: { exportDir: string; exportTexture: boolean }) => void;
}

type Result =
  | { state: "idle" }
  | { state: "working" }
  | { state: "done"; model: string; texture: string | null }
  | { state: "failed"; message: string };

export function ExportDrawer({
  open: isOpen,
  onOpenChange,
  project,
  pack,
  onRemember,
}: Props) {
  const [dir, setDir] = useState(project.exportDir ?? "");
  const [withTexture, setWithTexture] = useState(
    project.exportTexture !== false,
  );
  const [result, setResult] = useState<Result>({ state: "idle" });

  const atlas = pack.manifest.textures.tex1;

  async function chooseFolder() {
    const picked = await open({
      directory: true,
      multiple: false,
      title: "Choose the game folder to export into",
    });
    if (typeof picked !== "string") return;
    setDir(picked);
    setResult({ state: "idle" });
  }

  async function runExport() {
    // The s3o header names the atlas whether or not this export copies it, so a
    // unit exported without the texture still finds one already installed.
    const model = buildS3o(project, pack, { texture1: atlas });
    if (!model) {
      setResult({ state: "failed", message: "This unit has no root piece." });
      return;
    }
    setResult({ state: "working" });
    try {
      const written = await legoExport({
        dir,
        unitName: project.unitName,
        atlas: withTexture ? atlas : null,
        model,
      });
      onRemember({ exportDir: dir, exportTexture: withTexture });
      setResult({ state: "done", ...written });
    } catch (error) {
      setResult({
        state: "failed",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return (
    <DialogPrimitive.Root open={isOpen} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/55 backdrop-blur-[1px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content className="fixed inset-y-0 right-0 z-50 flex w-[460px] max-w-[92vw] flex-col border-l border-border bg-background shadow-xl duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right">
          <div className="flex items-center justify-between border-b border-border/60 px-5 py-4">
            <DialogPrimitive.Title className="text-base font-semibold">
              Export {project.unitName}
            </DialogPrimitive.Title>
            <DialogPrimitive.Close asChild>
              <Button variant="ghost" size="icon" aria-label="Close">
                <X className="size-4" />
              </Button>
            </DialogPrimitive.Close>
          </div>

          <div className="flex flex-col gap-5 overflow-y-auto px-5 py-4">
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium">Game folder</span>
              <p className="text-xs text-muted-foreground">
                The folder holding <code>objects3d</code> and{" "}
                <code>unittextures</code>. For a game you are working on, that
                is the <code>.sdd</code> directory.
              </p>
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate rounded border border-border px-2 py-1 text-xs">
                  {dir || "Nothing chosen"}
                </span>
                <Button variant="outline" size="sm" onClick={chooseFolder}>
                  <FolderOpen className="size-4" /> Choose
                </Button>
              </div>
            </div>

            <div className="flex items-start gap-2">
              <Checkbox
                id="lego-export-texture"
                checked={withTexture}
                onCheckedChange={(checked) => setWithTexture(checked === true)}
                className="mt-0.5"
              />
              <div>
                <Label htmlFor="lego-export-texture">
                  Also place the texture
                </Label>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Copies <code>{atlas}</code> into <code>unittextures</code>.
                  Every unit built from this pack uses it, so this only needs
                  doing once per game.
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-2 border-t border-border/60 pt-4">
              <Button
                onClick={() => void runExport()}
                disabled={!dir || result.state === "working"}
              >
                {result.state === "working" ? "Exporting" : "Export"}
              </Button>
            </div>

            {result.state === "done" ? (
              <div className="flex flex-col gap-2 text-xs">
                <p className="text-muted-foreground">Written:</p>
                <code className="break-all">{result.model}</code>
                {result.texture ? (
                  <code className="break-all">{result.texture}</code>
                ) : null}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void legoOpenPath({ path: result.model })}
                >
                  Show me
                </Button>
              </div>
            ) : null}

            {result.state === "failed" ? (
              <p className="text-xs text-destructive">{result.message}</p>
            ) : null}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
