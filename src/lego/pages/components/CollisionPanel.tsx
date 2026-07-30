/**
 * The unit's collision volume, as numbers you can change.
 *
 * It opens on the volume the export would write anyway, derived from the
 * model's bounding box, so the panel is a reading before it is a control.
 * Touching any field takes the volume over and it is then saved with the unit.
 * "Use the bounding box" hands it back.
 *
 * The viewport draws the same volume, so the numbers here have a shape on
 * screen: see the collision toggle in its camera group.
 */

import { Button } from "@picoframe/frame";
import { useMemo } from "react";

import { OptionSelect } from "../../../uberstress/pages/components/OptionSelect";
import {
  COLLISION_VOLUME_LABELS,
  derivedCollisionVolume,
  isIgnoredByEngine,
} from "../../collisionVolume";
import type {
  CollisionVolumeType,
  LegoCollisionVolume,
  LegoProject,
} from "../../model";
import type { LoadedPack } from "../../pack";
import { unitBounds } from "../../s3oBuild";
import { Vec3Row } from "./TransformFields";

interface Props {
  project: LegoProject;
  pack: LoadedPack;
  /** Null puts the unit back on the derived volume. */
  onChange: (volume: LegoCollisionVolume | null) => void;
}

export function CollisionPanel({ project, pack, onChange }: Props) {
  // Every vertex in the unit, so not on every keystroke elsewhere in the page.
  const bounds = useMemo(() => unitBounds(project, pack), [project, pack]);
  const custom = project.collisionVolume;
  const volume = custom ?? derivedCollisionVolume(bounds);

  function setAxis(
    field: "scales" | "offsets",
    axis: number,
    value: number,
  ): void {
    const next: [number, number, number] = [...volume[field]];
    next[axis] = value;
    onChange({ ...volume, [field]: next });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 py-3">
      <p className="text-xs text-muted-foreground">
        The shape the engine hits, clicks and shoots at. Without one it uses a
        sphere around the whole unit, which is a far bigger click target than a
        long unit looks.
      </p>

      <div>
        <span className="text-xs text-muted-foreground">Shape</span>
        <OptionSelect
          className="mt-1"
          size="sm"
          value={volume.type}
          onValueChange={(type) =>
            onChange({ ...volume, type: type as CollisionVolumeType })
          }
          options={Object.entries(COLLISION_VOLUME_LABELS).map(
            ([id, label]) => ({ value: id, label }),
          )}
        />
      </div>

      <Vec3Row
        label="Size"
        unit="elmos"
        values={volume.scales}
        onCommit={(axis, value) => setAxis("scales", axis, value)}
      />
      <Vec3Row
        label="Offset from the middle"
        values={volume.offsets}
        onCommit={(axis, value) => setAxis("offsets", axis, value)}
      />

      <p className="text-xs text-muted-foreground">
        Size is the volume's full width on each axis, not its radius. The offset
        is measured from the middle of the unit, so zero is centred on it.
      </p>

      <p className="text-xs text-muted-foreground">
        While this panel is open the viewport's handles are on the volume rather
        than on a piece, so you can drag it to size instead of typing. Move and
        scale only: a volume has no rotation.
      </p>

      {volume.type === "sphere" ? (
        <p className="text-xs text-muted-foreground">
          A sphere cannot be stretched, so the engine takes the largest of the
          three sizes and uses it on every axis.
        </p>
      ) : null}
      {volume.type.startsWith("cyl") ? (
        <p className="text-xs text-muted-foreground">
          A cylinder is round, so the engine takes the larger of the two sizes
          across it and uses that for both.
        </p>
      ) : null}

      {isIgnoredByEngine(volume) ? (
        <p className="text-xs text-destructive">
          Nothing here is more than an elmo across, so the engine will read it
          as no volume at all and go back to its own sphere.
        </p>
      ) : null}

      {custom ? (
        <Button size="sm" variant="outline" onClick={() => onChange(null)}>
          Use the bounding box
        </Button>
      ) : (
        <p className="text-xs text-muted-foreground">
          Derived from the model's bounding box, and re-derived as the unit
          changes. Changing anything above takes it over.
        </p>
      )}
    </div>
  );
}
