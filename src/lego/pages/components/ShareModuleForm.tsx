/**
 * "Share this module" (#3272): a code, a link and a publish to the Coilbox
 * hub, through `ChallengeCodeView` like every other shareable kind. A module
 * holding game geometry gets the reason instead, and no code. One holding the
 * game maker's own meshes (#4360) reads its geometry file first, since the
 * code carries the meshes.
 */

import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { ChallengeCodeView } from "@/challenge/ChallengeCodeView";
import { describeError } from "@/i18n/uiError";
import { holdsMeshes } from "../../liftPiece";
import type { LegoProject } from "../../model";
import { moduleShareCode } from "../../moduleShare";
import {
  disposeRawGeometry,
  loadRawGeometryIfAny,
  type RawGeometry,
} from "../../rawGeometry";

type Geometry =
  | { state: "reading" }
  | { state: "read"; raw: RawGeometry | null }
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

export function ShareModuleForm({ module }: { module: LegoProject }) {
  const meshes = sharesMeshes(module);
  const moduleId = module.id;
  const [geometry, setGeometry] = useState<Geometry>(() =>
    meshes ? { state: "reading" } : { state: "read", raw: null },
  );
  useEffect(() => {
    if (!meshes) return;
    let live = true;
    let held: RawGeometry | null = null;
    loadRawGeometryIfAny(moduleId).then(
      (raw) => {
        if (!live) {
          if (raw) disposeRawGeometry(raw);
          return;
        }
        held = raw;
        setGeometry({ state: "read", raw });
      },
      (error: unknown) =>
        live && setGeometry({ state: "failed", message: describeError(error) }),
    );
    return () => {
      live = false;
      if (held) disposeRawGeometry(held);
    };
  }, [meshes, moduleId]);

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
  const made = moduleShareCode(module, geometry.raw);
  if (!made.ok) {
    return <p className="p-4 text-sm text-muted-foreground">{made.reason}</p>;
  }
  return (
    <ChallengeCodeView
      code={made.code}
      title={module.name}
      helpText={t`Anyone who opens this gets the module in their unit builder.`}
    />
  );
}
