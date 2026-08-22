/**
 * The unit's aim point, as three numbers you can change.
 *
 * Like the collision panel next to it, it opens on the value the export would
 * write anyway, derived from the model's bounding box, so it reads as a
 * measurement before it is a control. Touching any field takes it over and it
 * is then saved with the unit. "Use the bounding box centre" hands it back.
 *
 * What the number means, and why moving it moves two other things, is in
 * `../../aimPoint.ts`.
 */

import { Button } from "@picoframe/frame";
import { useMemo } from "react";

import { aimPoint } from "../../aimPoint";
import type { LegoProject } from "../../model";
import type { LoadedPack } from "../../pack";
import type { RawGeometry } from "../../rawGeometry";
import { unitBounds } from "../../s3oBuild";
import { Vec3Row } from "./TransformFields";

interface Props {
  project: LegoProject;
  pack: LoadedPack;
  /** The meshes of a unit imported from somebody else's model, if it is one. */
  raw: RawGeometry | null;
  /** Null puts the unit back on the middle of its bounding box. */
  onChange: (mid: [number, number, number] | null) => void;
}

export function AimPointPanel({ project, pack, raw, onChange }: Props) {
  // Every vertex in the unit, so not on every keystroke elsewhere in the page.
  const bounds = useMemo(
    () => unitBounds(project, pack, raw),
    [project, pack, raw],
  );
  const own = project.mid;
  const aim = aimPoint(project, bounds);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 py-3">
      <p className="text-xs text-muted-foreground">
        The one point on the unit that another unit shoots at. The engine uses
        it as the unit's middle too, for range checks and for leading a moving
        target.
      </p>

      <Vec3Row
        label="Aim point"
        unit="elmos"
        values={aim}
        onCommit={(axis, value) => {
          const next: [number, number, number] = [...aim];
          next[axis] = value;
          onChange(next);
        }}
      />

      <p className="text-xs text-muted-foreground">
        Measured from the unit's own origin, which sits on the ground, so y is
        how far up the unit the shot lands.
      </p>

      <p className="text-xs text-muted-foreground">
        While this panel is open the viewport's handles are on the point itself,
        so it can be dragged onto the body rather than typed. Move only: a point
        has no size and nothing to turn.
      </p>

      <p className="text-xs text-muted-foreground">
        Worth moving whenever a long piece drags the bounding box off the body:
        a crane arm, an aircraft tail, a raised dish. The middle of the box is
        then out in the air beside the unit, and shots aimed at it miss what a
        player is looking at.
      </p>

      {own ? (
        <Button size="sm" variant="outline" onClick={() => onChange(null)}>
          Use the bounding box centre
        </Button>
      ) : (
        <p className="text-xs text-muted-foreground">
          The middle of the model's bounding box, re-measured as the unit
          changes. Changing anything above takes it over.
        </p>
      )}

      <div className="border-t border-border/60 pt-3">
        <p className="text-xs font-medium">What moves with it</p>
        <p className="mt-1 text-xs text-muted-foreground">
          The collision sphere is centred here, so it is re-measured from
          wherever you put this. The collision volume's offsets are measured
          from here too, and those are adjusted so the volume stays on the
          geometry rather than following the point.
        </p>
      </div>

      <p className="text-xs text-muted-foreground">
        Which piece a weapon fires from is a separate thing the engine reads out
        of the unit's script, and the builder has no weapons to fire.
      </p>
    </div>
  );
}
