/**
 * Which texture a unit imported from somebody else's model draws with.
 *
 * Not an atlas. A parts unit samples a sheet every part is mapped into, so
 * switching between atlases is safe by construction. An imported model's UVs
 * were hand authored onto one particular image, and this is a pointer to which
 * image that is.
 *
 * Changing it swaps the texture and nothing else. The geometry and its UVs are
 * untouched, and whether the new image suits them is the user's call to make
 * and to undo. There is deliberately no remapping here, no warning, and no
 * check that the new texture "matches": coilbox is not a UV mapping tool.
 *
 * Refresh is the button that gets used. The everyday case is not switching
 * texture, it is the same file being edited in Photoshop or GIMP and the model
 * needing to show the new version. It re-reads the file the texture came from,
 * and because the store is keyed by content the new bytes land on a new key, so
 * the webview has nothing stale behind the old URL. Nothing else moves: the
 * geometry, the camera and the selection are all left where they were.
 *
 * A unit out of a packed game or map has no such file. The import unpacked its
 * texture out of the archive to read it, and an archive holds no path to hand
 * back, so there is nothing to re-read and Refresh is off until a file is
 * chosen (#1903).
 *
 * A watcher would notice the edit on its own and is more machinery than this
 * needs. A button is honest and cheap, and can grow into a watcher later.
 */

import { Button } from "@picoframe/frame";
import { open } from "@tauri-apps/plugin-dialog";
import { Image, RefreshCw } from "lucide-react";
import { useState } from "react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { legoTextureImport } from "../../bindings";
import type { LegoImported, LegoTexture } from "../../model";

/** Which of the two textures a control is about. */
type Slot = "texture" | "teamMask";

interface Props {
  imported: LegoImported;
  /** An ordinary document edit, so undo takes a swapped texture back. */
  onChange: (change: Partial<LegoImported>) => void;
}

export function TexturePicker({ imported, onChange }: Props) {
  const [busy, setBusy] = useState<Slot | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const label =
    imported.texture?.name ?? imported.missingTexture ?? "no texture";

  /** Put a file in the store and point the unit at it. */
  async function take(slot: Slot, path: string) {
    setBusy(slot);
    setProblem(null);
    try {
      const stored = await legoTextureImport({ path });
      const texture: LegoTexture = {
        key: stored.key,
        name: stored.name,
        source: path,
      };
      onChange(
        slot === "texture"
          ? { texture, missingTexture: undefined }
          : { teamMask: texture, missingTeamMask: undefined },
      );
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  }

  async function choose(slot: Slot) {
    const picked = await open({
      multiple: false,
      title: slot === "texture" ? "Choose a texture" : "Choose a team mask",
      filters: [
        {
          name: "Texture",
          extensions: ["dds", "png", "tga", "bmp", "jpg", "jpeg"],
        },
      ],
    });
    if (typeof picked === "string") await take(slot, picked);
  }

  /** Re-read the file this texture came from, in case it has been edited. */
  async function refresh(slot: Slot) {
    const source = (slot === "texture" ? imported.texture : imported.teamMask)
      ?.source;
    if (!source) {
      setProblem(
        "This texture has no file to re-read. Choose one, and refresh will pick up edits to it after that.",
      );
      return;
    }
    await take(slot, source);
  }

  return (
    <div className="flex items-center gap-1 px-1 text-xs text-muted-foreground">
      <span>texture</span>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-5 max-w-40 justify-start gap-1 px-1 text-xs font-normal"
          >
            <Image size={12} className="shrink-0" />
            <span className="truncate">{label}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-80">
          <div className="flex flex-col gap-4">
            <TextureSlot
              title="Texture"
              hint="What this unit is painted with. Its UV map points onto this image, so a different one is a different look rather than a remap."
              texture={imported.texture}
              missing={imported.missingTexture}
              busy={busy === "texture"}
              onChoose={() => void choose("texture")}
              onRefresh={() => void refresh("texture")}
            />
            <TextureSlot
              title="Team colour mask"
              hint="The red channel marks the regions the engine paints in the player's colour. Those regions are black in the texture above, so a unit without this shows black patches."
              texture={imported.teamMask}
              missing={imported.missingTeamMask}
              busy={busy === "teamMask"}
              onChoose={() => void choose("teamMask")}
              onRefresh={() => void refresh("teamMask")}
            />
            {problem ? (
              <p className="text-xs text-destructive">{problem}</p>
            ) : null}
          </div>
        </PopoverContent>
      </Popover>
      <Button
        variant="ghost"
        size="icon"
        className="size-5"
        aria-label="Refresh the texture"
        title="Re-read the texture file, to pick up an edit made elsewhere"
        disabled={busy !== null || !imported.texture?.source}
        onClick={() => void refresh("texture")}
      >
        <RefreshCw size={12} />
      </Button>
    </div>
  );
}

/** One of the two textures: what it is, where it came from, and what to do. */
function TextureSlot({
  title,
  hint,
  texture,
  missing,
  busy,
  onChoose,
  onRefresh,
}: {
  title: string;
  hint: string;
  texture: LegoTexture | undefined;
  missing: string | undefined;
  busy: boolean;
  onChoose: () => void;
  onRefresh: () => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium text-foreground">{title}</span>
      <p className="text-xs text-muted-foreground">{hint}</p>
      {texture ? (
        <>
          <code className="break-all text-xs">{texture.name}</code>
          {texture.source ? (
            <p className="break-all text-xs text-muted-foreground">
              from {texture.source}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Coilbox has its own copy and there is no file behind it to
              re-read, which is what a model out of a packed game or map leaves
              you with. Choose one, and refresh picks up edits to it after that.
            </p>
          )}
        </>
      ) : (
        <p className="text-xs text-muted-foreground">
          {missing
            ? `The model names ${missing}, and no such file was found beside it.`
            : "The model names none."}
        </p>
      )}
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" disabled={busy} onClick={onChoose}>
          {texture ? "Change" : "Choose"}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={busy || !texture?.source}
          onClick={onRefresh}
        >
          <RefreshCw size={14} /> Refresh
        </Button>
      </div>
    </div>
  );
}
