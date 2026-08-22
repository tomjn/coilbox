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

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
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
import {
  pieceCollisionInclude,
  pieceCollisionScriptPath,
} from "../../pieceCollisionScript";
import type { RawGeometry } from "../../rawGeometry";
import { bakedPieces } from "../../s3oBuild";
import { Vec3Row } from "./TransformFields";

/**
 * The piece these fields are on, given the builder's selection.
 *
 * Exported because the viewport has to put its handles on the same box these
 * fields change, and nothing selected still shows a piece here: the fields open
 * on the first one rather than on nothing at all.
 */
export function pickedCollisionPiece(
  project: LegoProject,
  selectedId: string | null,
): string | null {
  const pieces = orderedPieces(project);
  const picked = pieces.find((piece) => piece.id === selectedId) ?? pieces[0];
  return picked?.id ?? null;
}

interface Props {
  project: LegoProject;
  pack: LoadedPack;
  raw: RawGeometry | null;
  /** The piece being edited, which is the builder's own selection. */
  selectedId: string | null;
  onSelect: (pieceId: string) => void;
  /** Null puts the piece back on the box the engine derives for it. */
  onChange: (pieceId: string, collision: LegoPieceCollision | null) => void;
  /** The Lua the export would write for this unit right now, so the file can be
   *  read without going and finding it in the game folder. */
  script: string;
}

export function PieceCollisionFields({
  project,
  pack,
  raw,
  selectedId,
  onSelect,
  onChange,
  script,
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
  const pickedId = pickedCollisionPiece(project, selectedId);
  const picked = pieces.find((piece) => piece.id === pickedId);
  const entry = picked ? byId.get(picked.id) : undefined;
  const overridden = project.pieces.filter(
    (piece) => piece.collision !== undefined,
  );
  // A script taken over before any of this was set has no include line, and an
  // export will never add one, so the file would be written and never read. The
  // only fix is a line the user adds, so the panel says which line.
  const missingInclude =
    overridden.length > 0 &&
    project.script !== undefined &&
    !project.script.includes(pieceCollisionScriptPath(project.unitName));

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
        them as Lua instead. Exporting the unit puts them in a file of coilbox's
        own next to the game's scripts, and the unit script pulls that file in
        with one line. Nothing is written until you export, and the file is
        rewritten every time, so it keeps up with what you set here even after
        you have taken the script over.
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

      <p className="text-xs text-muted-foreground">
        {!selectedId
          ? `Nothing is selected, so the viewport's handles are on the unit's volume. Select ${picked.name} to move them onto its box.`
          : hit
            ? `${picked.name} is selected, so the viewport's handles are on its box and it is drawn wide to stand out from the rest. Size needs the scale tool: those handles are plates on the box's six faces. Deselect to put them back on the unit's volume.`
            : `Nothing hits ${picked.name}, so it has no box on screen and the viewport's handles stay on the unit's volume.`}
      </p>

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

      {missingInclude ? (
        <p className="text-xs text-destructive">
          This unit's script is your own and does not pull the file in, so
          nothing set here reaches a game. Add{" "}
          <code className="break-all">
            {pieceCollisionInclude(project.unitName)}
          </code>{" "}
          near the top of it. A script generated after these were set carries
          that line already.
        </p>
      ) : null}

      {overridden.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          Changed on {overridden.map((piece) => piece.name).join(", ")}.
        </p>
      ) : null}

      {/* The file is coilbox's and lands in somebody else's game folder, which
          made it easy to take on trust or to miss entirely. Reading it is the
          only way to check what a piece will actually be given. */}
      <Collapsible>
        <CollapsibleTrigger asChild>
          <Button size="sm" variant="outline" className="w-full">
            Show the file this writes
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <p className="mt-2 text-xs text-muted-foreground">
            Written on export to{" "}
            <code className="break-all">
              scripts/{pieceCollisionScriptPath(project.unitName)}
            </code>{" "}
            inside the game you export to, and nowhere else. Saving the project
            does not write it. Change these numbers rather than the file: an
            export overwrites it.
          </p>
          <pre className="mt-2 max-h-64 overflow-auto rounded border border-border/60 bg-muted/40 p-2 text-[11px] leading-relaxed">
            {script}
          </pre>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
