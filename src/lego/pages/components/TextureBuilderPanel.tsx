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

import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@picoframe/frame";
import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpen, X } from "lucide-react";
import { useState } from "react";
import { describeError } from "@/i18n/uiError";

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

export function TextureBuilderPanel({ imported, unitName, onChange }: Props) {
  const { t } = useLingui();
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
      filters: [
        {
          name: t`Image`,
          extensions: ["png", "dds", "tga", "bmp", "jpg", "jpeg"],
        },
      ],
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
      setProblem(describeError(error));
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
        existing: imported.texture2?.key ?? null,
        name,
      });
      onChange({
        texture2: { key: stored.key, name: stored.name },
        missingTexture2: undefined,
      });
      setBuilt((current) => ({ ...current, shading: stored.name }));
    } catch (error) {
      setProblem(describeError(error));
    } finally {
      setBusy(null);
    }
  }

  const redChannelNote = t`Only the red channel is read. A colour picture is not converted to grey, just cut down to its red channel.`;
  // File names the model carries, shown as they are.
  const colourName =
    imported.texture?.name ?? imported.missingTexture ?? "texture";
  const shadingName =
    imported.texture2?.name ?? imported.missingTexture2 ?? "texture2";
  const builtColour = built.colour ?? "";
  const builtShading = built.shading ?? "";
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-3 py-3">
      <p className="text-xs text-muted-foreground">
        <Trans>
          Compose this unit's two textures from separate layers, in the channel
          layout the engine reads rather than the layout an image editor works
          in. Building replaces the texture below, the same as choosing one by
          hand.
        </Trans>
      </p>

      <div className="flex flex-col gap-2 border-t border-border/60 pt-3">
        <span className="text-sm font-medium">
          <Trans>Colour texture</Trans>
        </span>
        <p className="text-xs text-muted-foreground">
          <Trans>
            RGB colour, with the team-colour mask packed into its alpha. This is{" "}
            <code>{colourName}</code>, what the unit is painted with.
          </Trans>
        </p>
        <PickRow
          label={t`Colour picture`}
          path={colour}
          onChoose={() => void pick(t`Choose a colour picture`, setColour)}
          onClear={() => setColour(null)}
        />
        <PickRow
          label={t`Team-colour mask (greyscale, optional)`}
          note={redChannelNote}
          path={mask}
          onChoose={() => void pick(t`Choose a team-colour mask`, setMask)}
          onClear={() => setMask(null)}
        />
        <p className="text-xs text-muted-foreground">
          <Trans>
            With no mask, alpha is written 0 everywhere: the colour draws as
            painted, with no team colour mixed in.
          </Trans>
        </p>
        <Button
          size="sm"
          variant="outline"
          disabled={!colour || busy !== null}
          onClick={() => void buildColour()}
        >
          {busy === "colour" ? t`Building` : t`Build texture`}
        </Button>
        {built.colour ? (
          <p className="text-xs text-muted-foreground">
            <Trans>
              Built <code>{builtColour}</code>.
            </Trans>
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-2 border-t border-border/60 pt-3">
        <span className="text-sm font-medium">
          <Trans>Shading map</Trans>
        </span>
        <p className="text-xs text-muted-foreground">
          <Trans>
            Glow into red, reflectivity into green. Blue is not read by the
            engine. Neither map here supplies alpha, the one-bit visibility
            cutout the engine also reads from this texture, so if this unit
            already has one, its existing cutout carries over into the result
            rather than being erased. A cutout that cannot be carried over,
            because the new size does not match it, is refused rather than
            guessed at. With no existing texture, alpha is written fully opaque.
            This is <code>{shadingName}</code>, the model's second texture.
          </Trans>
        </p>
        <PickRow
          label={t`Glow (greyscale, optional)`}
          note={redChannelNote}
          path={glow}
          onChoose={() => void pick(t`Choose a glow map`, setGlow)}
          onClear={() => setGlow(null)}
        />
        <PickRow
          label={t`Reflectivity (greyscale, optional)`}
          note={redChannelNote}
          path={reflectivity}
          onChoose={() =>
            void pick(t`Choose a reflectivity map`, setReflectivity)
          }
          onClear={() => setReflectivity(null)}
        />
        <p className="text-xs text-muted-foreground">
          <Trans>
            At least one of the two is needed. A side left out is written 0.
          </Trans>
        </p>
        <Button
          size="sm"
          variant="outline"
          disabled={(!glow && !reflectivity) || busy !== null}
          onClick={() => void buildShading()}
        >
          {busy === "shading" ? t`Building` : t`Build shading map`}
        </Button>
        {built.shading ? (
          <p className="text-xs text-muted-foreground">
            <Trans>
              Built <code>{builtShading}</code>.
            </Trans>
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
  note,
  path,
  onChoose,
  onClear,
}: {
  label: string;
  /** A short rule about the file itself, shown under the picker rather than
   *  only in a doc comment nobody choosing a file will read. */
  note?: string;
  path: string | null;
  onChoose: () => void;
  onClear: () => void;
}) {
  const { t } = useLingui();
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
          <span className="truncate">{path ?? t`Choose a file`}</span>
        </Button>
        {path ? (
          <Button
            size="icon"
            variant="ghost"
            className="size-7 shrink-0"
            aria-label={t`Clear ${label}`}
            onClick={onClear}
          >
            <X size={12} />
          </Button>
        ) : null}
      </div>
      {note ? (
        <span className="text-[11px] text-muted-foreground">{note}</span>
      ) : null}
    </div>
  );
}
