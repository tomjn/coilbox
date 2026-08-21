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
 *
 * Offsets are measured from the unit's aim point, which is `AimPointPanel`
 * next door. Moving that point would carry the volume with it, so the panel
 * there writes offsets that hold it still instead.
 */

import { Button } from "@picoframe/frame";
import { useMemo } from "react";

import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { OptionSelect } from "../../../uberstress/pages/components/OptionSelect";
import {
  COLLISION_VOLUME_LABELS,
  effectiveCollisionVolume,
  isIgnoredByEngine,
} from "../../collisionVolume";
import type {
  CollisionVolumeType,
  LegoCollisionVolume,
  LegoPieceCollision,
  LegoProject,
} from "../../model";
import type { LoadedPack } from "../../pack";
import type { RawGeometry } from "../../rawGeometry";
import { unitBounds } from "../../s3oBuild";
import { PieceCollisionFields } from "./PieceCollisionFields";
import { Vec3Row } from "./TransformFields";

interface Props {
  project: LegoProject;
  pack: LoadedPack;
  /** The meshes of a unit imported from somebody else's model, if it is one. */
  raw: RawGeometry | null;
  /** Null puts the unit back on the derived volume. */
  onChange: (volume: LegoCollisionVolume | null) => void;
  onPieceCollisionChange: (on: boolean) => void;
  onPieceSelectionChange: (on: boolean) => void;
  /** The piece the per-piece fields at the bottom edit. */
  selectedId: string | null;
  onSelectPiece: (pieceId: string) => void;
  /** Null puts that piece back on the box the engine measures for it. */
  onPieceVolumeChange: (
    pieceId: string,
    collision: LegoPieceCollision | null,
  ) => void;
}

export function CollisionPanel({
  project,
  pack,
  raw,
  onChange,
  onPieceCollisionChange,
  onPieceSelectionChange,
  selectedId,
  onSelectPiece,
  onPieceVolumeChange,
}: Props) {
  // Every vertex in the unit, so not on every keystroke elsewhere in the page.
  const bounds = useMemo(
    () => unitBounds(project, pack, raw),
    [project, pack, raw],
  );
  const custom = project.collisionVolume;
  const volume = effectiveCollisionVolume(project, bounds);

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
        label="Offset from the aim point"
        values={volume.offsets}
        onCommit={(axis, value) => setAxis("offsets", axis, value)}
      />

      <p className="text-xs text-muted-foreground">
        Size is the volume's full width on each axis, not its radius. The offset
        is measured from the unit's aim point, which the Aim panel sets and
        which most units leave on the middle of their bounding box. Move the aim
        point and these change to keep the volume where it is.
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

      <div className="border-t border-border/60 pt-3">
        <p className="text-xs font-medium">Use each piece instead</p>
        <p className="mt-1 text-xs text-muted-foreground">
          The engine measures a box around every piece as it loads the model,
          and can use those boxes rather than the shape above. Shooting and
          clicking ask for them separately, so these are two switches: a walker
          can be shot between its legs and still be easy to click on.
        </p>
      </div>

      <div className="flex items-center justify-between gap-3">
        <Label htmlFor="piece-collision" className="text-xs font-medium">
          Shoot at each piece
        </Label>
        <Switch
          id="piece-collision"
          checked={project.pieceCollision === true}
          onCheckedChange={onPieceCollisionChange}
        />
      </div>

      <p className="text-xs text-muted-foreground">
        Writes <code>usepiececollisionvolumes</code>. A shot is then tested
        against each piece's box, so one can pass between a walker's legs or
        under a gantry rather than stopping at the shape above.
      </p>

      <div className="flex items-center justify-between gap-3">
        <Label htmlFor="piece-selection" className="text-xs font-medium">
          Click on each piece
        </Label>
        <Switch
          id="piece-selection"
          checked={project.pieceSelection === true}
          onCheckedChange={onPieceSelectionChange}
        />
      </div>

      <p className="text-xs text-muted-foreground">
        Writes <code>usepieceselectionvolumes</code>. The click target is then
        the pieces rather than the shape above, which is what a gantry or a
        spindly walker wants: it is otherwise selectable from the empty air it
        encloses.
      </p>

      <p className="text-xs text-muted-foreground">
        Turn a switch on and the viewport draws the boxes the engine will build.
        A piece whose box is the wrong answer can be given another one, or taken
        out of the hit test entirely, below.
      </p>

      {project.pieceCollision || project.pieceSelection ? (
        <p className="text-xs text-muted-foreground">
          The volume above is still worth getting right.{" "}
          {project.pieceSelection
            ? "It is the sphere an explosion measures to decide whether the unit was caught."
            : "It is still what you click to select the unit, and it is the sphere an explosion measures to decide whether the unit was caught."}
        </p>
      ) : null}

      <PieceCollisionFields
        project={project}
        pack={pack}
        raw={raw}
        selectedId={selectedId}
        onSelect={onSelectPiece}
        onChange={onPieceVolumeChange}
      />
    </div>
  );
}
