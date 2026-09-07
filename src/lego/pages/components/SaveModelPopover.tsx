/**
 * Write a unit's model alone back to disk, and nothing else.
 *
 * The lightweight road out of the builder for a unit that was only ever
 * opened to fix one thing: nudge a piece, rename it, reparent it, save. Export
 * builds a whole unit into a game folder, with a definition, a script and a
 * collision file beside the model. This writes the `.s3o` on its own, over
 * the file it was opened from or to a path the user picks, which is what
 * `lego_save_s3o` does differently from `lego_export`.
 *
 * Only shown for an imported unit: one built out of the parts pack was never
 * opened from a file, so there is nothing to save back over.
 */

import { Button } from "@picoframe/frame";
import { save } from "@tauri-apps/plugin-dialog";
import { FileDown } from "lucide-react";
import { useState } from "react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { basename } from "@/lib/helpers";
import { notify } from "@/notify/notify";
import { legoSaveS3o } from "../../bindings";
import type { LegoImported, LegoProject } from "../../model";
import type { LoadedPack } from "../../pack";
import type { RawGeometry } from "../../rawGeometry";
import { importedTextures, writableSource } from "../../rawImport";
import { buildS3o } from "../../s3oBuild";

interface Props {
  project: LegoProject;
  imported: LegoImported;
  pack: LoadedPack;
  raw: RawGeometry | null;
}

export function SaveModelPopover({ project, imported, pack, raw }: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const writable = writableSource(imported);

  function build() {
    const textures = importedTextures(imported);
    const model = buildS3o(
      project,
      pack,
      raw,
      {
        texture1: textures.texture1,
        texture2: textures.texture2,
      },
      // No script is written alongside this file, so nothing needs a piece's
      // normalised name to still resolve: write the name the file came in
      // with instead, when a piece still has one (#2613).
      { useOriginalNames: true },
    );
    if (!model) throw new Error("This unit has no root piece.");
    return model;
  }

  async function writeTo(path: string) {
    setBusy(true);
    try {
      const model = build();
      await legoSaveS3o({ path, model });
      setOpen(false);
      notify({ title: "Model saved", body: path, level: "success" });
    } catch (error) {
      notify({
        title: "Could not save the model",
        body: error instanceof Error ? error.message : String(error),
        level: "error",
      });
    } finally {
      setBusy(false);
    }
  }

  async function saveAs() {
    const dest = await save({
      title: "Save the model",
      defaultPath: writable ?? `${project.unitName}.s3o`,
      filters: [{ name: "Spring model", extensions: ["s3o"] }],
    });
    if (dest) await writeTo(dest);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="icon" variant="outline" aria-label="Save model">
          <FileDown size={14} />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-3">
        <div className="space-y-0.5">
          <p className="text-sm font-medium">Save the model</p>
          <p className="text-xs text-muted-foreground">
            Writes the <code>.s3o</code> alone: no unit definition, no script,
            no collision file.
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <Button
            size="sm"
            disabled={!writable || busy}
            onClick={() => writable && void writeTo(writable)}
          >
            {writable
              ? `Save over ${basename(writable)}`
              : "No file to save over"}
          </Button>
          {!writable ? (
            <p className="text-xs text-muted-foreground">
              This model was opened from inside a packed archive, which holds no
              path to write back to. Save it to a chosen path instead.
            </p>
          ) : null}
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => void saveAs()}
          >
            Save to a chosen file
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
