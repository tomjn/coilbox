/**
 * One piece's collision volume, as numbers you can change (issue #1842).
 *
 * Sits under the unit's own volume in the collision panel, because it is the
 * same question asked one level down: what stops a shot here. It opens on the
 * box the engine measures round the piece's vertices, so it reads before it
 * sets, and touching anything takes that box over.
 *
 * Two things this panel says that the unit's own does not.
 *
 * Offsets here are in the piece's own space, the frame its vertices are in, not
 * measured from the unit's aim point. `CCollisionHandler` translates by them on
 * top of the piece's model-space matrix, so they move and turn with the piece.
 *
 * And none of it reaches a game unless the unit is hit or clicked piece by
 * piece: the engine only walks the piece tree when the unit volume asks it to.
 *
 * The piece is picked here rather than taken from the tree, because the tree is
 * the other half of this aside and is not on screen while this is.
 */

import { Button } from "@picoframe/frame";
import { useMemo } from "react";

import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { OptionSelect } from "../../../uberstress/pages/components/OptionSelect";
import {
  COLLISION_VOLUME_LABELS,
  MIN_PIECE_COLLISION_SIZE,
  pieceCollisionVolumes,
} from "../../collisionVolume";
import type {
  CollisionVolumeType,
  LegoPieceCollision,
  LegoProject,
} from "../../model";
import { orderedPieces } from "../../model";
import type { LoadedPack } from "../../pack";
import type { RawGeometry } from "../../rawGeometry";
import { bakedPieces } from "../../s3oBuild";
import { Vec3Row } from "./TransformFields";

interface Props {
  project: LegoProject;
  pack: LoadedPack;
  raw: RawGeometry | null;
  /** The piece being edited, which is the builder's own selection. */
  selectedId: string | null;
  onSelect: (pieceId: string) => void;
  /** Null puts the piece back on the box the engine derives for it. */
  onChange: (pieceId: string, collision: LegoPieceCollision | null) => void;
}

export function PieceCollisionFields({
  project,
  pack,
  raw,
  selectedId,
  onSelect,
  onChange,
}: Props) {
  // Every vertex in the unit, so not on every keystroke elsewhere in the page.
  const volumes = useMemo(
    () =>
      pieceCollisionVolumes(project, bakedPieces(project, pack, raw).pieces),
    [project, pack, raw],
  );
  const byId = useMemo(
    () => new Map(volumes.map((entry) => [entry.pieceId, entry])),
    [volumes],
  );

  const pieces = orderedPieces(project);
  // The root is a piece like any other and the engine boxes it too, so it is
  // offered. A piece the model does not carry vertices for is offered as well:
  // an empty piece is exactly the case this panel exists for, since the engine
  // gives it a one elmo box nobody asked for.
  const picked = pieces.find((piece) => piece.id === selectedId) ?? pieces[0];
  const entry = picked ? byId.get(picked.id) : undefined;
  const overridden = project.pieces.filter(
    (piece) => piece.collision !== undefined,
  );

  if (!picked || !entry) return null;

  const { volume, derived, hit } = entry;
  const own = picked.collision;

  /** Write a volume onto the piece, keeping whether it is hit. */
  function setVolume(next: {
    type?: CollisionVolumeType;
    scales?: [number, number, number];
    offsets?: [number, number, number];
  }): void {
    if (!picked) return;
    onChange(picked.id, { hit, volume: { ...volume, ...next } });
  }

  function setAxis(
    field: "scales" | "offsets",
    axis: number,
    value: number,
  ): void {
    const next: [number, number, number] = [...volume[field]];
    // The engine clamps every piece scale up to one elmo in `InitShape`, so a
    // smaller number here would not be the number the game gets.
    next[axis] =
      field === "scales" ? Math.max(MIN_PIECE_COLLISION_SIZE, value) : value;
    setVolume({ [field]: next });
  }

  return (
    <div className="flex flex-col gap-3 border-t border-border/60 pt-3">
      <p className="text-xs font-medium">Change one piece's box</p>
      <p className="text-xs text-muted-foreground">
        Nothing in a model or a unit definition can set these, so coilbox writes
        them as Lua instead:{" "}
        <code>scripts/coilbox/{project.unitName}_collision.lua</code>, which the
        unit script pulls in with one line. That file is coilbox's own and is
        rewritten on every export, so it keeps up with what you set here even
        after you have taken the script over.
      </p>

      <div>
        <span className="text-xs text-muted-foreground">Piece</span>
        <OptionSelect
          className="mt-1"
          size="sm"
          value={picked.id}
          onValueChange={onSelect}
          options={pieces.map((piece) => ({
            value: piece.id,
            label: piece.collision ? `${piece.name} (changed)` : piece.name,
          }))}
        />
      </div>

      <div className="flex items-center justify-between gap-3">
        <Label htmlFor="piece-hit" className="text-xs font-medium">
          Anything hits {picked.name}
        </Label>
        <Switch
          id="piece-hit"
          checked={hit}
          onCheckedChange={(on) =>
            onChange(
              picked.id,
              on && !own?.volume
                ? null
                : { hit: on, ...(own?.volume ? { volume: own.volume } : {}) },
            )
          }
        />
      </div>

      <div>
        <span className="text-xs text-muted-foreground">Shape</span>
        <OptionSelect
          className="mt-1"
          size="sm"
          value={volume.type}
          onValueChange={(type) =>
            setVolume({ type: type as CollisionVolumeType })
          }
          options={Object.entries(COLLISION_VOLUME_LABELS).map(
            ([id, label]) => ({ value: id, label }),
          )}
        />
      </div>

      <Vec3Row
        label="Box size"
        unit="elmos"
        values={volume.scales}
        onCommit={(axis, value) => setAxis("scales", axis, value)}
      />
      <Vec3Row
        label="Offset in the piece"
        values={volume.offsets}
        onCommit={(axis, value) => setAxis("offsets", axis, value)}
      />

      <p className="text-xs text-muted-foreground">
        Size is the box's full width, and the offset is measured from the
        piece's own origin rather than from the unit's aim point, so it turns
        and moves with the piece. No axis can be under one elmo: the engine
        clamps them.
      </p>

      {own ? (
        <Button
          size="sm"
          variant="outline"
          onClick={() => onChange(picked.id, null)}
        >
          Use the measured box
        </Button>
      ) : (
        <p className="text-xs text-muted-foreground">
          {picked.name} is on the box the engine measures round its vertices,{" "}
          {derived.scales.map((n) => Number(n.toFixed(1))).join(" by ")} elmos.
          Changing anything above takes it over.
        </p>
      )}

      {!project.pieceCollision && !project.pieceSelection ? (
        <p className="text-xs text-destructive">
          Neither switch above is on, so the engine never looks at a piece's box
          and none of this reaches a game.
        </p>
      ) : null}

      {overridden.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          Changed on {overridden.map((piece) => piece.name).join(", ")}.
        </p>
      ) : null}
    </div>
  );
}
