/**
 * Pack an imported unit's two textures from separate layers.
 *
 * An `.s3o` carries exactly two textures, in a channel layout an image editor
 * knows nothing about: the first is colour with the team-colour mask in its
 * alpha, the second is glow in red and reflectivity in green. Anyone painting
 * in separate greyscale and colour layers has to pack them into those channels
 * by hand, which until now meant Upspring or a script. This is that packing,
 * done here instead.
 *
 * The channel layout is `coilbox_texture::compose_texture1` and
 * `compose_texture2`'s, confirmed against the engine: `S3OTextureHandler.cpp`
 * and `ModelFragProgGL4.glsl` agree on both textures' channels (see the doc
 * comments on those two functions for the exact lines).
 *
 * Only for a unit imported whole. A unit built out of the parts pack draws
 * with a shared atlas rather than its own two textures, and packing a
 * team-colour mask into a sheet other units sample too is a different feature
 * from this one (#2574).
 *
 * Building writes into the same store `TexturePicker` points a unit at, so the
 * result flows through the same export and pruning path as any other texture:
 * nothing downstream needs to know it was composed rather than chosen.
 */

import { Button } from "@picoframe/frame";
import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpen, X } from "lucide-react";
import { useState } from "react";

import {
  legoTextureComposeColour,
  legoTextureComposeShading,
} from "../../bindings";
import type { LegoImported } from "../../model";

interface Props {
  imported: LegoImported;
  /** Used to name a texture the model does not already have one to keep the
   *  name of. */
  unitName: string;
  /** An ordinary document edit, so undo takes a built texture back. */
  onChange: (change: Partial<LegoImported>) => void;
}

const IMAGE_FILTER = [
  { name: "Image", extensions: ["png", "dds", "tga", "bmp", "jpg", "jpeg"] },
];

export function TextureBuilderPanel({ imported, unitName, onChange }: Props) {
  const [colour, setColour] = useState<string | null>(null);
  const [mask, setMask] = useState<string | null>(null);
  const [glow, setGlow] = useState<string | null>(null);
  const [reflectivity, setReflectivity] = useState<string | null>(null);
  const [busy, setBusy] = useState<"colour" | "shading" | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [built, setBuilt] = useState<{ colour?: string; shading?: string }>({});

  async function pick(
    title: string,
    setPath: (path: string) => void,
  ): Promise<void> {
    const picked = await open({
      multiple: false,
      title,
      filters: IMAGE_FILTER,
    });
    if (typeof picked === "string") setPath(picked);
  }

  async function buildColour(): Promise<void> {
    if (!colour) return;
    setBusy("colour");
    setProblem(null);
    try {
      const name =
        imported.texture?.name ?? imported.missingTexture ?? `${unitName}.png`;
      const stored = await legoTextureComposeColour({
        colour,
        mask,
        name,
      });
      onChange({
        texture: { key: stored.key, name: stored.name },
        missingTexture: undefined,
      });
      setBuilt((current) => ({ ...current, colour: stored.name }));
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  }

  async function buildShading(): Promise<void> {
    if (!glow && !reflectivity) return;
    setBusy("shading");
    setProblem(null);
    try {
      const name =
        imported.texture2?.name ??
        imported.missingTexture2 ??
        `${unitName}2.png`;
      const stored = await legoTextureComposeShading({
        glow,
        reflectivity,
        name,
      });
      onChange({
        texture2: { key: stored.key, name: stored.name },
        missingTexture2: undefined,
      });
      setBuilt((current) => ({ ...current, shading: stored.name }));
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-3 py-3">
      <p className="text-xs text-muted-foreground">
        Compose this unit's two textures from separate layers, in the channel
        layout the engine reads rather than the layout an image editor works in.
        Building replaces the texture below, the same as choosing one by hand.
      </p>

      <div className="flex flex-col gap-2 border-t border-border/60 pt-3">
        <span className="text-sm font-medium">Colour texture</span>
        <p className="text-xs text-muted-foreground">
          RGB colour, with the team-colour mask packed into its alpha. This is{" "}
          <code>
            {imported.texture?.name ?? imported.missingTexture ?? "texture"}
          </code>
          , what the unit is painted with.
        </p>
        <PickRow
          label="Colour picture"
          path={colour}
          onChoose={() => void pick("Choose a colour picture", setColour)}
          onClear={() => setColour(null)}
        />
        <PickRow
          label="Team-colour mask (greyscale, optional)"
          path={mask}
          onChoose={() => void pick("Choose a team-colour mask", setMask)}
          onClear={() => setMask(null)}
        />
        <p className="text-xs text-muted-foreground">
          With no mask, alpha is written 0 everywhere: the colour draws as
          painted, with no team colour mixed in.
        </p>
        <Button
          size="sm"
          variant="outline"
          disabled={!colour || busy !== null}
          onClick={() => void buildColour()}
        >
          {busy === "colour" ? "Building" : "Build texture"}
        </Button>
        {built.colour ? (
          <p className="text-xs text-muted-foreground">
            Built <code>{built.colour}</code>.
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-2 border-t border-border/60 pt-3">
        <span className="text-sm font-medium">Shading map</span>
        <p className="text-xs text-muted-foreground">
          Glow into red, reflectivity into green. Blue is not read by the engine
          and alpha is always written fully opaque, since neither map here
          supplies the one-bit cutout the engine also reads from this texture: a
          unit whose current one hides geometry with that channel loses the
          cutout when this replaces it. This is{" "}
          <code>
            {imported.texture2?.name ?? imported.missingTexture2 ?? "texture2"}
          </code>
          , the model's second texture.
        </p>
        <PickRow
          label="Glow (greyscale, optional)"
          path={glow}
          onChoose={() => void pick("Choose a glow map", setGlow)}
          onClear={() => setGlow(null)}
        />
        <PickRow
          label="Reflectivity (greyscale, optional)"
          path={reflectivity}
          onChoose={() =>
            void pick("Choose a reflectivity map", setReflectivity)
          }
          onClear={() => setReflectivity(null)}
        />
        <p className="text-xs text-muted-foreground">
          At least one of the two is needed. A side left out is written 0.
        </p>
        <Button
          size="sm"
          variant="outline"
          disabled={(!glow && !reflectivity) || busy !== null}
          onClick={() => void buildShading()}
        >
          {busy === "shading" ? "Building" : "Build shading map"}
        </Button>
        {built.shading ? (
          <p className="text-xs text-muted-foreground">
            Built <code>{built.shading}</code>.
          </p>
        ) : null}
      </div>

      {problem ? <p className="text-xs text-destructive">{problem}</p> : null}
    </div>
  );
}

/** One layer to choose, with what was chosen and a way to clear it. */
function PickRow({
  label,
  path,
  onChoose,
  onClear,
}: {
  label: string;
  path: string | null;
  onChoose: () => void;
  onClear: () => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="flex items-center gap-1.5">
        <Button
          size="sm"
          variant="outline"
          className="min-w-0 flex-1 justify-start gap-1.5 overflow-hidden"
          onClick={onChoose}
        >
          <FolderOpen size={12} className="shrink-0" />
          <span className="truncate">{path ?? "Choose a file"}</span>
        </Button>
        {path ? (
          <Button
            size="icon"
            variant="ghost"
            className="size-7 shrink-0"
            aria-label={`Clear ${label}`}
            onClick={onClear}
          >
            <X size={12} />
          </Button>
        ) : null}
      </div>
    </div>
  );
}
