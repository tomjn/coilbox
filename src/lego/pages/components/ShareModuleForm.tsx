/**
 * "Share this module" (#3272): a code, a link and a publish to the Coilbox
 * hub, through `ChallengeCodeView` like every other shareable kind. A module
 * holding game geometry gets the reason instead, and no code. One holding the
 * game maker's own meshes (#4360) reads its geometry file first, since the
 * code carries the meshes, and the textures they record (#5073).
 */

import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { ChallengeCodeView } from "@/challenge/ChallengeCodeView";
import { describeError } from "@/i18n/uiError";
import { legoTextureUrl } from "@/lib/assetUrl";
import { holdsMeshes } from "../../liftPiece";
import type { LegoProject } from "../../model";
import {
  moduleShareCode,
  moduleTextures,
  type TextureBytes,
} from "../../moduleShare";
import {
  disposeRawGeometry,
  loadRawGeometryIfAny,
  type RawGeometry,
} from "../../rawGeometry";

type Geometry =
  | { state: "reading" }
  | { state: "read"; raw: RawGeometry | null; textures: TextureBytes }
  | { state: "failed"; message: string };

/** Whether a code could carry the module's meshes, so they are worth reading:
 *  it has some, and every one is the maker's own (#4360). */
function sharesMeshes(module: LegoProject): boolean {
  return (
    holdsMeshes(module) &&
    module.pieces.every(
      (piece) => !piece.meshId || (piece.ownMesh && !piece.lifted),
    )
  );
}

/**
 * The bytes of each texture the store still holds, by key. One it no longer
 * holds is left out of the map, and so out of the code.
 */
async function readTextures(keys: string[]): Promise<TextureBytes> {
  const read = new Map<string, Uint8Array>();
  for (const key of keys) {
    try {
      const response = await fetch(legoTextureUrl(key));
      if (response.ok)
        read.set(key, new Uint8Array(await response.arrayBuffer()));
    } catch {
      // Not in the store any more, so the code goes without it.
    }
  }
  return read;
}

export function ShareModuleForm({ module }: { module: LegoProject }) {
  const meshes = sharesMeshes(module);
  const moduleId = module.id;
  // As one string, since the module is a fresh object on every render.
  const textureKeys = moduleTextures(module)
    .map((texture) => texture.key)
    .join("\n");
  const [geometry, setGeometry] = useState<Geometry>(() =>
    meshes
      ? { state: "reading" }
      : { state: "read", raw: null, textures: new Map() },
  );
  useEffect(() => {
    if (!meshes) return;
    let live = true;
    let held: RawGeometry | null = null;
    Promise.all([
      loadRawGeometryIfAny(moduleId),
      readTextures(textureKeys ? textureKeys.split("\n") : []),
    ]).then(
      ([raw, textures]) => {
        if (!live) {
          if (raw) disposeRawGeometry(raw);
          return;
        }
        held = raw;
        setGeometry({ state: "read", raw, textures });
      },
      (error: unknown) =>
        live && setGeometry({ state: "failed", message: describeError(error) }),
    );
    return () => {
      live = false;
      if (held) disposeRawGeometry(held);
    };
  }, [meshes, moduleId, textureKeys]);

  if (geometry.state === "reading") {
    return (
      <p className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden />
        <Trans>Reading the module's meshes.</Trans>
      </p>
    );
  }
  if (geometry.state === "failed") {
    return <p className="p-4 text-sm text-destructive">{geometry.message}</p>;
  }
  const made = moduleShareCode(module, geometry.raw, geometry.textures);
  if (!made.ok) {
    return <p className="p-4 text-sm text-muted-foreground">{made.reason}</p>;
  }
  const leftOut = made.leftOut.join(", ");
  return (
    <>
      {leftOut ? (
        <p className="px-4 pt-4 text-sm text-muted-foreground">
          <Trans>
            These textures are too large for a code or are not in coilbox's
            texture store, so the module arrives without them: {leftOut}
          </Trans>
        </p>
      ) : null}
      <ChallengeCodeView
        code={made.code}
        title={module.name}
        helpText={t`Anyone who opens this gets the module in their unit builder.`}
      />
    </>
  );
}
