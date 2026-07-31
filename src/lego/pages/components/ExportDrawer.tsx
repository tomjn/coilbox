/**
 * Write a unit out as an s3o.
 *
 * The destination is a game folder, chosen once and remembered on the project,
 * so exporting again after a change is one click. The model in `objects3d/` is
 * rewritten every export, since the builder alone owns it. The atlas, the unit
 * script and the unit definition are different. Each is written once and then
 * left alone, so hand edits to any of them survive a re-export. The atlas and
 * the script are checkboxes, since a game may already have either. The unit
 * definition always goes to `units/`, since without one the engine has nothing
 * to spawn.
 *
 * Exactly one atlas is written, the unit's own, because that is all an s3o can
 * name. Units sharing an atlas share the one PNG, so five units in one atlas
 * need one file installed, not five. It goes in under the name
 * `exportTextureName` gives it, prefixed so it does not collide with a file the
 * game already has, and left alone once written like the rest.
 *
 * A unit imported from somebody else's model has no atlas. It draws with its
 * own two textures, which go in under the names the model already gives them,
 * because those are the game's own file names rather than a pack's generic
 * one. The Blender files are not offered for such a unit: they embed a texture
 * a browser has to rasterise, and an imported one is usually a compressed DDS.
 * See https://github.com/tomjn/coilbox/issues/712.
 */

import { Button } from "@picoframe/frame";
import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpen, X } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { useState } from "react";

import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { exportTextureName, unitAtlas } from "../../atlas";
import {
  legoExport,
  legoExportGlb,
  legoExportObj,
  legoOpenPath,
} from "../../bindings";
import { exportGlb } from "../../exportGlb";
import { buildObj } from "../../exportObj";
import { unitScript } from "../../luaScript";
import type { LegoProject } from "../../model";
import type { LoadedPack } from "../../pack";
import type { RawGeometry } from "../../rawGeometry";
import { importedTextures } from "../../rawImport";
import { buildS3o } from "../../s3oBuild";
import { buildUnitDef } from "../../unitDef";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: LegoProject;
  pack: LoadedPack;
  /** The meshes of a unit imported from somebody else's model, if it is one. */
  raw: RawGeometry | null;
  /** Remembered on the document, so the next export does not ask again. */
  onRemember: (settings: {
    exportDir: string;
    exportTexture: boolean;
    exportScript: boolean;
    exportGlb: boolean;
    exportObj: boolean;
  }) => void;
}

type Result =
  | { state: "idle" }
  | { state: "working" }
  | {
      state: "done";
      model: string;
      texture: string | null;
      textureKept: boolean;
      textures: string[];
      texturesKept: string[];
      script: string | null;
      scriptKept: boolean;
      unitDef: string | null;
      unitDefKept: boolean;
      glb: string | null;
      obj: string | null;
      mtl: string | null;
    }
  | { state: "failed"; message: string };

export function ExportDrawer({
  open: isOpen,
  onOpenChange,
  project,
  pack,
  raw,
  onRemember,
}: Props) {
  const [dir, setDir] = useState(project.exportDir ?? "");
  const [withTexture, setWithTexture] = useState(
    project.exportTexture !== false,
  );
  const [withScript, setWithScript] = useState(project.exportScript !== false);
  const [withGlb, setWithGlb] = useState(project.exportGlb === true);
  const [withObj, setWithObj] = useState(project.exportObj === true);
  const [result, setResult] = useState<Result>({ state: "idle" });

  // Whichever atlas the unit samples, installed or not. The s3o names it
  // either way, so an atlas installed later puts a re-export right without the
  // unit having to change.
  // A unit imported from somebody else's model draws with its own textures out
  // of the store, and none of the atlas below applies to it.
  const imported = project.imported ? importedTextures(project.imported) : null;
  const unit = unitAtlas(project, pack.library.atlases);
  const atlas = unit.texture;
  // What the atlas is called once written, which is what the s3o names and
  // what a game folder ends up holding. Never the pack's own name for it: that
  // is generic enough to land on a file the game already has.
  const atlasFile = exportTextureName(atlas);
  // Everything that needs the atlas file itself, rather than only its name,
  // needs it to actually be installed.
  const installed = unit.installed;

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
    const model = buildS3o(project, pack, raw, {
      texture1: imported ? imported.texture1 : atlasFile,
      texture2: imported?.texture2,
    });
    if (!model) {
      setResult({ state: "failed", message: "This unit has no root piece." });
      return;
    }
    setResult({ state: "working" });
    try {
      const written = await legoExport({
        dir,
        unitName: project.unitName,
        textures: withTexture
          ? {
              atlas:
                !imported && installed
                  ? { name: atlas, pack: installed.folder, writeAs: atlasFile }
                  : null,
              stored: imported ? imported.place : [],
            }
          : null,
        script: withScript ? unitScript(project) : null,
        // Unlike the atlas and the script, there is no scenario where a
        // built unit should export without one: with no unit definition the
        // engine has nothing to spawn.
        unitDef: buildUnitDef(project, model),
        model,
      });

      let glbPath: string | null = null;
      if (withGlb && installed && !imported) {
        const bytes = await exportGlb(project, pack, raw, installed);
        if (bytes) {
          const glbWritten = await legoExportGlb({
            dir,
            unitName: project.unitName,
            bytes: Array.from(new Uint8Array(bytes)),
          });
          glbPath = glbWritten.path;
        }
      }

      let objPath: string | null = null;
      let mtlPath: string | null = null;
      if (withObj && installed && !imported) {
        const objBuild = buildObj(project, pack, raw, {
          unitName: project.unitName,
          textureName: atlasFile,
        });
        if (objBuild) {
          const objWritten = await legoExportObj({
            dir,
            unitName: project.unitName,
            obj: objBuild.obj,
            mtl: objBuild.mtl,
            atlas: { name: atlas, pack: installed.folder, writeAs: atlasFile },
          });
          objPath = objWritten.obj;
          mtlPath = objWritten.mtl;
        }
      }

      onRemember({
        exportDir: dir,
        exportTexture: withTexture,
        exportScript: withScript,
        exportGlb: withGlb,
        exportObj: withObj,
      });
      setResult({
        state: "done",
        ...written,
        glb: glbPath,
        obj: objPath,
        mtl: mtlPath,
      });
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

            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium">Unit definition</span>
              <p className="text-xs text-muted-foreground">
                Export always writes <code>{project.unitName}.lua</code> to{" "}
                <code>units</code>, the definition the engine spawns from. There
                is no checkbox for it: without one, the engine has nothing to
                give a model to. It is written once and then left alone, so hand
                edits survive a re-export.
              </p>
            </div>

            <div className="flex items-start gap-2">
              <Checkbox
                id="lego-export-script"
                checked={withScript}
                onCheckedChange={(checked) => setWithScript(checked === true)}
                className="mt-0.5"
              />
              <div>
                <Label htmlFor="lego-export-script">
                  Write a unit script if there is none
                </Label>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Puts <code>{project.unitName}.lua</code> in{" "}
                  <code>scripts</code>,{" "}
                  {project.script === undefined
                    ? "generated from the animations applied to this unit"
                    : "the script this unit owns, exactly as it stands"}
                  . An existing script is never overwritten, so hand edits
                  survive a re-export.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-2">
              <Checkbox
                id="lego-export-texture"
                checked={withTexture && (imported ? true : !!installed)}
                disabled={!imported && !installed}
                onCheckedChange={(checked) => setWithTexture(checked === true)}
                className="mt-0.5"
              />
              <div>
                <Label htmlFor="lego-export-texture">
                  Also place the {imported ? "textures" : "texture"}
                </Label>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {imported ? (
                    <>
                      Copies this unit's own{" "}
                      {imported.place.length === 1 ? "texture" : "textures"}{" "}
                      into <code>unittextures</code>, under the{" "}
                      {imported.place.length === 1 ? "name" : "names"} the model
                      already gives{" "}
                      {imported.place.length === 1 ? "it" : "them"}. A file
                      already at that name is never overwritten, since it is the
                      game's own.
                    </>
                  ) : (
                    <>
                      Copies the atlas into <code>unittextures</code> as{" "}
                      <code>{atlasFile}</code>. Every unit sampling this atlas
                      uses it, so this only needs doing once per game, and a
                      file already at that name is never overwritten.
                    </>
                  )}
                </p>
              </div>
            </div>

            {imported || installed ? null : (
              <p className="text-xs text-muted-foreground">
                <code>{atlas}</code> is not installed, so the texture cannot be
                copied and the Blender files cannot be written. The{" "}
                <code>.s3o</code> still names it, so installing the atlas pack
                and exporting again completes the unit.
              </p>
            )}

            <div className="flex flex-col gap-2 border-t border-border/60 pt-4">
              <span className="text-sm font-medium">For Blender</span>
              <p className="text-xs text-muted-foreground">
                Neither is read by the engine. Both are for taking the unit into
                Blender, to check it against the <code>.s3o</code> or finish it
                by hand, and both go into a <code>blender</code> folder
                alongside the game's own.
              </p>
              {imported ? (
                <p className="text-xs text-muted-foreground">
                  Not offered for an imported unit. Both embed the texture as an
                  image a browser has to decode, and an imported unit's is
                  usually a compressed <code>.dds</code>.
                </p>
              ) : null}
            </div>

            {imported ? null : (
              <>
                <div className="flex items-start gap-2">
                  <Checkbox
                    id="lego-export-glb"
                    checked={withGlb && !!installed}
                    disabled={!installed}
                    onCheckedChange={(checked) => setWithGlb(checked === true)}
                    className="mt-0.5"
                  />
                  <div>
                    <Label htmlFor="lego-export-glb">Also write a .glb</Label>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      <code>{project.unitName}.glb</code>, with the texture
                      embedded.
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-2">
                  <Checkbox
                    id="lego-export-obj"
                    checked={withObj && !!installed}
                    disabled={!installed}
                    onCheckedChange={(checked) => setWithObj(checked === true)}
                    className="mt-0.5"
                  />
                  <div>
                    <Label htmlFor="lego-export-obj">
                      Also write an .obj and .mtl
                    </Label>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      <code>{project.unitName}.obj</code> and{" "}
                      <code>{project.unitName}.mtl</code>, with a copy of{" "}
                      <code>{atlasFile}</code> next to them so the material
                      resolves.
                    </p>
                  </div>
                </div>
              </>
            )}

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
                {result.textureKept ? (
                  <p className="text-muted-foreground">
                    A texture called <code>{atlasFile}</code> was already there
                    and has been left alone. Delete it and export again to
                    replace it.
                  </p>
                ) : null}
                {result.textures.map((written) => (
                  <code key={written} className="break-all">
                    {written}
                  </code>
                ))}
                {result.texturesKept.length > 0 ? (
                  <p className="text-muted-foreground">
                    {result.texturesKept.join(", ")} was already there and has
                    been left alone, since that name is the game's own. Delete
                    it and export again to replace it.
                  </p>
                ) : null}
                {result.script ? (
                  <code className="break-all">{result.script}</code>
                ) : null}
                {result.scriptKept ? (
                  <p className="text-muted-foreground">
                    The unit script was already there and has been left alone.
                  </p>
                ) : null}
                {result.unitDef ? (
                  <code className="break-all">{result.unitDef}</code>
                ) : null}
                {result.unitDefKept ? (
                  <p className="text-muted-foreground">
                    The unit definition was already there and has been left
                    alone.
                  </p>
                ) : null}
                {result.glb ? (
                  <code className="break-all">{result.glb}</code>
                ) : null}
                {result.obj ? (
                  <code className="break-all">{result.obj}</code>
                ) : null}
                {result.mtl ? (
                  <code className="break-all">{result.mtl}</code>
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
