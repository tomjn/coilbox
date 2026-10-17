/**
 * What the measure tool and a drag read out, in elmos and in steps.
 *
 * Plain text beside the model rather than labels on the lines: a label that
 * follows a line has to be drawn again every frame the camera moves, and a
 * list does not.
 */

import { Button } from "@picoframe/frame";
import { X } from "lucide-react";
import { useMemo } from "react";

import {
  axesText,
  figure,
  type Measurement,
  measureBetween,
  pieceSize,
} from "../../measure";
import type { LegoProject } from "../../model";
import { type LoadedPack, partUnit } from "../../pack";
import type { RawGeometry } from "../../rawGeometry";
import type { Vec3 } from "../../snapping";

/** Three lengths on one axis each, as two short lines. */
export function AxisFigures({
  values,
  step,
}: {
  values: Vec3;
  step: number | null;
}) {
  const { elmos, steps } = axesText(values, step);
  return (
    <>
      <div>{elmos} elmos</div>
      {steps ? <div>{steps} steps</div> : null}
    </>
  );
}

const card =
  "pointer-events-auto self-start rounded-md bg-black/60 px-2 py-1.5 text-xs text-white";

/** The lines drawn, one block each, and the one being made. */
export function MeasureReadout({
  measurements,
  start,
  hover,
  step,
  onClear,
}: {
  measurements: Measurement[];
  /** The first point of a measurement waiting for its second. */
  start: Vec3 | null;
  /** Where the pointer is while it waits. */
  hover: Vec3 | null;
  step: number | null;
  onClear: () => void;
}) {
  const live = start && hover ? measureBetween(start, hover) : null;
  return (
    <div className={`${card} max-h-48 min-w-48 overflow-y-auto`}>
      <div className="flex items-center justify-between gap-3">
        <span className="font-medium">Measure</span>
        {measurements.length > 0 ? (
          <Button
            size="sm"
            variant="ghost"
            className="h-5 px-1 text-xs"
            onClick={onClear}
          >
            <X size={12} /> Clear
          </Button>
        ) : null}
      </div>
      {measurements.map((m, index) => {
        const { delta, length } = measureBetween(m.from, m.to);
        return (
          <div key={m.id} className="mt-1 border-t border-white/20 pt-1">
            <div>
              {index + 1}. {figure(length, step)}
            </div>
            <AxisFigures values={delta} step={step} />
          </div>
        );
      })}
      {start ? (
        <div className="mt-1 border-t border-white/20 pt-1">
          {live ? (
            <>
              <div>{figure(live.length, step)}</div>
              <AxisFigures values={live.delta} step={step} />
            </>
          ) : (
            <div>Click the second point</div>
          )}
        </div>
      ) : measurements.length === 0 ? (
        <div className="mt-1">Click the first point</div>
      ) : null}
    </div>
  );
}

/** How far the piece being dragged has moved, and how big it is. */
export function DragReadout({
  moved,
  size,
  step,
}: {
  moved: Vec3;
  size: Vec3 | null;
  step: number | null;
}) {
  return (
    <div className={card}>
      <div className="font-medium">Moved</div>
      <AxisFigures values={moved} step={step} />
      {size ? (
        <>
          <div className="mt-1 font-medium">Size</div>
          <AxisFigures values={size} step={step} />
        </>
      ) : null}
    </div>
  );
}

/**
 * A piece's size along each axis with the fields in the piece panel. A
 * component of its own so the bake it asks for is redone when the unit
 * changes and not on every render of the page.
 */
export function PieceSize({
  project,
  pack,
  raw,
  pieceId,
}: {
  project: LegoProject;
  pack: LoadedPack;
  raw: RawGeometry | null;
  pieceId: string;
}) {
  const size = useMemo(
    () => pieceSize(project, pack, raw, pieceId),
    [project, pack, raw, pieceId],
  );
  if (!size) return null;
  return (
    <div className="mt-2">
      <span className="text-xs text-muted-foreground">Size</span>
      <div className="mt-1 text-xs">
        <AxisFigures values={size} step={partUnit(pack)} />
      </div>
    </div>
  );
}
